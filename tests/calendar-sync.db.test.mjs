import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test, { after } from "node:test";
import { registerHooks } from "node:module";
import { PrismaClient } from "@prisma/client";

// Fila, processador, serviço de sincronização, ganchos, desconexão e status contra o Postgres LOCAL, com Google e Resend FALSOS
// (nenhuma chamada de rede). Ignora se DATABASE_URL não for localhost/127.0.0.1, banco harmonize. Dados com prefixo único, apagados no fim.

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    const match = readFileSync(file, "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (match) return match[1];
  }
  return null;
}

// Os módulos importam "./clinic-time" sem extensão (o Next resolve, o Node puro não): o hook só completa ".ts".
registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); } catch (error) {
      if (specifier.startsWith(".") && !/\.\w+$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
});
const { processCalendarSyncJobs } = await import("../src/lib/calendar-sync-job-processor.ts");
const queue = await import("../src/lib/calendar-sync-queue.ts");
const hooks = await import("../src/lib/calendar-appointment-hooks.ts");
const connections = await import("../src/lib/google-calendar-connection-service.ts");
const { GoogleCalendarError } = await import("../src/lib/google-calendar-client.ts");
const { encryptGoogleToken } = await import("../src/lib/secret-box.ts");
const { appointmentInstant } = await import("../src/lib/clinic-time.ts");
const { AUTH_FAILURE_MESSAGE } = await import("../src/lib/calendar-sync-rules.ts");
const { RECONNECT_MESSAGE } = await import("../src/lib/google-calendar-token-service.ts");

let prisma = null;
let skipReason = null;
const url = databaseUrl();
if (!url) {
  skipReason = "DATABASE_URL ausente";
} else {
  let host = "";
  let dbName = "";
  try { const u = new URL(url); host = u.hostname; dbName = u.pathname.slice(1); } catch { /* url invalida */ }
  if ((host !== "localhost" && host !== "127.0.0.1") || dbName !== "harmonize") {
    skipReason = "DATABASE_URL nao aponta para o banco local de dev (localhost/127.0.0.1, banco harmonize): teste de banco ignorado";
  } else {
    prisma = new PrismaClient({ datasourceUrl: url });
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.googleCalendarConnection.count();
    } catch {
      skipReason = "banco local nao respondeu (ou sem a migration do Google Agenda): teste de banco ignorado";
      await prisma.$disconnect().catch(() => {});
      prisma = null;
    }
  }
}
const opts = { skip: skipReason ?? false };

const tag = `zz-e2e-gcal-${Date.now()}`;
const env = { GOOGLE_TOKEN_ENCRYPTION_KEY: "ab".repeat(32) };
const clinicIds = [];
let worldN = 0;

after(async () => {
  if (!prisma) return;
  try {
    await prisma.calendarSyncJob.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.calendarNotificationLog.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } }); // cascata: conexões, vínculos, agendamentos, pacientes, memberships
    await prisma.user.deleteMany({ where: { email: { startsWith: tag } } });
  } finally {
    await prisma.$disconnect();
  }
});

// ---------- Google falso (em memória) ----------

function createFakeGoogle() {
  const calendars = new Map(); // access token -> Map(eventId -> evento)
  const accounts = new Map(); // e-mail da conta -> access token (para materializar convites)
  const calls = [];
  const failures = [];
  const revoked = [];
  const cal = (token) => calendars.get(token) ?? calendars.set(token, new Map()).get(token);
  const maybeFail = (method) => {
    const index = failures.findIndex((item) => item.method === method);
    if (index >= 0) throw failures.splice(index, 1)[0].error;
  };
  const materializeInvites = (event, owner) => {
    for (const [email, token] of accounts) {
      if (token === owner) continue;
      const invited = (event.attendees ?? []).some((attendee) => attendee.email === email);
      if (invited) cal(token).set(`inv-${event.id}`, { ...event, id: `inv-${event.id}` });
      else cal(token).delete(`inv-${event.id}`);
    }
  };
  return {
    calendars, accounts, calls, failures, revoked,
    eventsOf: (token) => [...cal(token).values()],
    ownEventsOf: (token) => [...cal(token).values()].filter((event) => !event.id.startsWith("inv-")),
    count: (method) => calls.filter((call) => call.method === method).length,
    refreshAccessToken: async (refreshToken) => {
      calls.push({ method: "refresh" });
      maybeFail("refresh");
      return { accessToken: `AT-refreshed-${refreshToken}`, refreshToken: null, expiresInSeconds: 3600, scope: "", idToken: null };
    },
    revokeToken: async (token) => void revoked.push(token),
    insertEvent: async (token, _calendarId, id, payload, sendUpdates) => {
      calls.push({ method: "insert", token, id, sendUpdates });
      maybeFail("insert");
      if (cal(token).has(id)) throw new GoogleCalendarError("conflict", 409, "duplicate");
      const event = { ...payload, id, iCalUID: `${id}@fake.invalid` };
      cal(token).set(id, event);
      materializeInvites(event, token);
      return event;
    },
    patchEvent: async (token, _calendarId, id, payload, sendUpdates) => {
      calls.push({ method: "patch", token, id, sendUpdates });
      maybeFail("patch");
      const event = cal(token).get(id);
      if (!event) throw new GoogleCalendarError("notFound", 404, null);
      Object.assign(event, payload);
      materializeInvites(event, token);
      return event;
    },
    deleteEvent: async (token, _calendarId, id, sendUpdates) => {
      calls.push({ method: "delete", token, id, sendUpdates });
      maybeFail("delete");
      const existed = cal(token).delete(id);
      for (const other of accounts.values()) cal(other).delete(`inv-${id}`);
      return existed ? "deleted" : "gone";
    },
    getEvent: async (token, _calendarId, id) => cal(token).get(id) ?? null,
    listEvents: async (token, _calendarId, query) => ({ items: [...cal(token).values()].filter((event) => event.iCalUID === query.iCalUID), nextPageToken: null }),
  };
}

