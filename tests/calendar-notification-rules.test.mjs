import assert from "node:assert/strict";
import { test } from "node:test";
import { describeChanges, notificationDedupeKey, planNotifications as planRaw } from "../src/lib/calendar-notification-rules.ts";
import { diffAppointmentState } from "../src/lib/google-calendar-rules.ts";

// Relógio fixo (clínica): 2026-11-12 10:00; os agendamentos dos testes são futuros em relação a ele.
const NOW = { date: "2026-11-12", minutes: 600 };
const planNotifications = (input) => planRaw({ now: NOW, ...input });
const s = { status: "Agendado", day: "2026-12-01", time: "14:30", procedure: "Botox", professional: "Dra. Ana", durationMinutes: 45 };
const ana = { userId: "u-ana" };
const bia = { userId: "u-bia" };
const kinds = (list) => list.map((n) => `${n.kind}:${n.recipientUserId}`);

test("criação: NEW só para profissional identificado", () => {
  assert.deepEqual(kinds(planNotifications({ prev: null, next: s, prevProfessional: null, nextProfessional: ana })), ["NEW:u-ana"]);
  assert.deepEqual(planNotifications({ prev: null, next: s, prevProfessional: null, nextProfessional: null }), []);
});

test("mudança de data/hora/procedimento/duração: CHANGED com o que mudou; só status não notifica", () => {
  const out = planNotifications({ prev: s, next: { ...s, time: "15:00", day: "2026-12-02" }, prevProfessional: ana, nextProfessional: ana });
  assert.deepEqual(kinds(out), ["CHANGED:u-ana"]);
  assert.deepEqual(describeChanges(out[0].changes), ["Data: 01/12/2026 → 02/12/2026", "Horário: 14:30 → 15:00"]);
  assert.deepEqual(planNotifications({ prev: s, next: { ...s, status: "Atendido" }, prevProfessional: ana, nextProfessional: ana }), []);
  assert.deepEqual(planNotifications({ prev: s, next: { ...s }, prevProfessional: ana, nextProfessional: ana }), []);
});

test("cancelamento e exclusão: CANCELLED para o profissional; nada se já estava cancelado", () => {
  assert.deepEqual(kinds(planNotifications({ prev: s, next: { ...s, status: "Cancelado" }, prevProfessional: ana, nextProfessional: ana })), ["CANCELLED:u-ana"]);
  assert.deepEqual(kinds(planNotifications({ prev: s, next: null, prevProfessional: ana, nextProfessional: null })), ["CANCELLED:u-ana"]);
  assert.deepEqual(planNotifications({ prev: { ...s, status: "Cancelado" }, next: null, prevProfessional: ana, nextProfessional: null }), []);
});

test("troca de profissional: REASSIGNED_OUT para o anterior e NEW para o novo; para não identificado só o REASSIGNED_OUT", () => {
  const next = { ...s, professional: "Dra. Bia" };
  assert.deepEqual(kinds(planNotifications({ prev: s, next, prevProfessional: ana, nextProfessional: bia })), ["REASSIGNED_OUT:u-ana", "NEW:u-bia"]);
  assert.deepEqual(kinds(planNotifications({ prev: s, next: { ...s, professional: "Fulano" }, prevProfessional: ana, nextProfessional: null })), ["REASSIGNED_OUT:u-ana"]);
});

test("reativação de cancelado: NEW", () => {
  assert.deepEqual(kinds(planNotifications({ prev: { ...s, status: "Cancelado" }, next: s, prevProfessional: ana, nextProfessional: ana })), ["NEW:u-ana"]);
});

test("dedupeKey: estável por estado, muda com o estado/tipo/destinatário", () => {
  const key = (state, kind = "NEW", who = "u-ana") => notificationDedupeKey("apt1", kind, who, state);
  assert.equal(key(s), key({ ...s, professional: "  dra.  ana" }));
  assert.match(key(s), /^apt1:NEW:[0-9a-f]{24}$/);
  assert.notEqual(key(s), key({ ...s, time: "15:00" }));
  assert.notEqual(key(s), key(s, "CHANGED"));
  assert.notEqual(key(s), key(s, "NEW", "u-bia"));
  assert.deepEqual(describeChanges(diffAppointmentState(s, { ...s, durationMinutes: 60 })), ["Duração: 45 min → 60 min"]);
});

test("cancelamento/reatribuição/exclusão só avisam agendamento Agendado e futuro (excluir jornada com atendidos/passados não envia)", () => {
  const past = { ...s, day: "2026-11-01" };
  const sameDayEarlier = { ...s, day: "2026-11-12", time: "09:00" };
  const done = { ...s, status: "Atendido" };
  for (const prev of [past, sameDayEarlier, done, { ...s, status: "Em atendimento" }, { ...s, status: "Faltou" }]) {
    assert.deepEqual(planNotifications({ prev, next: null, prevProfessional: ana, nextProfessional: null }), [], prev.status + prev.day);
  }
  // reatribuição de agendamento já passado/atendido: só o novo (NEW) não ocorre porque next ativo exige prev inativo; sem REASSIGNED_OUT
  assert.deepEqual(kinds(planNotifications({ prev: past, next: { ...past, professional: "Dra. Bia" }, prevProfessional: ana, nextProfessional: bia })), ["NEW:u-bia"]);
  assert.deepEqual(planNotifications({ prev: past, next: { ...past, status: "Cancelado" }, prevProfessional: ana, nextProfessional: ana }), []);
  // futuro e Agendado continua avisando
  assert.deepEqual(kinds(planNotifications({ prev: s, next: null, prevProfessional: ana, nextProfessional: null })), ["CANCELLED:u-ana"]);
  assert.deepEqual(kinds(planNotifications({ prev: s, next: { ...s, professional: "Dra. Bia" }, prevProfessional: ana, nextProfessional: bia })), ["REASSIGNED_OUT:u-ana", "NEW:u-bia"]);
});
