import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptSecret, encryptSecret, resolveSecretBoxKey, encryptGoogleToken, decryptGoogleToken } from "../src/lib/secret-box.ts";
import {
  GOOGLE_CALENDAR_SCOPE,
  appointmentLink,
  buildCalendarAuthUrl,
  buildEventPayload,
  calendarEventId,
  changeAffectsCalendar,
  diffAppointmentState,
  eventDurationMinutes,
  hasCalendarScope,
  isValidCalendarEmail,
  isValidGoogleEventId,
  resolveCalendarRedirectUri,
} from "../src/lib/google-calendar-rules.ts";

const AUTH = "a".repeat(40);

test("secret-box: ida e volta, contexto autenticado e formato", () => {
  const env = { AUTH_SECRET: AUTH };
  const payload = encryptSecret("token-123", "ctx-a", env);
  assert.match(payload, /^v1:[\w-]+:[\w-]+:[\w-]+$/);
  assert.ok(!payload.includes("token-123"));
  assert.equal(decryptSecret(payload, "ctx-a", env), "token-123");
  assert.notEqual(encryptSecret("token-123", "ctx-a", env), payload);
  assert.throws(() => decryptSecret(payload, "ctx-b", env), /inválido/);
  assert.throws(() => decryptSecret(payload.slice(0, -2) + "AA", "ctx-a", env), /inválido/);
  assert.throws(() => decryptSecret("lixo", "ctx-a", env), /inválido/);
  assert.equal(decryptGoogleToken(encryptGoogleToken("rt", env), env), "rt");
});

test("secret-box: chave dedicada hex/base64 validada; trocar a chave invalida; fallback exige AUTH_SECRET", () => {
  const hex = "ab".repeat(32);
  const b64 = Buffer.alloc(32, 7).toString("base64");
  assert.equal(resolveSecretBoxKey({ GOOGLE_TOKEN_ENCRYPTION_KEY: hex }).length, 32);
  assert.equal(resolveSecretBoxKey({ GOOGLE_TOKEN_ENCRYPTION_KEY: b64 }).length, 32);
  assert.throws(() => resolveSecretBoxKey({ GOOGLE_TOKEN_ENCRYPTION_KEY: "curta" }), /inválida/);
  assert.throws(() => resolveSecretBoxKey({ GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }), /inválida/);
  assert.throws(() => resolveSecretBoxKey({}), /AUTH_SECRET/);
  const payload = encryptSecret("x", "c", { GOOGLE_TOKEN_ENCRYPTION_KEY: hex });
  assert.throws(() => decryptSecret(payload, "c", { AUTH_SECRET: AUTH }), /inválido/);
  assert.notDeepEqual(resolveSecretBoxKey({ AUTH_SECRET: AUTH }), resolveSecretBoxKey({ GOOGLE_TOKEN_ENCRYPTION_KEY: hex }));
});

test("redirect URI: explícita, derivada do site e inválidas", () => {
  assert.equal(resolveCalendarRedirectUri({ GOOGLE_CALENDAR_REDIRECT_URI: "https://app.exemplo.com/cb" }), "https://app.exemplo.com/cb");
  assert.equal(resolveCalendarRedirectUri({ NEXT_PUBLIC_SITE_URL: "https://app.exemplo.com/qualquer/caminho" }), "https://app.exemplo.com/api/integrations/google-calendar/callback");
  assert.equal(resolveCalendarRedirectUri({ NODE_ENV: "development" }), "http://localhost:3000/api/integrations/google-calendar/callback");
  assert.equal(resolveCalendarRedirectUri({ NODE_ENV: "production" }), null);
  assert.equal(resolveCalendarRedirectUri({ GOOGLE_CALENDAR_REDIRECT_URI: "javascript:alert(1)" }), null);
  // produção exige https na URI explícita; http só fora de produção
  assert.equal(resolveCalendarRedirectUri({ NODE_ENV: "production", GOOGLE_CALENDAR_REDIRECT_URI: "http://app.exemplo.com/cb" }), null);
  assert.equal(resolveCalendarRedirectUri({ NODE_ENV: "production", GOOGLE_CALENDAR_REDIRECT_URI: "https://app.exemplo.com/cb" }), "https://app.exemplo.com/cb");
  assert.equal(resolveCalendarRedirectUri({ NODE_ENV: "development", GOOGLE_CALENDAR_REDIRECT_URI: "http://localhost:3000/cb" }), "http://localhost:3000/cb");
  assert.equal(appointmentLink("https://x.com"), "https://x.com/agenda");
  assert.equal(appointmentLink(null), null);
});

test("URL de autorização: offline, consent, PKCE, state, escopo mínimo", () => {
  const url = new URL(buildCalendarAuthUrl({ clientId: "cid", redirectUri: "https://a/cb", state: "st", nonce: "nn", codeChallenge: "ch" }));
  const p = url.searchParams;
  assert.equal(p.get("access_type"), "offline");
  assert.equal(p.get("prompt"), "consent");
  assert.equal(p.get("code_challenge_method"), "S256");
  assert.equal(p.get("code_challenge"), "ch");
  assert.equal(p.get("state"), "st");
  assert.equal(p.get("response_type"), "code");
  assert.equal(p.get("include_granted_scopes"), "false");
  assert.equal(p.get("scope"), "openid email https://www.googleapis.com/auth/calendar.events");
  assert.equal(p.get("scope"), GOOGLE_CALENDAR_SCOPE);
  assert.ok(hasCalendarScope("openid email https://www.googleapis.com/auth/calendar.events"));
  assert.ok(!hasCalendarScope("openid email"));
});