// ---------- mundo de teste ----------

const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function world({ central = false, ana = false, bia = false, anaEmail } = {}) {
  const n = ++worldN;
  const clinic = await prisma.clinic.create({ data: { name: `${tag} Clinica ${n}`, slug: `${tag}-${n}`.toLowerCase() } });
  clinicIds.push(clinic.id);
  const user = async (label, name, role) => {
    const created = await prisma.user.create({ data: { name, email: `${tag}-${n}-${label}@example.invalid`, passwordHash: "x" } });
    await prisma.clinicMembership.create({ data: { userId: created.id, clinicId: clinic.id, role, isOwner: label === "admin" } });
    return created;
  };
  const w = { clinicId: clinic.id, google: createFakeGoogle() };
  w.admin = await user("admin", "Clara Admin", "ADMIN");
  w.ana = await user("ana", "Dra. Ana", "PROFESSIONAL");
  w.bia = await user("bia", "Dra. Bia", "PROFESSIONAL");
  w.staff = await user("staff", "Rita Recepcao", "STAFF");
  w.patient = await prisma.patient.create({ data: { clinicId: clinic.id, name: "Paciente Teste", phone: "11999999999", age: 30 } });
  const connect = async (owner, type, email) => {
    const created = await prisma.googleCalendarConnection.create({
      data: { clinicId: clinic.id, userId: owner.id, connectionType: type, googleEmail: email, googleAccountId: `sub-${email}`, scope: "calendar.events", refreshTokenEncrypted: encryptGoogleToken(`RT-${email}`, env), tokenExpiresAt: new Date(Date.now() + 3_600_000) },
    });
    const token = `AT-${created.id}`;
    await prisma.googleCalendarConnection.update({ where: { id: created.id }, data: { accessTokenEncrypted: encryptGoogleToken(token, env) } });
    w.google.accounts.set(email, token);
    return { ...created, token, email };
  };
  if (central) w.central = await connect(w.admin, "ADMIN", `${tag}-${n}-central@example.invalid`);
  if (ana) w.anaConn = await connect(w.ana, "PROFESSIONAL", anaEmail ?? `${tag}-${n}-ana.google@example.invalid`);
  if (bia) w.biaConn = await connect(w.bia, "PROFESSIONAL", `${tag}-${n}-bia.google@example.invalid`);
  return w;
}

const appt = (w, over = {}) => prisma.appointment.create({
  data: { clinicId: w.clinicId, patientId: w.patient.id, date: appointmentInstant(day(5)), time: "10:00", procedure: "Botox", professional: "Dra. Ana", status: "Agendado", ...over },
});
const rowOf = (a) => ({ status: a.status, date: a.date, time: a.time, procedure: a.procedure, professional: a.professional });
const track = (w, appointment, extra = {}) => hooks.enqueueAppointmentChange(prisma, { clinicId: w.clinicId, appointmentId: appointment.id, patientId: w.patient.id, prev: null, next: rowOf(appointment), ...extra });
const run = (w, extra = {}) => processCalendarSyncJobs({ limit: 20, clinicId: w.clinicId, deps: { db: prisma, client: w.google, env, appOrigin: "http://localhost:3000", workerId: `w-${Math.random()}` }, ...extra });
const links = (w, appointment) => prisma.googleCalendarEvent.findMany({ where: { appointmentId: appointment.id }, orderBy: { role: "asc" } });
const jobs = (w, appointment) => prisma.calendarSyncJob.findMany({ where: { appointmentId: appointment.id }, orderBy: { createdAt: "asc" } });

// ---------- cenários ----------

test("central + individual: UM evento central convidando o profissional (e-mail da conta conectada), convite verificado sem cópia; reexecutar não duplica", opts, async () => {
  const w = await world({ central: true, ana: true });
  const a = await appt(w);
  assert.equal(await track(w, a), true);
  const summary = await run(w);
  assert.equal(summary.completed, 1);

  const own = w.google.ownEventsOf(w.central.token);
  assert.equal(own.length, 1);
  assert.deepEqual(own[0].attendees, [{ email: w.anaConn.email }]);
  assert.equal(own[0].summary, "Atendimento - Botox");
  assert.ok(!JSON.stringify(own[0]).includes(w.patient.phone));
  assert.equal(w.google.ownEventsOf(w.anaConn.token).length, 0, "nenhum evento independente na agenda do profissional");
  assert.equal(w.google.eventsOf(w.anaConn.token).length, 1, "só a cópia do convite");
  const rows = await links(w, a);
  assert.deepEqual(rows.map((row) => [row.role, row.syncStatus]), [["CENTRAL", "SYNCED"], ["INDIVIDUAL", "RECEIVED"]]);
  assert.equal(w.google.calls.find((c) => c.method === "insert").sendUpdates, "all");
  const connection = await prisma.googleCalendarConnection.findUnique({ where: { id: w.central.id } });
  assert.ok(connection.lastSyncAt);

  // mudança de horário: patch no mesmo evento, nada novo
  const moved = await prisma.appointment.update({ where: { id: a.id }, data: { time: "11:00" } });
  assert.equal(await track(w, moved, { prev: rowOf(a) }), true);
  await run(w);
  assert.equal(w.google.count("insert"), 1);
  assert.equal(w.google.ownEventsOf(w.central.token).length, 1);
  assert.match(w.google.ownEventsOf(w.central.token)[0].start.dateTime, /T11:00:00-03:00$/);
  assert.equal((await jobs(w, a)).every((job) => job.status === "COMPLETED"), true);
});

