import assert from "node:assert/strict";
import { test } from "node:test";
import { GoogleCalendarError } from "../src/lib/google-calendar-client.ts";
import { getConnectionAccess, RECONNECT_MESSAGE } from "../src/lib/google-calendar-token-service.ts";
import {
  calendarOutcomeRedirect,
  canConnectCalendar,
  handleCalendarCallback,
  signCalendarFlow,
  startCalendarOAuth,
  verifyCalendarFlow,
} from "../src/lib/google-calendar-oauth-service.ts";
import { signOauthFlow, verifyOauthFlow } from "../src/lib/google-oauth-rules.ts";
import { decryptGoogleToken, encryptGoogleToken } from "../src/lib/secret-box.ts";
import { buildCalendarNotificationEmail, sendCalendarNotifications } from "../src/lib/calendar-notification-service.ts";
import { notificationDedupeKey } from "../src/lib/calendar-notification-rules.ts";

const env = { GOOGLE_TOKEN_ENCRYPTION_KEY: "ab".repeat(32) };
const secret = new TextEncoder().encode("x".repeat(40));
const NOW = new Date("2026-12-01T12:00:00Z");

// ---------- token service ----------

function fakeTokenDb(row) {
  const calls = { updateMany: [] };
  return {
    calls,
    googleCalendarConnection: {
      findFirst: async (args) => (args.where.clinicId === "clinic-1" && args.where.id === row?.id ? row : null),
      updateMany: async (args) => {
        calls.updateMany.push(args);
        return { count: 1 };
      },
    },
  };
}
const baseRow = (over = {}) => ({
  id: "c1",
  status: "CONNECTED",
  calendarId: "primary",
  accessTokenEncrypted: encryptGoogleToken("AT-OLD", env),
  refreshTokenEncrypted: encryptGoogleToken("RT-OLD", env),
  tokenExpiresAt: new Date(NOW.getTime() + 10 * 60_000),
  ...over,
});

test("token: access token válido (fora da margem de 60 s) é reutilizado sem refresh", async () => {
  const db = fakeTokenDb(baseRow());
  const client = { refreshAccessToken: async () => assert.fail("não deve renovar") };
  const access = await getConnectionAccess({ db, client, now: () => NOW, env }, "c1", "clinic-1");
  assert.deepEqual(access, { accessToken: "AT-OLD", calendarId: "primary" });
  assert.equal(db.calls.updateMany.length, 0);
});

test("token: dentro da margem de 60 s renova, persiste cifrado e com update condicional", async () => {
  const db = fakeTokenDb(baseRow({ tokenExpiresAt: new Date(NOW.getTime() + 30_000) }));
  let refreshedWith = null;
  const client = { refreshAccessToken: async (rt) => ((refreshedWith = rt), { accessToken: "AT-NEW", refreshToken: null, expiresInSeconds: 3600, scope: "", idToken: null }) };
  const access = await getConnectionAccess({ db, client, now: () => NOW, env }, "c1", "clinic-1");
  assert.equal(refreshedWith, "RT-OLD");
  assert.equal(access.accessToken, "AT-NEW");
  const [call] = db.calls.updateMany;
  assert.ok(call.where.refreshTokenEncrypted && "tokenExpiresAt" in call.where, "update condicional pelo estado lido");
  assert.notEqual(call.data.accessTokenEncrypted, "AT-NEW");
  assert.equal(decryptGoogleToken(call.data.accessTokenEncrypted, env), "AT-NEW");
  assert.equal(call.data.refreshTokenEncrypted, undefined, "sem novo refresh token o existente é preservado");
  assert.equal(call.data.tokenExpiresAt.getTime(), NOW.getTime() + 3600_000);
});

test("token: invalid_grant marca a conexão ERROR sem segredos e relança auth", async () => {
  const db = fakeTokenDb(baseRow({ tokenExpiresAt: new Date(NOW.getTime() - 1000) }));
  const client = { refreshAccessToken: async () => { throw new GoogleCalendarError("auth", 400, "invalid_grant"); } };
  await assert.rejects(getConnectionAccess({ db, client, now: () => NOW, env }, "c1", "clinic-1"), (error) => error.kind === "auth");
  const [call] = db.calls.updateMany;
  assert.equal(call.data.status, "ERROR");
  assert.equal(call.data.lastError, RECONNECT_MESSAGE);
  assert.ok(!JSON.stringify(call).includes("RT-OLD"));
});