test("id determinístico de evento: estável, base32hex, 5-1024, distinto por conexão/agendamento", () => {
  const id = calendarEventId("conn1", "apt1");
  assert.equal(id, calendarEventId("conn1", "apt1"));
  assert.match(id, /^[a-v0-9]{52}$/);
  assert.ok(isValidGoogleEventId(id));
  assert.notEqual(id, calendarEventId("conn2", "apt1"));
  assert.notEqual(id, calendarEventId("conn1", "apt2"));
  assert.ok(!isValidGoogleEventId("abc"));
  assert.ok(!isValidGoogleEventId("ABCDEFG"));
});

test("e-mails: formato", () => {
  for (const ok of ["a@b.co", "Ana.Silva+x@exemplo.com.br", " ANA@EXEMPLO.COM "]) assert.ok(isValidCalendarEmail(ok), ok);
  for (const bad of ["", "ana", "ana@", "a@b", "a b@c.com", "a@b.c", "<x>@y.com", null, undefined]) assert.ok(!isValidCalendarEmail(bad), String(bad));
});

test("duração: catálogo por nome (sem caixa/espaços) e fallback 60", () => {
  const catalog = [{ name: "Botox", durationMinutes: 45 }, { name: "Peeling", durationMinutes: null }];
  assert.equal(eventDurationMinutes("Botox", catalog), 45);
  assert.equal(eventDurationMinutes("  botox ", catalog), 45);
  assert.equal(eventDurationMinutes("Peeling", catalog), 60);
  assert.equal(eventDurationMinutes("Outro", catalog), 60);
  assert.equal(eventDurationMinutes("Botox", [{ name: "Botox", durationMinutes: 99999 }]), 1440);
});

const base = { appointmentId: "apt1", clinicId: "cl1", patientName: "Maria Souza", status: "Agendado", day: "2026-12-01", time: "14:30", procedure: "Botox", professional: "Dra. Ana", durationMinutes: 45 };

test("payload: título, fuso, fim = início + duração, extendedProperties, sem dado clínico", () => {
  const payload = buildEventPayload({ ...base, attendeeEmail: "Ana@Exemplo.com", link: "https://x.com/agenda" });
  assert.equal(payload.summary, "Atendimento - Botox");
  assert.deepEqual(payload.start, { dateTime: "2026-12-01T14:30:00-03:00", timeZone: "America/Sao_Paulo" });
  assert.deepEqual(payload.end, { dateTime: "2026-12-01T15:15:00-03:00", timeZone: "America/Sao_Paulo" });
  assert.equal(payload.status, "confirmed");
  assert.deepEqual(payload.attendees, [{ email: "ana@exemplo.com" }]);
  assert.deepEqual(payload.extendedProperties.private, { harmonizeAppointmentId: "apt1", clinicId: "cl1" });
  assert.match(payload.description, /Paciente: Maria Souza/);
  assert.match(payload.description, /14:30 às 15:15 \(45 min\)/);
  assert.match(payload.description, /Abrir no Harmonize\+: https:\/\/x.com\/agenda/);
  assert.ok(!/telefone|cpf|nota|diagn/i.test(payload.description));
});

test("payload: cancelado, fim atravessa a meia-noite, e-mail inválido, escape, data inválida, duração inválida", () => {
  assert.equal(buildEventPayload({ ...base, status: "Cancelado" }).status, "cancelled");
  const late = buildEventPayload({ ...base, time: "23:30", durationMinutes: 60 });
  assert.equal(late.end.dateTime, "2026-12-02T00:30:00-03:00");
  assert.deepEqual(buildEventPayload({ ...base, attendeeEmail: "invalido" }).attendees, []);
  assert.deepEqual(buildEventPayload({ ...base }).attendees, []);
  const xss = buildEventPayload({ ...base, patientName: "<b>Eva</b> & Cia\u0000" });
  assert.ok(!xss.description.includes("<b>"));
  assert.match(xss.description, /&lt;b&gt;Eva&lt;\/b&gt; &amp; Cia/);
  assert.equal(buildEventPayload({ ...base, day: "2026-02-30" }), null);
  assert.equal(buildEventPayload({ ...base, time: "25:00" }), null);
  assert.equal(buildEventPayload({ ...base, durationMinutes: 0 }).end.dateTime, "2026-12-01T15:30:00-03:00");
});

test("diff de estado e relevância para o calendário", () => {
  assert.deepEqual(diffAppointmentState(base, { ...base }), []);
  assert.deepEqual(diffAppointmentState(base, { ...base, professional: "  dra.  ana " }), []);
  const changes = diffAppointmentState(base, { ...base, time: "15:00", professional: "Dr. Bruno", status: "Cancelado" });
  assert.deepEqual(changes.map((c) => c.field), ["time", "professional", "status"]);
  assert.deepEqual(changes[0], { field: "time", before: "14:30", after: "15:00" });
  const onlyStatus = diffAppointmentState(base, { ...base, status: "Atendido" });
  assert.equal(changeAffectsCalendar(onlyStatus, base, { status: "Atendido" }), false);
  assert.equal(changeAffectsCalendar(diffAppointmentState(base, { ...base, status: "Cancelado" }), base, { status: "Cancelado" }), true);
  assert.equal(changeAffectsCalendar(diffAppointmentState({ ...base, status: "Cancelado" }, base), { status: "Cancelado" }, base), true);
  assert.equal(changeAffectsCalendar(diffAppointmentState(base, { ...base, day: "2026-12-02" }), base, base), true);
});
