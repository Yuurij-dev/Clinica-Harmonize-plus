import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_SYNC_ATTEMPTS,
  backoffMinutes,
  buildJobSnapshot,
  decideEnqueue,
  decideJobFailure,
  isJobRunnable,
  parseJobSnapshot,
  planCalendarSync,
  resolveProfessionalMember,
} from "../src/lib/calendar-sync-rules.ts";
import { calendarEventId } from "../src/lib/google-calendar-rules.ts";

const members = [
  { userId: "u-admin", name: "Clara Admin", email: "clara@example.invalid", role: "ADMIN" },
  { userId: "u-ana", name: "Dra. Ana", email: "ana@example.invalid", role: "PROFESSIONAL" },
  { userId: "u-bia", name: "Dra. Bia", email: "bia@example.invalid", role: "PROFESSIONAL" },
  { userId: "u-rec", name: "Rita Recepção", email: "rita@example.invalid", role: "STAFF" },
  { userId: "u-x1", name: "Gêmeo", email: "g1@example.invalid", role: "PROFESSIONAL" },
  { userId: "u-x2", name: "gêmeo ", email: "g2@example.invalid", role: "PROFESSIONAL" },
];
const prof = (name) => resolveProfessionalMember(name, members);

const central = { id: "c-central", userId: "u-admin", type: "ADMIN", status: "CONNECTED", googleEmail: "clinica@gmail.example" };
const anaConn = { id: "c-ana", userId: "u-ana", type: "PROFESSIONAL", status: "CONNECTED", googleEmail: "ana.google@gmail.example" };
const biaConn = { id: "c-bia", userId: "u-bia", type: "PROFESSIONAL", status: "CONNECTED", googleEmail: "bia.google@gmail.example" };
const link = (connectionId, role, extra = {}) => ({ connectionId, role, googleEventId: `ev-${connectionId}`, attendeeEmail: null, syncStatus: "SYNCED", ...extra });
const plan = (over) => planCalendarSync({ appointment: { id: "apt1", status: "Agendado" }, appointmentId: "apt1", connections: [], events: [], professional: prof("Dra. Ana"), ...over });
const types = (p) => p.actions.map((a) => `${a.type}:${a.connectionId ?? a.individualConnectionId}`);

test("resolução do profissional: único, 0, 2+, sem nome, STAFF ignorado, caixa/espaços", () => {
  assert.deepEqual(prof("  dra.   ana ").professional?.userId, "u-ana");
  assert.deepEqual(prof("Fulano"), { ok: false, reason: "NOT_FOUND" });
  assert.deepEqual(prof("Gêmeo"), { ok: false, reason: "AMBIGUOUS" });
  assert.deepEqual(prof(""), { ok: false, reason: "NO_NAME" });
  assert.deepEqual(prof("Rita Recepção"), { ok: false, reason: "NOT_FOUND" });
  assert.equal(prof("Clara Admin").professional?.userId, "u-admin");
});

test("sem nenhuma conexão: nada a fazer", () => {
  assert.deepEqual(plan({}).actions, []);
});

test("com central e sem conexão do profissional: 1 evento central com attendee = User.email", () => {
  const p = plan({ connections: [central] });
  assert.equal(p.actions.length, 1);
  assert.deepEqual(p.actions[0], {
    type: "UPSERT_EVENT", connectionId: "c-central", role: "CENTRAL", googleEventId: calendarEventId("c-central", "apt1"),
    existing: false, attendeeEmail: "ana@example.invalid", sendUpdates: "all",
  });
});

test("central + individual do profissional: attendee = e-mail da conta Google conectada; verifica convite, sem criar cópia", () => {
  const p = plan({ connections: [central, anaConn] });
  assert.deepEqual(types(p), ["UPSERT_EVENT:c-central", "VERIFY_INVITE:c-ana"]);
  assert.equal(p.actions[0].attendeeEmail, "ana.google@gmail.example");
  assert.equal(p.actions.filter((a) => a.type === "UPSERT_EVENT" && a.role === "INDIVIDUAL").length, 0);
  assert.equal(p.actions[1].centralGoogleEventId, p.actions[0].googleEventId);
});