test("token: erro transitório do refresh não altera a conexão", async () => {
  const db = fakeTokenDb(baseRow({ tokenExpiresAt: new Date(NOW.getTime() - 1000) }));
  const client = { refreshAccessToken: async () => { throw new GoogleCalendarError("transient", 503, null); } };
  await assert.rejects(getConnectionAccess({ db, client, now: () => NOW, env }, "c1", "clinic-1"), (error) => error.kind === "transient");
  assert.equal(db.calls.updateMany.length, 0);
});

test("token: chave de cifra trocada (não decifra) = ERROR/reconectar; conexão inativa = auth sem tocar no Google", async () => {
  const db = fakeTokenDb(baseRow({ accessTokenEncrypted: encryptGoogleToken("AT", { GOOGLE_TOKEN_ENCRYPTION_KEY: "cd".repeat(32) }) }));
  const client = { refreshAccessToken: async () => assert.fail("sem chamada") };
  await assert.rejects(getConnectionAccess({ db, client, now: () => NOW, env }, "c1", "clinic-1"), (error) => error.kind === "auth");
  assert.equal(db.calls.updateMany[0].data.status, "ERROR");
  const inactive = fakeTokenDb(baseRow({ status: "DISCONNECTED" }));
  await assert.rejects(getConnectionAccess({ db: inactive, client, now: () => NOW, env }, "c1", "clinic-1"), (error) => error.kind === "auth");
  assert.equal(inactive.calls.updateMany.length, 0);
});

// ---------- oauth: início ----------

const adminUser = { id: "u-admin", clinicId: "clinic-1", role: "ADMIN", isOwner: true };
const proUser = { id: "u-pro", clinicId: "clinic-1", role: "PROFESSIONAL", isOwner: false };
const staffUser = { id: "u-staff", clinicId: "clinic-1", role: "STAFF", isOwner: false };
const config = { clientId: "client-id.apps.example", clientSecret: "x", redirectUri: "http://localhost:3000/api/integrations/google-calendar/callback", appOrigin: "http://localhost:3000", fakeBase: null };

test("permissões de conexão: central exige settings:manage/dono; individual ADMIN/PROFESSIONAL; STAFF nada", () => {
  assert.equal(canConnectCalendar(adminUser, "ADMIN"), true);
  assert.equal(canConnectCalendar(proUser, "ADMIN"), false);
  assert.equal(canConnectCalendar(staffUser, "ADMIN"), false);
  assert.equal(canConnectCalendar(proUser, "PROFESSIONAL"), true);
  assert.equal(canConnectCalendar(adminUser, "PROFESSIONAL"), true);
  assert.equal(canConnectCalendar(staffUser, "PROFESSIONAL"), false);
  assert.equal(canConnectCalendar({ ...staffUser, isOwner: true }, "ADMIN"), true);
});

test("início: sem configuração 503; tipo inválido 400; sem permissão 403; ok devolve URL com escopo mínimo, PKCE e cookie typ gcal", async () => {
  assert.deepEqual((await startCalendarOAuth({ user: adminUser, type: "ADMIN", config: null, secret })).status, 503);
  assert.equal((await startCalendarOAuth({ user: adminUser, type: "X", config, secret })).status, 400);
  assert.equal((await startCalendarOAuth({ user: proUser, type: "ADMIN", config, secret })).status, 403);
  assert.equal((await startCalendarOAuth({ user: staffUser, type: "PROFESSIONAL", config, secret })).status, 403);
  const ok = await startCalendarOAuth({ user: proUser, type: "PROFESSIONAL", config, secret });
  assert.equal(ok.ok, true);
  const url = new URL(ok.url);
  assert.equal(url.searchParams.get("scope"), "openid email https://www.googleapis.com/auth/calendar.events");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const flow = await verifyCalendarFlow(ok.flowCookie.value, secret);
  assert.equal(flow.state, url.searchParams.get("state"));
  assert.deepEqual([flow.userId, flow.clinicId, flow.connectionType], ["u-pro", "clinic-1", "PROFESSIONAL"]);
  assert.ok(!ok.url.includes(flow.codeVerifier));
});