test("só individual: evento independente único; depois a central conecta: central SEM attendee e o independente é mantido (um evento por agenda de pessoa)", opts, async () => {
  const w = await world({ ana: true });
  const a = await appt(w);
  await track(w, a);
  await run(w);
  assert.equal(w.google.ownEventsOf(w.anaConn.token).length, 1);
  assert.deepEqual(w.google.ownEventsOf(w.anaConn.token)[0].attendees, []);
  assert.deepEqual((await links(w, a)).map((row) => [row.role, row.syncStatus]), [["INDIVIDUAL", "SYNCED"]]);

  w.central = await prisma.googleCalendarConnection.create({ data: { clinicId: w.clinicId, userId: w.admin.id, connectionType: "ADMIN", googleEmail: `${tag}-central-late@example.invalid`, refreshTokenEncrypted: encryptGoogleToken("RT", env), tokenExpiresAt: new Date(Date.now() + 3_600_000) } });
  w.central.token = `AT-${w.central.id}`;
  await prisma.googleCalendarConnection.update({ where: { id: w.central.id }, data: { accessTokenEncrypted: encryptGoogleToken(w.central.token, env) } });
  assert.equal((await queue.enqueueBackfill(prisma, { clinicId: w.clinicId })).enqueued, 1);
  await run(w);
  assert.equal(w.google.ownEventsOf(w.central.token).length, 1);
  assert.deepEqual(w.google.ownEventsOf(w.central.token)[0].attendees, [], "central sem convidar quem já tem evento independente");
  assert.equal(w.google.ownEventsOf(w.anaConn.token).length, 1, "independente mantido");
  assert.equal(w.google.eventsOf(w.anaConn.token).length, 1, "nenhuma cópia por convite");
});

test("troca de profissional: central passa a convidar o novo; o anterior deixa de receber; sem eventos duplicados", opts, async () => {
  const w = await world({ central: true, ana: true, bia: true });
  const a = await appt(w);
  await track(w, a);
  await run(w);
  const reassigned = await prisma.appointment.update({ where: { id: a.id }, data: { professional: "Dra. Bia" } });
  assert.equal(await track(w, reassigned, { prev: rowOf(a) }), true);
  await run(w);
  const own = w.google.ownEventsOf(w.central.token);
  assert.equal(own.length, 1);
  assert.deepEqual(own[0].attendees, [{ email: w.biaConn.email }]);
  assert.equal(w.google.eventsOf(w.anaConn.token).length, 0);
  assert.equal(w.google.eventsOf(w.biaConn.token).length, 1);
  const rows = await links(w, a);
  assert.deepEqual(rows.map((row) => [row.connectionId === w.biaConn.id ? "bia" : row.role, row.syncStatus]).sort(), [["CENTRAL", "SYNCED"], ["bia", "RECEIVED"]]);
});

test("cancelar cancela o evento central (status cancelled) e reativar o confirma de novo, no mesmo id", opts, async () => {
  const w = await world({ central: true, ana: true });
  const a = await appt(w);
  await track(w, a);
  await run(w);
  const id = w.google.ownEventsOf(w.central.token)[0].id;
  const cancelled = await prisma.appointment.update({ where: { id: a.id }, data: { status: "Cancelado" } });
  assert.equal(await track(w, cancelled, { prev: rowOf(a) }), true);
  await run(w);
  assert.equal(w.google.ownEventsOf(w.central.token)[0].status, "cancelled");
  assert.equal((await links(w, a)).find((row) => row.role === "CENTRAL").syncStatus, "CANCELLED");
  const back = await prisma.appointment.update({ where: { id: a.id }, data: { status: "Agendado" } });
  assert.equal(await track(w, back, { prev: rowOf(cancelled) }), true);
  await run(w);
  const own = w.google.ownEventsOf(w.central.token);
  assert.equal(own.length, 1);
  assert.equal(own[0].id, id);
  assert.equal(own[0].status, "confirmed");
  assert.equal((await links(w, a)).find((row) => row.role === "CENTRAL").syncStatus, "SYNCED");
});

test("status Atendido/Faltou/Em atendimento não sincroniza; notas também não", opts, async () => {
  const w = await world({ central: true });
  const a = await appt(w);
  for (const status of ["Em atendimento", "Atendido", "Faltou"]) {
    assert.equal(await track(w, { ...a, status }, { prev: rowOf(a) }), false, status);
  }
  assert.equal(await track(w, a, { prev: rowOf(a) }), false);
  assert.equal((await jobs(w, a)).length, 0);
});

