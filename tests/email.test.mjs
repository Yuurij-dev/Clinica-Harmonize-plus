import assert from "node:assert/strict";
import test from "node:test";
import * as email from "../src/lib/email.ts";

const env = { RESEND_API_KEY: "re_SECRETKEY", EMAIL_FROM: "Harmonize <no-reply@h.com>", NEXT_PUBLIC_SITE_URL: "https://app.h.com" };
const input = { to: "ana@x.com", clinicName: "Clínica <Um> & Cia", inviterName: "Dr. \"Bob\"", role: "STAFF", url: "https://app.h.com/convite/TOKEN123" };

test("buildInviteUrl: producao sem site => null; dev => localhost; token codificado", () => {
  assert.equal(email.buildInviteUrl("t", { NODE_ENV: "production" }), null);
  assert.equal(email.buildInviteUrl("t", { NODE_ENV: "development" }), "http://localhost:3000/convite/t");
  assert.equal(email.buildInviteUrl("a/b", { NEXT_PUBLIC_SITE_URL: "https://app.h.com/x" }), "https://app.h.com/convite/a%2Fb");
  assert.equal(email.buildInviteUrl("t", { NEXT_PUBLIC_SITE_URL: "lixo" }), null);
});

test("sendInvitationEmail: chamada correta ao Resend", async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return new Response("{}", { status: 200 }); };
  assert.deepEqual(await email.sendInvitationEmail(input, { env, fetchImpl }), { sent: true });
  assert.equal(seen.url, "https://api.resend.com/emails");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.Authorization, "Bearer re_SECRETKEY");
  assert.ok(seen.init.signal instanceof AbortSignal);
  const body = JSON.parse(seen.init.body);
  assert.equal(body.from, env.EMAIL_FROM);
  assert.deepEqual(body.to, ["ana@x.com"]);
  assert.equal(body.subject, 'Dr. "Bob" convidou você para a clínica Clínica <Um> & Cia');
  assert.ok(body.html.includes("https://app.h.com/convite/TOKEN123"));
  assert.ok(body.text.includes("https://app.h.com/convite/TOKEN123"));
  // HTML escapado: nada de tag injetada pelo nome da clinica/convidante
  assert.ok(!body.html.includes("<Um>"));
  assert.ok(body.html.includes("&lt;Um&gt; &amp; Cia"));
  assert.ok(!/<img|src=/i.test(body.html));
});

test("sendInvitationEmail: nao configurado, sem URL, erro do provedor e timeout", async () => {
  let called = 0;
  const fetchImpl = async () => { called++; return new Response("{}", { status: 200 }); };
  assert.deepEqual(await email.sendInvitationEmail(input, { env: {}, fetchImpl }), { sent: false, reason: "not_configured" });
  assert.deepEqual(await email.sendInvitationEmail(input, { env: { RESEND_API_KEY: "k" }, fetchImpl }), { sent: false, reason: "not_configured" });
  assert.deepEqual(await email.sendInvitationEmail({ ...input, url: null }, { env, fetchImpl }), { sent: false, reason: "no_site_url" });
  assert.equal(called, 0);
  assert.deepEqual(await email.sendInvitationEmail(input, { env, fetchImpl: async () => new Response("detalhe interno", { status: 422 }) }), { sent: false, reason: "provider_error" });
  assert.deepEqual(await email.sendInvitationEmail(input, { env, fetchImpl: async () => { throw new DOMException("t", "TimeoutError"); } }), { sent: false, reason: "timeout" });
  assert.deepEqual(await email.sendInvitationEmail(input, { env, fetchImpl: async () => { throw new TypeError("fetch failed"); } }), { sent: false, reason: "network" });
});