test("cookie de fluxo gcal e cookie de login Google não se aceitam mutuamente", async () => {
  const gcal = await signCalendarFlow({ state: "s", nonce: "n", codeVerifier: "v", userId: "u", clinicId: "c", connectionType: "ADMIN" }, secret);
  const login = await signOauthFlow({ state: "s", nonce: "n", codeVerifier: "v", intent: "login" }, secret);
  assert.equal(await verifyOauthFlow(gcal, secret), null);
  assert.equal(await verifyCalendarFlow(login, secret), null);
  assert.equal(await verifyCalendarFlow("lixo", secret), null);
  assert.equal(await verifyCalendarFlow(null, secret), null);
});

// ---------- oauth: callback ----------

function fakeOauthDb(initial = null) {
  const state = { connection: initial, created: [], updated: [], eventDeletes: [], failCreateWith: null };
  return {
    state,
    googleCalendarConnection: {
      findUnique: async () => state.connection,
      create: async ({ data }) => {
        if (state.failCreateWith) throw state.failCreateWith;
        state.created.push(data);
        state.connection = { id: "conn-new", googleEmail: data.googleEmail, googleAccountId: data.googleAccountId, refreshTokenEncrypted: data.refreshTokenEncrypted };
        return { id: "conn-new" };
      },
      update: async ({ where, data }) => {
        if (state.failCreateWith) throw state.failCreateWith;
        state.updated.push({ where, data });
        return { id: where.id };
      },
    },
    googleCalendarEvent: { deleteMany: async (args) => (state.eventDeletes.push(args), { count: 1 }) },
  };
}

async function callbackSetup({ type = "ADMIN", user = adminUser, tokens, claims, db = fakeOauthDb(), sessionUser, mutateState } = {}) {
  const started = await startCalendarOAuth({ user: type === "ADMIN" ? adminUser : proUser, type, config, secret });
  const flow = await verifyCalendarFlow(started.flowCookie.value, secret);
  const backfills = [];
  const deps = {
    config,
    secret,
    now: () => NOW,
    db,
    env,
    client: {
      exchangeCode: async () => ({ accessToken: "AT-1", refreshToken: "RT-1", expiresInSeconds: 3600, scope: "openid email https://www.googleapis.com/auth/calendar.events", idToken: "ID", ...tokens }),
    },
    verifyIdToken: async () => ({ iss: "https://accounts.google.com", aud: config.clientId, exp: Math.floor(NOW.getTime() / 1000) + 600, nonce: flow.nonce, sub: "sub-123", email: "Agenda.Clinica@Example.invalid", email_verified: true, ...claims }),
    getSessionUser: async () => (sessionUser === undefined ? user : sessionUser),
    enqueueBackfill: async (input) => void backfills.push(input),
  };
  mutateState?.(flow);
  const run = (input = {}) => handleCalendarCallback(deps, { code: "CODE", state: flow.state, flowToken: started.flowCookie.value, ...input });
  return { run, db, backfills, flow, deps };
}

test("callback: sucesso cria a conexão com tokens cifrados, e-mail/sub do id_token, enfileira backfill e não põe segredo na URL", async () => {
  const { run, db, backfills } = await callbackSetup();
  const result = await run();
  assert.equal(result.redirect, calendarOutcomeRedirect("connected"));
  assert.ok(!/AT-1|RT-1|CODE/.test(result.redirect));
  const [created] = db.state.created;
  assert.equal(created.googleEmail, "agenda.clinica@example.invalid");
  assert.equal(created.googleAccountId, "sub-123");
  assert.equal(created.connectionType, "ADMIN");
  assert.equal(decryptGoogleToken(created.accessTokenEncrypted, env), "AT-1");
  assert.equal(decryptGoogleToken(created.refreshTokenEncrypted, env), "RT-1");
  assert.notEqual(created.refreshTokenEncrypted, "RT-1");
  assert.deepEqual(backfills, [{ clinicId: "clinic-1", connectionType: "ADMIN", userId: "u-admin" }]);
});