test("exclusão usa o snapshot (o vínculo some em cascata) e apaga o evento; evento já apagado no Google (404) também conclui", opts, async () => {
  const w = await world({ central: true, ana: true });
  const a = await appt(w);
  const b = await appt(w, { time: "15:00" });
  for (const item of [a, b]) await track(w, item);
  await run(w);
  assert.ok(w.google.ownEventsOf(w.central.token).find((event) => event.start.dateTime.includes("T15:00")));
  const snapshots = await queue.captureDeleteSnapshots(prisma, w.clinicId, [a.id, b.id]);
  assert.equal(snapshots.size, 2);
  // b some do Google por fora antes da exclusão
  const bEvent = (await links(w, b)).find((row) => row.role === "CENTRAL");
  w.google.calendars.get(w.central.token).delete(bEvent.googleEventId);
  await prisma.appointment.deleteMany({ where: { id: { in: [a.id, b.id] }, clinicId: w.clinicId } });
  assert.equal(await prisma.googleCalendarEvent.count({ where: { appointmentId: { in: [a.id, b.id] } } }), 0, "cascata apagou os vínculos");
  for (const item of [a, b]) assert.equal(await hooks.enqueueAppointmentChange(prisma, { clinicId: w.clinicId, appointmentId: item.id, patientId: w.patient.id, prev: rowOf(item), next: null, snapshot: snapshots.get(item.id) }), true);
  const summary = await run(w);
  assert.equal(summary.completed, 2);
  assert.equal(w.google.ownEventsOf(w.central.token).length, 0);
  assert.equal(w.google.eventsOf(w.anaConn.token).length, 0, "convites retirados");
});

test("reconexão/crash entre Google e banco (vínculos perdidos): reenvio usa o mesmo id, 409 vira patch e nunca duplica", opts, async () => {
  const w = await world({ central: true });
  const a = await appt(w);
  await track(w, a);
  await run(w);
  await prisma.googleCalendarEvent.deleteMany({ where: { appointmentId: a.id } });
  assert.equal(await track(w, a, { prev: rowOf({ ...a, time: "09:00" }) }), true);
  await run(w);
  assert.equal(w.google.ownEventsOf(w.central.token).length, 1);
  assert.equal(w.google.count("insert"), 2, "tentou inserir e recebeu 409");
  assert.equal(w.google.count("patch"), 1);
  assert.equal((await links(w, a)).length, 1);
});

test("evento apagado por fora no Google com vínculo existente: recria no mesmo id sem duplicar", opts, async () => {
  const w = await world({ central: true });
  const a = await appt(w);
  await track(w, a);
  await run(w);
  const original = (await links(w, a))[0].googleEventId;
  w.google.calendars.get(w.central.token).delete(original); // usuário apagou no Google
  await track(w, a, { prev: rowOf({ ...a, time: "09:00" }) });
  await run(w);
  assert.equal(w.google.ownEventsOf(w.central.token).length, 1);
  assert.equal((await links(w, a)).length, 1);
});

test("jobs concorrentes: reserva atômica, cada job é processado uma vez e o evento não duplica", opts, async () => {
  const w = await world({ central: true });
  const a = await appt(w);
  await track(w, a);
  const results = await Promise.all([run(w), run(w), run(w), run(w)]);
  assert.equal(results.reduce((sum, item) => sum + item.completed, 0), 1);
  assert.equal(w.google.count("insert"), 1);
  assert.equal(w.google.ownEventsOf(w.central.token).length, 1);
  assert.equal((await jobs(w, a))[0].status, "COMPLETED");

  // dois jobs do MESMO agendamento (inseridos direto, sem dedupe) rodando juntos: um por vez, sem duplicidade
  const b = await appt(w, { time: "13:00" });
  await prisma.calendarSyncJob.createMany({ data: [{ clinicId: w.clinicId, appointmentId: b.id, operation: "CREATE" }, { clinicId: w.clinicId, appointmentId: b.id, operation: "UPDATE" }] });
  await Promise.all([run(w), run(w)]);
  await run(w);
  assert.equal(w.google.ownEventsOf(w.central.token).length, 2);
  assert.equal((await jobs(w, b)).every((job) => job.status === "COMPLETED"), true);
});

test("falha transitória: PENDING com backoff 1,2,4... min e depois conclui; esgotadas as 6 tentativas vira FAILED", opts, async () => {
  const w = await world({ central: true });
  const a = await appt(w);
  await track(w, a);
  const t0 = new Date();
  w.google.failures.push({ method: "insert", error: new GoogleCalendarError("transient", 503, null) });
  assert.equal((await run(w, { now: t0 })).retried, 1);
  let [job] = await jobs(w, a);
  assert.equal(job.status, "PENDING");
  assert.equal(job.attempts, 1);
  assert.equal(job.nextRetryAt.getTime() - t0.getTime(), 60_000);
  assert.ok(!/AT-|RT-/.test(job.lastError ?? ""));
  assert.equal((await run(w, { now: t0 })).picked, 0, "ainda não venceu");
  assert.equal((await run(w, { now: new Date(t0.getTime() + 61_000) })).completed, 1);
  assert.equal(w.google.ownEventsOf(w.central.token).length, 1);

  const b = await appt(w, { time: "16:00" });
  await track(w, b);
  let clock = new Date(t0.getTime() + 120_000);
  const waits = [];
  for (let attempt = 1; attempt <= 6; attempt++) {
    w.google.failures.push({ method: "insert", error: new GoogleCalendarError("rateLimit", 429, "rateLimitExceeded") });
    await run(w, { now: clock });
    [job] = await jobs(w, b);
    if (job.status === "FAILED") break;
    waits.push((job.nextRetryAt.getTime() - clock.getTime()) / 60_000);
    clock = new Date(job.nextRetryAt.getTime() + 1000);
  }
  assert.deepEqual(waits, [1, 2, 4, 8, 16]);
  assert.equal(job.status, "FAILED");
  assert.equal(job.attempts, 6);
  assert.equal(await prisma.appointment.count({ where: { id: b.id } }), 1, "o agendamento segue intacto");
});