test("convite já RECEIVED não é verificado de novo; segundo plano com vínculos é igual (idempotente)", () => {
  const first = plan({ connections: [central, anaConn] });
  const events = [link("c-central", "CENTRAL", { googleEventId: first.actions[0].googleEventId, attendeeEmail: "ana.google@gmail.example" }), link("c-ana", "INDIVIDUAL", { syncStatus: "RECEIVED" })];
  const second = plan({ connections: [central, anaConn], events });
  assert.deepEqual(types(second), ["UPSERT_EVENT:c-central"]);
  assert.equal(second.actions[0].existing, true);
  assert.equal(second.actions[0].googleEventId, first.actions[0].googleEventId);
  assert.equal(second.actions[0].sendUpdates, "all");
});

test("sem central, só individual: evento independente sem attendee (único)", () => {
  const p = plan({ connections: [anaConn] });
  assert.deepEqual(p.actions, [{ type: "UPSERT_EVENT", connectionId: "c-ana", role: "INDIVIDUAL", googleEventId: calendarEventId("c-ana", "apt1"), existing: false, attendeeEmail: null, sendUpdates: "none" }]);
});

test("individual do outro profissional não recebe evento", () => {
  assert.deepEqual(plan({ connections: [biaConn] }).actions, []);
});

test("central conectada depois, profissional já tem independente: central SEM attendee e o individual é mantido (um evento por calendário)", () => {
  const events = [link("c-ana", "INDIVIDUAL")];
  const p = plan({ connections: [central, anaConn], events });
  assert.deepEqual(types(p), ["UPSERT_EVENT:c-central", "UPSERT_EVENT:c-ana"]);
  assert.equal(p.actions[0].attendeeEmail, null);
  assert.equal(p.actions[0].sendUpdates, "none");
  assert.equal(p.actions[1].existing, true);
});

test("profissional já com convite recebido e central desconectada: não cria independente", () => {
  const p = plan({ connections: [{ ...central, status: "DISCONNECTED" }, anaConn], events: [link("c-ana", "INDIVIDUAL", { syncStatus: "RECEIVED" }), link("c-central", "CENTRAL")] });
  assert.deepEqual(types(p), ["SKIP:c-central"]);
});

test("mesma conta Google na central e no individual: sem attendee e sem cópia", () => {
  const same = { ...anaConn, googleEmail: "CLINICA@gmail.example" };
  const p = plan({ connections: [central, same] });
  assert.deepEqual(types(p), ["UPSERT_EVENT:c-central"]);
  assert.equal(p.actions[0].attendeeEmail, null);
});

test("e-mail inválido: sem attendee + aviso; nunca convida por palpite", () => {
  const bad = [{ ...members[1], email: "sem-arroba" }];
  const p = plan({ connections: [central], professional: resolveProfessionalMember("Dra. Ana", bad) });
  assert.equal(p.actions[0].attendeeEmail, null);
  assert.deepEqual(p.warnings, ["INVALID_ATTENDEE_EMAIL"]);
});

test("profissional não identificado / ambíguo: central sem attendee e avisos", () => {
  const none = plan({ connections: [central, anaConn], professional: prof("Fulano") });
  assert.deepEqual(types(none), ["UPSERT_EVENT:c-central"]);
  assert.equal(none.actions[0].attendeeEmail, null);
  assert.deepEqual(none.warnings, ["PROFESSIONAL_NOT_IDENTIFIED"]);
  assert.deepEqual(plan({ connections: [central], professional: prof("Gêmeo") }).warnings, ["PROFESSIONAL_AMBIGUOUS"]);
});

test("troca de profissional com central: attendee do novo, patch avisa (sendUpdates all); recebido do anterior só desvincula", () => {
  const events = [link("c-central", "CENTRAL", { attendeeEmail: "ana.google@gmail.example" }), link("c-ana", "INDIVIDUAL", { syncStatus: "RECEIVED" })];
  const p = plan({ connections: [central, anaConn, biaConn], events, professional: prof("Dra. Bia") });
  assert.deepEqual(types(p), ["UPSERT_EVENT:c-central", "UNLINK:c-ana", "VERIFY_INVITE:c-bia"]);
  assert.equal(p.actions[0].attendeeEmail, "bia.google@gmail.example");
  assert.equal(p.actions[0].existing, true);
  assert.equal(p.actions[0].sendUpdates, "all");
  assert.equal(p.actions[1].reason, "REASSIGNED");
});

test("troca de profissional sem central: apaga o independente do anterior e cria o do novo", () => {
  const events = [link("c-ana", "INDIVIDUAL")];
  const p = plan({ connections: [anaConn, biaConn], events, professional: prof("Dra. Bia") });
  assert.deepEqual(types(p), ["DELETE_EVENT:c-ana", "UPSERT_EVENT:c-bia"]);
  assert.equal(p.actions[1].existing, false);
});