test("callback: reconexão sem novo refresh_token preserva o refresh existente e a mesma conexão (sem duplicar)", async () => {
  const existing = { id: "conn-1", googleEmail: "agenda.clinica@example.invalid", googleAccountId: "sub-123", refreshTokenEncrypted: encryptGoogleToken("RT-ANTIGO", env) };
  const { run, db } = await callbackSetup({ db: fakeOauthDb(existing), tokens: { refreshToken: null } });
  assert.equal((await run()).redirect, calendarOutcomeRedirect("connected"));
  assert.equal(db.state.created.length, 0);
  assert.equal(db.state.updated.length, 1);
  assert.equal(db.state.updated[0].where.id, "conn-1");
  assert.equal(decryptGoogleToken(db.state.updated[0].data.refreshTokenEncrypted, env), "RT-ANTIGO");
  assert.equal(db.state.eventDeletes.length, 0, "mesma conta: vínculos mantidos");
  assert.equal(db.state.updated[0].data.status, "CONNECTED");
});

test("callback: conta Google diferente na mesma conexão descarta os vínculos antigos (o backfill recria)", async () => {
  const existing = { id: "conn-1", googleEmail: "outra@example.invalid", googleAccountId: "sub-OUTRA", refreshTokenEncrypted: "x" };
  const { run, db } = await callbackSetup({ db: fakeOauthDb(existing) });
  await run();
  assert.equal(db.state.eventDeletes.length, 1);
  assert.equal(db.state.eventDeletes[0].where.connectionId, "conn-1");
});

test("callback: sem refresh_token e sem conexão anterior = no_refresh, nada salvo", async () => {
  const { run, db, backfills } = await callbackSetup({ tokens: { refreshToken: null } });
  assert.equal((await run()).redirect, calendarOutcomeRedirect("no_refresh"));
  assert.equal(db.state.created.length, 0);
  assert.equal(backfills.length, 0);
});

test("callback: escopo calendar.events não concedido = no_scope", async () => {
  const { run, db } = await callbackSetup({ tokens: { scope: "openid email" } });
  assert.equal((await run()).redirect, calendarOutcomeRedirect("no_scope"));
  assert.equal(db.state.created.length, 0);
});

test("callback: state diferente, sem cookie, sem code, ou erro do Google = sem gravar", async () => {
  const { run, db } = await callbackSetup();
  assert.equal((await run({ state: "outro" })).redirect, calendarOutcomeRedirect("error"));
  assert.equal((await run({ flowToken: null })).redirect, calendarOutcomeRedirect("error"));
  assert.equal((await run({ code: null })).redirect, calendarOutcomeRedirect("error"));
  assert.equal((await run({ error: "access_denied" })).redirect, calendarOutcomeRedirect("denied"));
  assert.equal((await run({ error: "server_error" })).redirect, calendarOutcomeRedirect("error"));
  assert.equal(db.state.created.length, 0);
});

test("callback: sessão ausente, outro usuário/clínica ou sem permissão agora = sem gravar", async () => {
  for (const [label, sessionUser, outcome] of [
    ["sem sessão", null, "error"],
    ["outro usuário", { ...adminUser, id: "u-outro" }, "error"],
    ["outra clínica", { ...adminUser, clinicId: "clinic-2" }, "error"],
    ["perdeu permissão", { ...adminUser, role: "PROFESSIONAL", isOwner: false }, "forbidden"],
  ]) {
    const { run, db } = await callbackSetup({ sessionUser });
    assert.equal((await run()).redirect, calendarOutcomeRedirect(outcome), label);
    assert.equal(db.state.created.length, 0, label);
  }
});