test("invalid_grant no refresh: conexão ERROR (sem segredos), job FAILED sem retry, agendamento intacto e nada novo é enfileirado", opts, async () => {
  const w = await world({ central: true });
  await prisma.googleCalendarConnection.update({ where: { id: w.central.id }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });
  const a = await appt(w);
  await track(w, a);
  w.google.failures.push({ method: "refresh", error: new GoogleCalendarError("auth", 400, "invalid_grant") });
  assert.equal((await run(w)).failed, 1);
  const [job] = await jobs(w, a);
  assert.equal(job.status, "FAILED");
  assert.equal(job.attempts, 1);
  assert.match(job.lastError, /reconecte/);
  const connection = await prisma.googleCalendarConnection.findUnique({ where: { id: w.central.id } });
  assert.equal(connection.status, "ERROR");
  assert.equal(connection.lastError, RECONNECT_MESSAGE);
  assert.equal(await prisma.appointment.count({ where: { id: a.id } }), 1);
  assert.equal((await run(w)).picked, 0, "sem retry infinito");
  const b = await appt(w, { time: "17:00" });
  assert.equal(await track(w, b), false, "sem conexão ativa não enfileira");
});

test("falha do Resend não repete o evento Google nem o contrário: log FAILED único; falha do Google não impede o e-mail nem o agendamento", opts, async () => {
  const w = await world({ central: true, ana: true });
  const a = await appt(w);
  const change = { clinicId: w.clinicId, appointmentId: a.id, patientId: w.patient.id, actorUserId: w.admin.id, prev: null, next: rowOf(a) };
  await track(w, a);
  let sends = 0;
  const failing = { isReady: () => true, send: async () => (sends++, { sent: false, reason: "provider_error" }) };
  assert.equal((await hooks.notifyAppointmentChange(prisma, change, failing)).failed, 1);
  await run(w);
  const insertsAfterFirst = w.google.count("insert");
  assert.equal(insertsAfterFirst, 1);
  await hooks.notifyAppointmentChange(prisma, change, failing);
  assert.equal(sends, 1, "mesmo estado não reenvia");
  await run(w);
  assert.equal(w.google.count("insert"), insertsAfterFirst, "o e-mail não repetiu o Google");
  const logs = await prisma.calendarNotificationLog.findMany({ where: { appointmentId: a.id } });
  assert.deepEqual(logs.map((log) => [log.kind, log.status, log.recipientUserId]), [["NEW", "FAILED", w.ana.id]]);

  // Google falha de forma definitiva, e-mail sai normalmente
  const b = await appt(w, { time: "18:00" });
  await track(w, b);
  w.google.failures.push({ method: "insert", error: new GoogleCalendarError("permanent", 400, "invalid") });
  const sent = [];
  const summary = await hooks.notifyAppointmentChange(prisma, { ...change, appointmentId: b.id, next: rowOf(b) }, { isReady: () => true, send: async (mail) => (sent.push(mail), { sent: true }) });
  assert.equal(summary.sent, 1);
  assert.equal(sent[0].to, w.ana.email);
  assert.ok(sent[0].text.includes("convite"));
  assert.equal((await run(w)).failed, 1);
  assert.equal(await prisma.appointment.count({ where: { id: b.id } }), 1);
});

test("notificações: reatribuição avisa o anterior (REASSIGNED_OUT) e o novo (NEW); cancelamento avisa o profissional; só-status não envia", opts, async () => {
  const w = await world({ central: true });
  const a = await appt(w);
  const sent = [];
  const deps = { isReady: () => true, send: async (mail) => (sent.push(mail), { sent: true }) };
  const base = { clinicId: w.clinicId, appointmentId: a.id, patientId: w.patient.id, actorUserId: w.admin.id };
  const reassigned = { ...rowOf(a), professional: "Dra. Bia" };
  await hooks.notifyAppointmentChange(prisma, { ...base, prev: rowOf(a), next: reassigned }, deps);
  assert.deepEqual(sent.map((mail) => [mail.to, mail.subject.split(" — ")[0]]).sort(), [[w.ana.email, "Agendamento reatribuído a outro profissional"], [w.bia.email, "Novo agendamento atribuído a você"]].sort());
  sent.length = 0;
  await hooks.notifyAppointmentChange(prisma, { ...base, prev: reassigned, next: { ...reassigned, status: "Cancelado" } }, deps);
  assert.deepEqual(sent.map((mail) => [mail.to, mail.subject.split(" — ")[0]]), [[w.bia.email, "Agendamento cancelado"]]);
  sent.length = 0;
  await hooks.notifyAppointmentChange(prisma, { ...base, prev: rowOf(a), next: { ...rowOf(a), status: "Atendido" } }, deps);
  assert.equal(sent.length, 0);
});

test("fila: UPDATEs coalescem em um job PENDING; DELETE sobrepõe e impede novos CREATE/UPDATE e outro DELETE", opts, async () => {
  const w = await world({ central: true });
  const a = await appt(w);
  const enq = (operation, snapshot) => queue.enqueueCalendarSync(prisma, { clinicId: w.clinicId, appointmentId: a.id, operation, snapshot });
  assert.equal((await enq("CREATE")).enqueued, true);
  for (let i = 0; i < 3; i++) assert.equal((await enq("UPDATE")).enqueued, false);
  assert.equal((await jobs(w, a)).filter((job) => job.status === "PENDING").length, 1);
  const snapshot = { events: [{ connectionId: w.central.id, role: "CENTRAL", googleEventId: "abc12", attendeeEmail: null, syncStatus: "SYNCED" }] };
  assert.equal((await enq("DELETE", snapshot)).enqueued, true);
  const all = await jobs(w, a);
  assert.deepEqual(all.map((job) => [job.operation, job.status]), [["CREATE", "COMPLETED"], ["DELETE", "PENDING"]]);
  assert.equal((await enq("UPDATE")).enqueued, false);
  assert.equal((await enq("DELETE", snapshot)).enqueued, false);
  assert.deepEqual(all[1].snapshot, snapshot);
});

