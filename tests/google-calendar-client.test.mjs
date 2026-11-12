import assert from "node:assert/strict";
import { test } from "node:test";
import { GoogleCalendarError, classifyGoogleResponse, createGoogleCalendarClient } from "../src/lib/google-calendar-client.ts";

const json = (status, body, headers = {}) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers });

function makeClient(handler, extra = {}) {
  const calls = [];
  const client = createGoogleCalendarClient({
    clientId: "cid",
    clientSecret: "SECRET-VALUE",
    redirectUri: "https://a/cb",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return handler(url, init, calls.length);
    },
    ...extra,
  });
  return { client, calls };
}

const payload = { summary: "x" };

test("exchangeCode envia PKCE e devolve tokens sem expor o corpo", async () => {
  const { client, calls } = makeClient(() => json(200, { access_token: "AT", refresh_token: "RT", expires_in: 3599, scope: "s", id_token: "ID" }));
  const result = await client.exchangeCode({ code: "CODE", codeVerifier: "VER" });
  assert.deepEqual(result, { accessToken: "AT", refreshToken: "RT", expiresInSeconds: 3599, scope: "s", idToken: "ID" });
  const body = new URLSearchParams(calls[0].init.body);
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code_verifier"), "VER");
  assert.equal(body.get("redirect_uri"), "https://a/cb");
  assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
});

test("refresh sem refresh_token novo devolve null; invalid_grant vira auth", async () => {
  const ok = makeClient(() => json(200, { access_token: "AT2", expires_in: 3600 }));
  assert.equal((await ok.client.refreshAccessToken("RT")).refreshToken, null);
  const bad = makeClient(() => json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." }));
  await assert.rejects(bad.client.refreshAccessToken("RT"), (error) => error instanceof GoogleCalendarError && error.kind === "auth" && error.reason === "invalid_grant");
});

test("classificação de erros por status/motivo", () => {
  const kind = (status, body, opts) => classifyGoogleResponse(status, body, opts).kind;
  assert.equal(kind(401), "auth");
  assert.equal(kind(403, { error: { errors: [{ reason: "rateLimitExceeded" }] } }), "rateLimit");
  assert.equal(kind(403, { error: { errors: [{ reason: "insufficientPermissions" }] } }), "auth");
  assert.equal(kind(403, { error: { errors: [{ reason: "outra" }] } }), "permanent");
  assert.equal(kind(404), "notFound");
  assert.equal(kind(410), "notFound");
  assert.equal(kind(409), "conflict");
  assert.equal(kind(429), "rateLimit");
  assert.equal(kind(500), "transient");
  assert.equal(kind(503), "transient");
  assert.equal(kind(400, { error: { errors: [{ reason: "invalid" }] } }), "permanent");
  assert.equal(kind(400, { error: "invalid_grant" }, { tokenEndpoint: true }), "auth");
  assert.equal(kind(400, { error: "invalid_request" }, { tokenEndpoint: true }), "permanent");
});

test("insert usa id determinístico, sendUpdates e Bearer; 409 vira conflict", async () => {
  const { client, calls } = makeClient(() => json(200, { id: "abcde" }));
  await client.insertEvent("AT", "primary", "abcde", payload, "all");
  assert.match(calls[0].url, /\/calendars\/primary\/events\?sendUpdates=all$/);
  assert.equal(calls[0].init.headers.authorization, "Bearer AT");
  assert.equal(JSON.parse(calls[0].init.body).id, "abcde");
  const dup = makeClient(() => json(409, { error: { errors: [{ reason: "duplicate" }] } }));
  await assert.rejects(dup.client.insertEvent("AT", "primary", "abcde", payload), (e) => e.kind === "conflict" && e.status === 409);
});

test("patch, get e list: caminhos e codificação do calendarId", async () => {
  const { client, calls } = makeClient(() => json(200, { id: "e1", items: [{ id: "e2" }] }));
  await client.patchEvent("AT", "a@b.com", "e1", { status: "cancelled" }, "all");
  assert.match(calls[0].url, /\/calendars\/a%40b\.com\/events\/e1\?sendUpdates=all$/);
  assert.equal(calls[0].init.method, "PATCH");
  await client.getEvent("AT", "primary", "e1");
  assert.equal(calls[1].init.method, "GET");
  const list = await client.listEvents("AT", "primary", { iCalUID: "uid@google.com" });
  assert.match(calls[2].url, /iCalUID=uid%40google\.com/);
  assert.deepEqual(list.items, [{ id: "e2" }]);
});

test("delete: 404/410 = gone (idempotente); 5xx lança transient; getEvent 404 = null", async () => {
  assert.equal(await makeClient(() => json(204)).client.deleteEvent("AT", "primary", "e1"), "deleted");
  assert.equal(await makeClient(() => json(404, {})).client.deleteEvent("AT", "primary", "e1"), "gone");
  assert.equal(await makeClient(() => json(410, {})).client.deleteEvent("AT", "primary", "e1"), "gone");
  await assert.rejects(makeClient(() => json(503, {})).client.deleteEvent("AT", "primary", "e1"), (e) => e.kind === "transient");
  assert.equal(await makeClient(() => json(404, {})).client.getEvent("AT", "primary", "e1"), null);
});

test("429 respeita Retry-After; rede e timeout viram transient", async () => {
  const limited = makeClient(() => json(429, {}, { "retry-after": "120" }));
  await assert.rejects(limited.client.getEvent("AT", "primary", "e1"), (e) => e.kind === "rateLimit" && e.retryAfterSeconds === 120);
  const net = makeClient(() => { throw new TypeError("fetch failed"); });
  await assert.rejects(net.client.getEvent("AT", "primary", "e1"), (e) => e.kind === "transient" && e.reason === "network");
  const slow = makeClient((url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("abort"), { name: "AbortError" })))), { timeoutMs: 20 });
  await assert.rejects(slow.client.getEvent("AT", "primary", "e1"), (e) => e.kind === "transient" && e.reason === "timeout");
});

test("revoke: sucesso e invalid_token tolerado; erros não vazam token/segredo", async () => {
  assert.equal(await makeClient(() => json(200, {})).client.revokeToken("RT"), undefined);
  assert.equal(await makeClient(() => json(400, { error: "invalid_token" })).client.revokeToken("RT"), undefined);
  const failing = makeClient(() => json(500, { error: "backend", detail: "TOKEN-LEAK SECRET-VALUE" }));
  await assert.rejects(failing.client.revokeToken("RT"), (e) => {
    assert.ok(!e.message.includes("TOKEN-LEAK") && !e.message.includes("SECRET-VALUE") && !e.message.includes("RT"));
    return e.kind === "transient";
  });
});