test("callback: nonce errado / id_token sem e-mail verificado = erro; troca do code falhando = erro sem vazar", async () => {
  const bad = await callbackSetup({ claims: { nonce: "outro" } });
  assert.equal((await bad.run()).redirect, calendarOutcomeRedirect("error"));
  const unverified = await callbackSetup({ claims: { email_verified: false } });
  assert.equal((await unverified.run()).redirect, calendarOutcomeRedirect("error"));
  const failing = await callbackSetup();
  failing.deps.client.exchangeCode = async () => { throw new GoogleCalendarError("auth", 400, "invalid_grant"); };
  const result = await failing.run();
  assert.equal(result.redirect, calendarOutcomeRedirect("error"));
  assert.equal(failing.db.state.created.length, 0);
});

test("callback: central já conectada por outra pessoa (P2002 do índice parcial) = already_central amigável; sem config = unavailable", async () => {
  const db = fakeOauthDb();
  db.state.failCreateWith = Object.assign(new Error("unique"), { code: "P2002" });
  const { run, deps } = await callbackSetup({ db });
  assert.equal((await run()).redirect, calendarOutcomeRedirect("already_central"));
  // o mesmo P2002 numa conexão individual não vira "central já conectada"
  const individual = await callbackSetup({ type: "PROFESSIONAL", user: proUser, db });
  assert.equal((await individual.run()).redirect, calendarOutcomeRedirect("error"));
  assert.equal((await handleCalendarCallback({ ...deps, config: null }, { code: "c", state: "s", flowToken: "t" })).redirect, calendarOutcomeRedirect("unavailable"));
});

// ---------- e-mails ----------

const state = { status: "Agendado", day: "2026-12-10", time: "14:30", procedure: "Botox <b>", professional: "Dra. Ana", durationMinutes: 45 };

test("e-mail: assunto/conteúdo por tipo, texto escapado, convite Google só quando há Google", () => {
  const base = { recipientName: "Ana", clinicName: "Clínica <X>", patientName: "Paciente <script>", state, changes: [], link: "http://localhost:3000/agenda" };
  const neu = buildCalendarNotificationEmail({ ...base, kind: "NEW", googleNotice: "invite" });
  assert.equal(neu.subject, "Novo agendamento atribuído a você — 10/12/2026 às 14:30");
  assert.ok(neu.html.includes("Paciente &lt;script&gt;") && !neu.html.includes("<script>"));
  assert.ok(neu.html.includes("Abrir no Harmonize+") && neu.html.includes("http://localhost:3000/agenda"));
  assert.ok(neu.text.includes("convite deste atendimento também foi enviado pelo Google Agenda"));
  assert.ok(!buildCalendarNotificationEmail({ ...base, kind: "NEW", googleNotice: null }).text.includes("Google"));
  const changed = buildCalendarNotificationEmail({ ...base, kind: "CHANGED", googleNotice: null, changes: [{ field: "time", before: "10:00", after: "14:30" }] });
  assert.ok(changed.text.includes("Horário: 10:00 → 14:30"));
  assert.match(buildCalendarNotificationEmail({ ...base, kind: "CANCELLED", googleNotice: null }).subject, /^Agendamento cancelado/);
  const out = buildCalendarNotificationEmail({ ...base, kind: "REASSIGNED_OUT", googleNotice: null, changes: [{ field: "professional", before: "Dra. Ana", after: "Dra. Bia" }] });
  assert.ok(out.text.includes("Profissional: Dra. Ana → Dra. Bia"));
});

function fakeNotifyDb({ email = "ana@example.invalid", connections = [] } = {}) {
  const logs = new Map();
  const statusUpdates = [];
  return {
    logs,
    statusUpdates,
    clinic: { findUnique: async () => ({ name: "Clínica Teste" }) },
    googleCalendarConnection: { findMany: async () => connections },
    clinicMembership: { findFirst: async ({ where }) => (where.userId === "u-ana" ? { user: { name: "Ana", email } } : null) },
    calendarNotificationLog: {
      create: async ({ data }) => {
        if (logs.has(data.dedupeKey)) throw Object.assign(new Error("dup"), { code: "P2002" });
        logs.set(data.dedupeKey, data);
        return data;
      },
      updateMany: async ({ where, data }) => (statusUpdates.push({ where, data }), { count: 1 }),
    },
  };
}
const planned = [{ kind: "NEW", recipientUserId: "u-ana", state, changes: [] }];
const input = { clinicId: "clinic-1", appointmentId: "apt-1", patientName: "Paciente", planned };