test("troca para profissional sem conta conectada, com central: attendee = User.email e independente anterior apagado", () => {
  const events = [link("c-ana", "INDIVIDUAL")];
  const p = plan({ connections: [central, anaConn], events, professional: prof("Clara Admin") });
  // Clara é a dona da conta central: e-mail diferente do Google da central, então é convidada normalmente.
  assert.deepEqual(types(p), ["UPSERT_EVENT:c-central", "DELETE_EVENT:c-ana"]);
  assert.equal(p.actions[0].attendeeEmail, "clara@example.invalid");
});

test("cancelamento: central cancela (avisa convidado), independente apaga, recebido desvincula; sem evento = nada", () => {
  const cancelled = { id: "apt1", status: "Cancelado" };
  const events = [link("c-central", "CENTRAL", { attendeeEmail: "ana@example.invalid" }), link("c-ana", "INDIVIDUAL", { syncStatus: "RECEIVED" })];
  const p = plan({ appointment: cancelled, connections: [central, anaConn], events });
  assert.deepEqual(p.actions[0], { type: "CANCEL_EVENT", connectionId: "c-central", role: "CENTRAL", googleEventId: "ev-c-central", sendUpdates: "all" });
  assert.deepEqual(p.actions[1], { type: "UNLINK", connectionId: "c-ana", googleEventId: "ev-c-ana", reason: "CANCELLED" });
  const indep = plan({ appointment: cancelled, connections: [anaConn], events: [link("c-ana", "INDIVIDUAL")] });
  assert.deepEqual(indep.actions, [{ type: "DELETE_EVENT", connectionId: "c-ana", role: "INDIVIDUAL", googleEventId: "ev-c-ana", sendUpdates: "none" }]);
  assert.deepEqual(plan({ appointment: cancelled, connections: [central] }).actions, []);
});

test("reativação de cancelado: volta como UPSERT existing=true no mesmo id", () => {
  const events = [link("c-central", "CENTRAL", { googleEventId: "ev-orig", syncStatus: "CANCELLED" })];
  const p = plan({ connections: [central], events });
  assert.equal(p.actions[0].googleEventId, "ev-orig");
  assert.equal(p.actions[0].existing, true);
});

test("exclusão (appointment null) usa só o snapshot: central e independente apagados, recebido desvinculado, conexão inativa ignorada", () => {
  const snapshot = parseJobSnapshot(buildJobSnapshot([link("c-central", "CENTRAL", { attendeeEmail: "ana@example.invalid" }), link("c-ana", "INDIVIDUAL"), link("c-bia", "INDIVIDUAL", { syncStatus: "RECEIVED" }), link("c-old", "CENTRAL")]));
  const p = planCalendarSync({ appointment: null, appointmentId: "apt1", connections: [central, anaConn, biaConn, { ...central, id: "c-old", status: "ERROR" }], events: snapshot.events, professional: { ok: false, reason: "NO_NAME" } });
  assert.deepEqual(types(p), ["DELETE_EVENT:c-central", "DELETE_EVENT:c-ana", "UNLINK:c-bia", "SKIP:c-old"]);
  assert.equal(p.actions[0].sendUpdates, "all");
  assert.equal(p.actions[1].sendUpdates, "none");
});

test("reconexão/backfill sem vínculos usa o mesmo id determinístico (sem duplicar); 2 execuções iguais", () => {
  const a = plan({ connections: [central, anaConn] });
  const b = plan({ connections: [central, anaConn] });
  assert.deepEqual(a, b);
  assert.equal(a.actions[0].googleEventId, calendarEventId("c-central", "apt1"));
  // central desconectada: vínculo antigo vira histórico (SKIP), nada é criado em conexão inativa
  const off = plan({ connections: [{ ...central, status: "ERROR" }], events: [link("c-central", "CENTRAL")] });
  assert.deepEqual(types(off), ["SKIP:c-central"]);
});

test("conexão do profissional desconectada: vínculo individual dele vira histórico", () => {
  const p = plan({ connections: [{ ...anaConn, status: "DISCONNECTED" }], events: [link("c-ana", "INDIVIDUAL")] });
  assert.deepEqual(types(p), ["SKIP:c-ana"]);
});