test("sendInvitationEmail: token, URL e chave nunca vao para o console", async () => {
  const lines = [];
  const orig = {};
  for (const m of ["log", "info", "warn", "error", "debug"]) { orig[m] = console[m]; console[m] = (...a) => lines.push(a.map(String).join(" ")); }
  try {
    await email.sendInvitationEmail(input, { env, fetchImpl: async () => new Response("{}", { status: 500 }) });
    await email.sendInvitationEmail(input, { env, fetchImpl: async () => { throw new Error("falha com TOKEN123 e re_SECRETKEY"); } });
    await email.sendInvitationEmail(input, { env: {}, fetchImpl: async () => new Response("{}") });
  } finally {
    for (const m of Object.keys(orig)) console[m] = orig[m];
  }
  // so o codigo estavel de falha pode ir ao console; nunca token, URL, chave, e-mail ou texto do provedor
  assert.ok(lines.length > 0);
  for (const l of lines) assert.match(l, /^\[email\] (provider_error|network|timeout)$/);
});

const failWith = (status, body) => ({ env, fetchImpl: async () => new Response(body, { status }) });
const quiet = async (fn) => { const orig = console.warn; const lines = []; console.warn = (...a) => lines.push(a.join(" ")); try { return [await fn(), lines]; } finally { console.warn = orig; } };

test("mapProviderFailure: status + name => codigo estavel; desconhecido => provider_error", () => {
  const m = email.mapProviderFailure;
  assert.equal(m(403, "validation_error"), "unverified_domain_or_test_recipient");
  assert.equal(m(401, "restricted_api_key"), "invalid_api_key");
  assert.equal(m(403, "invalid_api_key"), "invalid_api_key");
  assert.equal(m(401, undefined), "invalid_api_key");
  assert.equal(m(422, "invalid_from_address"), "invalid_from");
  assert.equal(m(429, "rate_limit_exceeded"), "rate_limited");
  assert.equal(m(429, undefined), "rate_limited");
  assert.equal(m(403, "outra_coisa"), "provider_error");
  assert.equal(m(422, "validation_error"), "provider_error"); // 422 validation_error nao e modo de teste
  assert.equal(m(500, "application_error"), "provider_error");
  assert.equal(m(500, { name: "x" }), "provider_error");
});

test("sendInvitationEmail: respostas reais do Resend viram o codigo certo", async () => {
  const cases = [
    [403, { statusCode: 403, name: "validation_error", message: "You can only send testing emails to your own email address (dono@x.com)." }, "unverified_domain_or_test_recipient"],
    [401, { statusCode: 401, name: "restricted_api_key", message: "re_SECRETKEY sem permissao" }, "invalid_api_key"],
    [422, { statusCode: 422, name: "invalid_from_address", message: "Invalid from" }, "invalid_from"],
    [429, { statusCode: 429, name: "rate_limit_exceeded", message: "slow down" }, "rate_limited"],
    [500, { statusCode: 500, name: "application_error", message: "boom" }, "provider_error"],
  ];
  for (const [status, body, reason] of cases) {
    const [r, lines] = await quiet(() => email.sendInvitationEmail(input, failWith(status, JSON.stringify(body))));
    assert.deepEqual(r, { sent: false, reason });
    // nada da resposta bruta (message, e-mail, chave) chega ao resultado nem ao console
    assert.equal(JSON.stringify(r).includes("SECRETKEY") || JSON.stringify(r).includes("dono@x.com"), false);
    assert.deepEqual(lines, [`[email] ${reason}`]);
  }
});

test("sendInvitationEmail: corpo hostil, enorme ou sem JSON cai em provider_error sem vazar", async () => {
  const hostile = [
    "<html>erro</html>",
    "",
    "{ not json",
    JSON.stringify({ name: { toString: "x" }, message: "re_SECRETKEY" }),
    JSON.stringify({ name: "A".repeat(100_000) }),
    "x".repeat(2_000_000),
    "[1,2,3]",
    "null",
  ];
  for (const body of hostile) {
    const [r, lines] = await quiet(() => email.sendInvitationEmail(input, failWith(502, body)));
    assert.deepEqual(r, { sent: false, reason: "provider_error" });
    assert.deepEqual(lines, ["[email] provider_error"]);
  }
});