test("e-mail: envia uma vez por estado (dedupeKey único, gravado antes do envio); repetir não reenvia", async () => {
  const db = fakeNotifyDb();
  const sent = [];
  const deps = { db, isReady: () => true, send: async (mail) => (sent.push(mail), { sent: true }) };
  assert.deepEqual(await sendCalendarNotifications(deps, input), { sent: 1, failed: 0, skipped: 0 });
  assert.deepEqual(await sendCalendarNotifications(deps, input), { sent: 0, failed: 0, skipped: 1 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "ana@example.invalid");
  assert.ok(db.logs.has(notificationDedupeKey("apt-1", "NEW", "u-ana", state)));
  // novo estado (outro horário) envia de novo
  await sendCalendarNotifications(deps, { ...input, planned: [{ ...planned[0], state: { ...state, time: "16:00" } }] });
  assert.equal(sent.length, 2);
});

test("e-mail: falha do Resend marca FAILED e não lança nem reenvia; não configurado não envia nem registra", async () => {
  const db = fakeNotifyDb();
  let calls = 0;
  const failing = { db, isReady: () => true, send: async () => (calls++, { sent: false, reason: "provider_error" }) };
  assert.deepEqual(await sendCalendarNotifications(failing, input), { sent: 0, failed: 1, skipped: 0 });
  assert.equal(db.statusUpdates[0].data.status, "FAILED");
  await sendCalendarNotifications(failing, input);
  assert.equal(calls, 1, "o mesmo estado não é reenviado mesmo após falha");
  const throwing = { db: fakeNotifyDb(), isReady: () => true, send: async () => { throw new Error("rede"); } };
  assert.equal((await sendCalendarNotifications(throwing, input)).failed, 1);
  const off = fakeNotifyDb();
  assert.deepEqual(await sendCalendarNotifications({ db: off, isReady: () => false, send: async () => assert.fail("não envia") }, input), { sent: 0, failed: 0, skipped: 1 });
  assert.equal(off.logs.size, 0);
});

test("e-mail: quem fez a ação não é notificado; destinatário sem e-mail válido/sem membership é ignorado", async () => {
  const sent = [];
  const send = async (mail) => (sent.push(mail), { sent: true });
  assert.equal((await sendCalendarNotifications({ db: fakeNotifyDb(), isReady: () => true, send }, { ...input, actorUserId: "u-ana" })).skipped, 1);
  assert.equal((await sendCalendarNotifications({ db: fakeNotifyDb({ email: "sem-arroba" }), isReady: () => true, send }, input)).skipped, 1);
  assert.equal((await sendCalendarNotifications({ db: fakeNotifyDb(), isReady: () => true, send }, { ...input, planned: [{ ...planned[0], recipientUserId: "u-de-outra-clinica" }] })).skipped, 1);
  assert.equal(sent.length, 0);
});

test("e-mail: aviso do Google conforme conexões (central = convite; só individual = agenda; nenhuma = sem aviso)", async () => {
  const sent = [];
  const send = async (mail) => (sent.push(mail), { sent: true });
  await sendCalendarNotifications({ db: fakeNotifyDb({ connections: [{ connectionType: "ADMIN", userId: "u-admin" }] }), isReady: () => true, send }, input);
  await sendCalendarNotifications({ db: fakeNotifyDb({ connections: [{ connectionType: "PROFESSIONAL", userId: "u-ana" }] }), isReady: () => true, send }, input);
  await sendCalendarNotifications({ db: fakeNotifyDb(), isReady: () => true, send }, input);
  assert.ok(sent[0].text.includes("convite"));
  assert.ok(sent[1].text.includes("agenda do Google conectada"));
  assert.ok(!sent[2].text.includes("Google"));
});