test("backoff 1,2,4,8,16 e limite de 6 tentativas", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(backoffMinutes), [1, 2, 4, 8, 16]);
  const now = new Date("2026-12-01T10:00:00Z");
  for (let before = 0; before < MAX_SYNC_ATTEMPTS - 1; before++) {
    const d = decideJobFailure({ kind: "transient", attemptsBefore: before, now });
    assert.equal(d.status, "PENDING");
    assert.equal(d.nextRetryAt.getTime() - now.getTime(), backoffMinutes(before + 1) * 60_000);
  }
  assert.equal(decideJobFailure({ kind: "transient", attemptsBefore: MAX_SYNC_ATTEMPTS - 1, now }).status, "FAILED");
});

test("falhas: 429 respeita Retry-After, invalid_grant não repete e marca conexão, 4xx permanente falha", () => {
  const now = new Date("2026-12-01T10:00:00Z");
  assert.equal(decideJobFailure({ kind: "rateLimit", attemptsBefore: 0, now, retryAfterSeconds: 600 }).nextRetryAt.getTime() - now.getTime(), 600_000);
  const auth = decideJobFailure({ kind: "auth", attemptsBefore: 0, now });
  assert.equal(auth.status, "FAILED");
  assert.equal(auth.markConnectionError, true);
  assert.match(auth.message, /reconecte/i);
  const perm = decideJobFailure({ kind: "permanent", attemptsBefore: 0, now });
  assert.equal(perm.status, "FAILED");
  assert.equal(perm.markConnectionError, false);
});

test("coalescência: UPDATE repetido ignorado, DELETE sobrepõe e bloqueia novos", () => {
  assert.deepEqual(decideEnqueue("UPDATE", []), { insert: true, supersedeIds: [] });
  assert.deepEqual(decideEnqueue("UPDATE", [{ id: "j1", operation: "CREATE" }]), { insert: false, supersedeIds: [] });
  assert.deepEqual(decideEnqueue("CREATE", [{ id: "j1", operation: "UPDATE" }]), { insert: false, supersedeIds: [] });
  assert.deepEqual(decideEnqueue("DELETE", [{ id: "j1", operation: "UPDATE" }, { id: "j2", operation: "CREATE" }]), { insert: true, supersedeIds: ["j1", "j2"] });
  assert.deepEqual(decideEnqueue("DELETE", [{ id: "j3", operation: "DELETE" }]), { insert: false, supersedeIds: [] });
  assert.deepEqual(decideEnqueue("UPDATE", [{ id: "j3", operation: "DELETE" }]), { insert: false, supersedeIds: [] });
});

test("snapshot: ida e volta mínima e rejeição de formato inválido; elegibilidade de job", () => {
  assert.equal(parseJobSnapshot({ events: [{ connectionId: 1 }] }), null);
  assert.equal(parseJobSnapshot(null), null);
  const now = new Date("2026-12-01T10:00:00Z");
  assert.equal(isJobRunnable({ status: "PENDING", nextRetryAt: new Date(now.getTime() - 1), lockedAt: null }, now), true);
  assert.equal(isJobRunnable({ status: "PENDING", nextRetryAt: new Date(now.getTime() + 1), lockedAt: null }, now), false);
  assert.equal(isJobRunnable({ status: "PROCESSING", nextRetryAt: now, lockedAt: new Date(now.getTime() - 6 * 60_000) }, now), true);
  assert.equal(isJobRunnable({ status: "PROCESSING", nextRetryAt: now, lockedAt: new Date(now.getTime() - 60_000) }, now), false);
  assert.equal(isJobRunnable({ status: "FAILED", nextRetryAt: now, lockedAt: null }, now), false);
});

test("profissional não identificado: evento individual independente existente NÃO é apagado (conservador); convite recebido só desvincula", () => {
  const independent = plan({ connections: [central, anaConn], events: [link("c-ana", "INDIVIDUAL")], professional: prof("Fulano") });
  assert.deepEqual(types(independent), ["UPSERT_EVENT:c-central"]);
  assert.equal(independent.actions[0].attendeeEmail, null);
  const invited = plan({ connections: [central, anaConn], events: [link("c-central", "CENTRAL", { attendeeEmail: "ana.google@gmail.example" }), link("c-ana", "INDIVIDUAL", { syncStatus: "RECEIVED" })], professional: prof("Gêmeo") });
  assert.deepEqual(types(invited), ["UPSERT_EVENT:c-central", "UNLINK:c-ana"]);
  assert.equal(invited.actions[0].sendUpdates, "all");
  // sem central e sem identificação: nenhuma ação destrutiva
  assert.deepEqual(plan({ connections: [anaConn], events: [link("c-ana", "INDIVIDUAL")], professional: prof("Fulano") }).actions, []);
});