test("lock travado há mais de 5 min é retomado (conta tentativa); lock recente não; tentativas esgotadas = FAILED", opts, async () => {
  const w = await world({ central: true });
  const [a, b, c] = [await appt(w), await appt(w, { time: "12:00" }), await appt(w, { time: "14:00" })];
  const old = new Date(Date.now() - 6 * 60_000);
  const fresh = new Date(Date.now() - 60_000);
  await prisma.calendarSyncJob.createMany({ data: [
    { clinicId: w.clinicId, appointmentId: a.id, operation: "CREATE", status: "PROCESSING", lockedAt: old, lockedBy: "morto" },
    { clinicId: w.clinicId, appointmentId: b.id, operation: "CREATE", status: "PROCESSING", lockedAt: fresh, lockedBy: "vivo" },
    { clinicId: w.clinicId, appointmentId: c.id, operation: "CREATE", status: "PROCESSING", lockedAt: old, lockedBy: "morto", attempts: 5 },
  ] });
  const summary = await run(w);
  assert.equal(summary.completed, 1);
  assert.equal(summary.failed, 1);
  const [ja] = await jobs(w, a);
  assert.equal(ja.status, "COMPLETED");
  assert.equal(ja.attempts, 1);
  assert.equal((await jobs(w, b))[0].status, "PROCESSING");
  assert.equal((await jobs(w, b))[0].lockedBy, "vivo");
  assert.equal((await jobs(w, c))[0].status, "FAILED");
  assert.equal(w.google.ownEventsOf(w.central.token).length, 1);
});

test("backfill: só futuros não cancelados, paginado, sem duplicar jobs pendentes; escopo por profissional", opts, async () => {
  const w = await world({ central: true });
  await appt(w, { date: appointmentInstant(day(-3)) });
  await appt(w, { status: "Cancelado" });
  const futures = [await appt(w), await appt(w, { time: "11:00", professional: "Dra. Bia" }), await appt(w, { time: "12:00", date: appointmentInstant(day(9)) })];
  const first = await queue.enqueueBackfill(prisma, { clinicId: w.clinicId, pageSize: 2 });
  assert.equal(first.enqueued, 3);
  assert.equal((await queue.enqueueBackfill(prisma, { clinicId: w.clinicId, pageSize: 2 })).enqueued, 0);
  assert.equal(await prisma.calendarSyncJob.count({ where: { clinicId: w.clinicId } }), 3);
  await prisma.calendarSyncJob.deleteMany({ where: { clinicId: w.clinicId } });
  assert.equal((await queue.enqueueBackfill(prisma, { clinicId: w.clinicId, userId: w.ana.id })).enqueued, 2, "só os da Dra. Ana");
  assert.equal(await prisma.calendarSyncJob.count({ where: { clinicId: w.clinicId, appointmentId: futures[1].id } }), 0);
});

test("isolamento: job de uma clínica não é processado pela outra e nunca sincroniza agendamento de outra clínica", opts, async () => {
  const a = await world({ central: true });
  const b = await world({ central: true });
  const appointmentA = await appt(a);
  await track(a, appointmentA);
  assert.equal((await run(b)).picked, 0);
  assert.equal(a.google.count("insert"), 0);
  // job da clínica B apontando para o agendamento da A: sem agendamento na B = nenhuma ação
  await prisma.calendarSyncJob.create({ data: { clinicId: b.clinicId, appointmentId: appointmentA.id, operation: "UPDATE" } });
  assert.equal((await run(b)).completed, 1);
  assert.equal(b.google.calls.filter((call) => call.method !== "refresh").length, 0);
  assert.equal(await prisma.googleCalendarEvent.count({ where: { appointmentId: appointmentA.id } }), 0);
  assert.equal((await run(a)).completed, 1);
  assert.equal(a.google.ownEventsOf(a.central.token).length, 1);
});

test("profissional não identificado: central sem convidado e com aviso; evento individual independente existente é preservado", opts, async () => {
  const w = await world({ central: true });
  const a = await appt(w, { professional: "Fulano de Tal" });
  await track(w, a);
  await run(w);
  assert.deepEqual(w.google.ownEventsOf(w.central.token)[0].attendees, []);
  assert.equal((await links(w, a))[0].lastError, "profissional não identificado");

  const solo = await world({ ana: true });
  const b = await appt(solo);
  await track(solo, b);
  await run(solo);
  assert.equal(solo.google.ownEventsOf(solo.anaConn.token).length, 1);
  const renamed = await prisma.appointment.update({ where: { id: b.id }, data: { professional: "Fulano de Tal" } });
  assert.equal(await track(solo, renamed, { prev: rowOf(b) }), true);
  await run(solo);
  assert.equal(solo.google.ownEventsOf(solo.anaConn.token).length, 1, "conservador: não apaga o independente");
  assert.equal(solo.google.count("delete"), 0);
});

test("desconectar: PROFESSIONAL só a própria, ADMIN só a central; tokens apagados, eventos/vínculos mantidos, outras conexões intactas; revoga só se a conta não é compartilhada", opts, async () => {
  const w = await world({ central: true, ana: true, bia: true });
  const a = await appt(w);
  await track(w, a);
  await run(w);
  const actor = (user, role) => ({ id: user.id, clinicId: w.clinicId, role, isOwner: user.id === w.admin.id });
  const deps = { db: prisma, client: w.google, env };

  assert.equal((await connections.disconnectCalendar(deps, { user: actor(w.ana, "PROFESSIONAL"), type: "ADMIN" })).status, 403);
  assert.equal((await connections.disconnectCalendar(deps, { user: actor(w.staff, "STAFF"), type: "PROFESSIONAL" })).status, 403);
  assert.equal((await connections.disconnectCalendar(deps, { user: actor(w.admin, "ADMIN"), type: "PROFESSIONAL" })).status, 404, "ADMIN não desconecta a individual de outra pessoa");
  assert.equal((await connections.disconnectCalendar(deps, { user: actor(w.ana, "PROFESSIONAL"), type: "nada" })).status, 400);
  assert.equal((await prisma.googleCalendarConnection.findUnique({ where: { id: w.anaConn.id } })).status, "CONNECTED");

  const result = await connections.disconnectCalendar(deps, { user: actor(w.ana, "PROFESSIONAL"), type: "PROFESSIONAL" });
  assert.deepEqual(result, { ok: true, revoked: true });
  assert.deepEqual(w.google.revoked, [`RT-${w.anaConn.email}`]);
  const ana = await prisma.googleCalendarConnection.findUnique({ where: { id: w.anaConn.id } });
  assert.equal(ana.status, "DISCONNECTED");
  assert.equal(ana.accessTokenEncrypted, null);
  assert.equal(ana.refreshTokenEncrypted, null);
  assert.equal((await prisma.googleCalendarConnection.findUnique({ where: { id: w.central.id } })).status, "CONNECTED");
  assert.equal((await prisma.googleCalendarConnection.findUnique({ where: { id: w.biaConn.id } })).status, "CONNECTED");
  assert.equal((await links(w, a)).length, 2, "vínculos mantidos como histórico");
  assert.equal(w.google.ownEventsOf(w.central.token).length, 1, "evento já criado no Google fica");

  // central desconectada: jobs seguintes não chamam o Google
  const before = w.google.calls.length;
  const b = await appt(w, { time: "15:00" });
  assert.equal((await connections.disconnectCalendar(deps, { user: actor(w.admin, "ADMIN"), type: "ADMIN" })).ok, true);
  await prisma.calendarSyncJob.create({ data: { clinicId: w.clinicId, appointmentId: b.id, operation: "CREATE" } });
  await run(w);
  assert.equal(w.google.calls.length, before, "nenhuma chamada ao Google com conexões desligadas");
  assert.equal((await connections.disconnectCalendar(deps, { user: actor(w.admin, "ADMIN"), type: "ADMIN" })).status, 404);
  assert.equal(await prisma.appointment.count({ where: { clinicId: w.clinicId } }), 2, "agendamentos intactos");

  // mesma conta Google usada em outra conexão ativa: não revoga a concessão
  const shared = await world({ ana: true, bia: true });
  await prisma.googleCalendarConnection.update({ where: { id: shared.anaConn.id }, data: { googleAccountId: "sub-compartilhada" } });
  await prisma.googleCalendarConnection.update({ where: { id: shared.biaConn.id }, data: { googleAccountId: "sub-compartilhada" } });
  const out = await connections.disconnectCalendar({ db: prisma, client: shared.google, env }, { user: { id: shared.ana.id, clinicId: shared.clinicId, role: "PROFESSIONAL" }, type: "PROFESSIONAL" });
  assert.deepEqual(out, { ok: true, revoked: false });
  assert.deepEqual(shared.google.revoked, []);
});

test("status: ADMIN vê e-mail e contadores da central; PROFESSIONAL só sabe que existe e vê a própria; nenhum token ou hash no JSON", opts, async () => {
  const w = await world({ central: true, ana: true });
  const a = await appt(w);
  await track(w, a);
  await run(w);
  await prisma.calendarSyncJob.create({ data: { clinicId: w.clinicId, appointmentId: a.id, operation: "UPDATE", status: "FAILED" } });
  const admin = await connections.loadCalendarStatus(prisma, { id: w.admin.id, clinicId: w.clinicId, role: "ADMIN", isOwner: true }, true);
  assert.equal(admin.central.googleEmail, w.central.email);
  assert.equal(admin.central.connected, true);
  assert.equal(admin.central.syncedEvents, 1);
  assert.equal(admin.central.failedJobs, 1);
  assert.equal(admin.canConnectCentral, true);
  const pro = await connections.loadCalendarStatus(prisma, { id: w.ana.id, clinicId: w.clinicId, role: "PROFESSIONAL", isOwner: false }, true);
  assert.equal(pro.central.connected, true);
  assert.equal(pro.central.googleEmail, null);
  assert.equal(pro.central.pendingJobs, null);
  assert.equal(pro.central.lastError, null);
  assert.equal(pro.individual.googleEmail, w.anaConn.email);
  assert.equal(pro.canConnectCentral, false);
  const otherPro = await connections.loadCalendarStatus(prisma, { id: w.bia.id, clinicId: w.clinicId, role: "PROFESSIONAL", isOwner: false }, true);
  assert.equal(otherPro.individual.status, "NOT_CONNECTED");
  assert.equal(otherPro.individual.googleEmail, null);
  const outsider = await connections.loadCalendarStatus(prisma, { id: w.admin.id, clinicId: "outra-clinica", role: "ADMIN", isOwner: true }, true);
  assert.equal(outsider.central.status, "NOT_CONNECTED");
  const text = JSON.stringify([admin, pro]);
  assert.ok(!/Encrypted|accessToken|refreshToken|AT-|RT-|passwordHash/.test(text));
  assert.equal((await connections.loadCalendarStatus(prisma, { id: w.admin.id, clinicId: w.clinicId, role: "ADMIN", isOwner: true }, false)).configured, false);
});

test("banco: no máximo UMA conexão central ativa por clínica (índice parcial); depois de desconectar outra pode conectar", opts, async () => {
  const w = await world({ central: true });
  const create = (user) => prisma.googleCalendarConnection.create({ data: { clinicId: w.clinicId, userId: user.id, connectionType: "ADMIN", googleEmail: `${tag}-x-${user.id}@example.invalid` } });
  await assert.rejects(create(w.ana), (error) => error.code === "P2002");
  assert.equal(await connections.centralOwnedByAnother(prisma, { id: w.ana.id, clinicId: w.clinicId }), true);
  assert.equal(await connections.centralOwnedByAnother(prisma, { id: w.admin.id, clinicId: w.clinicId }), false);
  await prisma.googleCalendarConnection.update({ where: { id: w.central.id }, data: { status: "DISCONNECTED" } });
  await create(w.ana);
  assert.equal(await connections.centralOwnedByAnother(prisma, { id: w.admin.id, clinicId: w.clinicId }), true);
});

test("limpeza: purgeOldJobs remove só COMPLETED antigos (FAILED e recentes ficam)", opts, async () => {
  const w = await world({ central: true });
  const a = await appt(w);
  const make = (status) => prisma.calendarSyncJob.create({ data: { clinicId: w.clinicId, appointmentId: a.id, operation: "UPDATE", status } });
  const [oldDone, oldFailed, freshDone] = [await make("COMPLETED"), await make("FAILED"), await make("COMPLETED")];
  const old = new Date(Date.now() - 8 * 86_400_000);
  await prisma.$executeRaw`UPDATE "CalendarSyncJob" SET "updatedAt" = ${old} WHERE "id" IN (${oldDone.id}, ${oldFailed.id})`;
  await queue.purgeOldJobs(prisma);
  const left = (await prisma.calendarSyncJob.findMany({ where: { clinicId: w.clinicId }, select: { id: true } })).map((job) => job.id).sort();
  assert.deepEqual(left, [oldFailed.id, freshDone.id].sort());
});

test("401/403 da Calendar API marca a conexão ERROR (sem desfazer desconexão manual); ao reconectar, jobs FAILED por autenticação voltam à fila (CREATE/UPDATE/DELETE)", opts, async () => {
  const w = await world({ central: true });
  const a = await appt(w);
  await track(w, a);
  w.google.failures.push({ method: "insert", error: new GoogleCalendarError("auth", 401, null) });
  assert.equal((await run(w)).failed, 1);
  assert.equal((await prisma.googleCalendarConnection.findUnique({ where: { id: w.central.id } })).status, "ERROR");
  // jobs de outras operações que falharam por autenticação + um que falhou por outro motivo
  const b = await appt(w, { time: "13:00" });
  await prisma.calendarSyncJob.createMany({ data: [
    { clinicId: w.clinicId, appointmentId: b.id, operation: "UPDATE", status: "FAILED", attempts: 1, lastError: AUTH_FAILURE_MESSAGE },
    { clinicId: w.clinicId, appointmentId: b.id, operation: "DELETE", status: "FAILED", attempts: 1, lastError: AUTH_FAILURE_MESSAGE, snapshot: { events: [] } },
    { clinicId: w.clinicId, appointmentId: b.id, operation: "CREATE", status: "FAILED", attempts: 3, lastError: "O Google Agenda recusou a operação." },
  ] });
  const other = await world({ central: true });
  const c = await appt(other);
  await prisma.calendarSyncJob.create({ data: { clinicId: other.clinicId, appointmentId: c.id, operation: "UPDATE", status: "FAILED", lastError: AUTH_FAILURE_MESSAGE } });
  const count = await queue.requeueAuthFailedJobs(prisma, w.clinicId);
  assert.equal(count, 3);
  const states = (await prisma.calendarSyncJob.findMany({ where: { clinicId: w.clinicId } })).map((job) => [job.operation, job.status, job.attempts]).sort();
  assert.deepEqual(states, [["CREATE", "FAILED", 3], ["CREATE", "PENDING", 0], ["DELETE", "PENDING", 0], ["UPDATE", "PENDING", 0]]);
  assert.equal((await prisma.calendarSyncJob.findFirst({ where: { appointmentId: c.id } })).status, "FAILED", "outra clínica intacta");

  // reconexão: com a conexão CONNECTED de novo o job recolocado conclui e o evento nasce
  await prisma.googleCalendarConnection.update({ where: { id: w.central.id }, data: { status: "CONNECTED" } });
  await run(w);
  assert.equal(w.google.ownEventsOf(w.central.token).length >= 1, true);

  // desconexão manual nunca é desfeita por falha de autenticação tardia
  const d = await world({ central: true });
  await prisma.googleCalendarConnection.update({ where: { id: d.central.id }, data: { status: "DISCONNECTED" } });
  const { markConnectionError } = await import("../src/lib/google-calendar-token-service.ts");
  await markConnectionError(prisma, d.central.id, d.clinicId);
  assert.equal((await prisma.googleCalendarConnection.findUnique({ where: { id: d.central.id } })).status, "DISCONNECTED");
  // e nunca atua em conexão de outra clínica
  await markConnectionError(prisma, w.central.id, d.clinicId);
  assert.equal((await prisma.googleCalendarConnection.findUnique({ where: { id: w.central.id } })).status, "CONNECTED");
});
