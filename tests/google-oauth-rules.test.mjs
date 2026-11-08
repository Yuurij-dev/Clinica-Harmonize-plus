import assert from "node:assert/strict";
import test from "node:test";
import { SignJWT } from "jose";
import * as rules from "../src/lib/google-oauth-rules.ts";
import * as flow from "../src/lib/google-oauth-flow.ts";

const secret = new TextEncoder().encode("a".repeat(40));
const otherSecret = new TextEncoder().encode("b".repeat(40));
const now = new Date("2026-06-01T12:00:00.000Z");
const exp = Math.floor(now.getTime() / 1000) + 3600;
const config = { clientId: "cid.apps.googleusercontent.com", clientSecret: "s", redirectUri: "https://app.test/api/auth/google/callback" };
const goodClaims = (over = {}) => ({
  iss: "https://accounts.google.com", aud: config.clientId, exp, nonce: "N", sub: "sub-1",
  email: "Ana@Clinica.com", email_verified: true, name: "Ana", ...over,
});

test("PKCE: vetor do RFC 7636", () => {
  assert.equal(rules.codeChallengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  assert.equal(Buffer.from(rules.generateCodeVerifier(), "base64url").length, 32);
});

test("state e nonce diferentes a cada chamada", () => {
  assert.notEqual(rules.generateOauthState(), rules.generateOauthState());
  assert.notEqual(rules.generateOauthNonce(), rules.generateOauthNonce());
});

test("URL de autorizacao tem exatamente os parametros esperados", () => {
  const url = new URL(rules.buildGoogleAuthUrl({ clientId: "c", redirectUri: "https://x/cb", state: "s", nonce: "n", codeChallenge: "cc" }));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: "c", redirect_uri: "https://x/cb", response_type: "code", scope: "openid email profile",
    state: "s", nonce: "n", code_challenge: "cc", code_challenge_method: "S256",
  });
});

test("validateGoogleClaims aceita e normaliza", () => {
  const r = rules.validateGoogleClaims(goodClaims({ iss: "accounts.google.com", aud: ["x", config.clientId] }), { clientId: config.clientId, nonce: "N", now });
  assert.deepEqual(r, { ok: true, sub: "sub-1", email: "ana@clinica.com", name: "Ana", emailVerified: true });
});

test("validateGoogleClaims recusa cada caso", () => {
  const ctx = { clientId: config.clientId, nonce: "N", now };
  const reason = (over) => rules.validateGoogleClaims(goodClaims(over), ctx).reason;
  assert.equal(reason({ iss: "https://evil.com" }), "issuer");
  assert.equal(reason({ aud: "outro" }), "audience");
  assert.equal(reason({ exp: Math.floor(now.getTime() / 1000) - 30 }), "expired");
  assert.equal(reason({ exp: Math.floor(now.getTime() / 1000) - 3 }), undefined); // dentro da tolerancia de 5 s
  assert.equal(reason({ exp: undefined }), "expired");
  assert.equal(reason({ nonce: "X" }), "nonce");
  assert.equal(reason({ nonce: undefined }), "nonce");
  assert.equal(reason({ sub: "" }), "no_sub");
  assert.equal(reason({ sub: undefined }), "no_sub");
  assert.equal(reason({ email: undefined }), "no_email");
  assert.equal(reason({ email_verified: false }), "email_unverified");
  assert.equal(reason({ email_verified: "true" }), "email_unverified");
  assert.equal(rules.validateGoogleClaims(null, ctx).ok, false);
});

test("cookie de fluxo: ida e volta, adulterado, expirado, outro segredo, tipo errado", async () => {
  const f = { state: "s", nonce: "n", codeVerifier: "v", intent: "link" };
  const token = await rules.signOauthFlow(f, secret);
  assert.deepEqual(await rules.verifyOauthFlow(token, secret), f);
  const [h, p, s] = token.split(".");
  assert.equal(await rules.verifyOauthFlow(`${h}.${p}.${s.slice(0, -2)}AA`, secret), null);
  assert.equal(await rules.verifyOauthFlow(await rules.signOauthFlow(f, secret, -10), secret), null);
  assert.equal(await rules.verifyOauthFlow(token, otherSecret), null);
  assert.equal(await rules.verifyOauthFlow(null, secret), null);
  const session = await new SignJWT({ userId: "u" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(secret);
  assert.equal(await rules.verifyOauthFlow(session, secret), null);
});

test("safeEqual: tempo constante, tipos e tamanhos", () => {
  assert.equal(rules.safeEqual("abc", "abc"), true);
  assert.equal(rules.safeEqual("abc", "abd"), false);
  assert.equal(rules.safeEqual("abc", "abcd"), false);
  assert.equal(rules.safeEqual(undefined, "abc"), false);
});

test("resolveGoogleLogin: todos os ramos", () => {
  const r = rules.resolveGoogleLogin;
  const base = { intent: "login", googleEmail: "ana@x.com", identity: null, userByEmail: null, sessionUser: null };
  assert.deepEqual(r({ ...base, identity: { userId: "u1" }, userByEmail: { id: "u2" } }), { action: "login", userId: "u1" });
  assert.deepEqual(r({ ...base, userByEmail: { id: "u2" } }), { action: "refuse", reason: "account_exists" });
  // login nunca vincula, mesmo com sessao presente
  assert.deepEqual(r({ ...base, userByEmail: { id: "u2" }, sessionUser: { id: "u2", email: "ana@x.com" } }), { action: "refuse", reason: "account_exists" });
  assert.deepEqual(r(base), { action: "create" });
  const link = { ...base, intent: "link" };
  assert.deepEqual(r({ ...link, userByEmail: { id: "u2" }, sessionUser: { id: "u2", email: "ANA@x.com" } }), { action: "link", userId: "u2" });
  assert.deepEqual(r({ ...link, userByEmail: { id: "u2" }, sessionUser: { id: "u2", email: "outro@x.com" } }), { action: "refuse", reason: "email_mismatch" });
  assert.deepEqual(r({ ...link, sessionUser: { id: "u2", email: "outro@x.com" } }), { action: "refuse", reason: "email_mismatch" });
  assert.deepEqual(r({ ...link, identity: { userId: "u9" }, sessionUser: { id: "u2", email: "ana@x.com" } }), { action: "refuse", reason: "identity_taken" });
  assert.deepEqual(r({ ...link, identity: { userId: "u2" }, sessionUser: { id: "u2", email: "ana@x.com" } }), { action: "login", userId: "u2" });
  assert.deepEqual(r(link), { action: "refuse", reason: "link_requires_session" });
});

// --- callback com dependencias falsas ---
function makeDeps(over = {}) {
  const calls = { exchange: 0, created: [], linked: [], touched: [] };
  const state = { identity: null, userByEmail: null, membership: true, access: { lockedUntil: null, mustChangePassword: false } };
  const deps = {
    config, secret, now: () => now,
    exchange: async () => { calls.exchange++; return "idtoken"; },
    verify: async () => goodClaims(),
    repo: {
      findIdentity: async () => state.identity,
      findUserByEmail: async () => state.userByEmail,
      hasMembership: async () => state.membership,
      getUserAccess: async () => state.access,
      touchIdentity: async (sub) => { calls.touched.push(sub); },
      linkIdentity: async (i) => { calls.linked.push(i); },
      createUserWithIdentity: async (i) => { calls.created.push(i); return "new-user"; },
    },
    getSessionUser: async () => null,
    makePasswordHash: async () => "hash",
    ...over,
  };
  return { deps, calls, state };
}
const startedFlow = async (intent = "login") => {
  const token = await rules.signOauthFlow({ state: "ST", nonce: "N", codeVerifier: "V", intent }, secret);
  return token;
};
const err = { redirect: "/login?google=error" };

test("callback: start sem config => unavailable; com config grava cookie e redireciona ao Google", async () => {
  assert.deepEqual(await flow.startGoogleFlow({ intent: "login", config: null, secret }), { redirect: "/login?google=unavailable" });
  const r = await flow.startGoogleFlow({ intent: "login", config, secret });
  const url = new URL(r.redirect);
  const saved = await rules.verifyOauthFlow(r.flowCookie.value, secret);
  assert.equal(url.searchParams.get("state"), saved.state);
  assert.equal(url.searchParams.get("nonce"), saved.nonce);
  assert.equal(url.searchParams.get("code_challenge"), rules.codeChallengeFor(saved.codeVerifier));
  assert.equal(r.flowCookie.maxAge, 600);
});

test("callback: falhas nunca emitem sessao", async () => {
  const token = await startedFlow();
  const cases = [
    ["state invalido", { code: "c", state: "XX", flowToken: token }, err],
    ["state ausente", { code: "c", flowToken: token }, err],
    ["cookie ausente (code reutilizado)", { code: "c", state: "ST", flowToken: null }, err],
    ["cookie adulterado", { code: "c", state: "ST", flowToken: token.slice(0, -3) + "AAA" }, err],
    ["sem code", { state: "ST", flowToken: token }, err],
    ["access_denied", { error: "access_denied", flowToken: token }, { redirect: "/login?google=denied" }],
    ["outro erro", { error: "server_error", flowToken: token }, err],
  ];
  for (const [name, input, expected] of cases) {
    const { deps, calls } = makeDeps();
    const r = await flow.handleGoogleCallback(deps, input);
    assert.deepEqual(r, expected, name);
    assert.equal(calls.exchange, 0, `${name}: nao deve chamar o Google`);
    assert.equal(calls.created.length, 0, name);
  }
});

test("callback: claim invalida, troca ou verificacao falhando => sem sessao", async () => {
  const token = await startedFlow();
  const input = { code: "c", state: "ST", flowToken: token };
  for (const bad of [goodClaims({ nonce: "outro" }), goodClaims({ email_verified: false }), goodClaims({ aud: "x" })]) {
    const { deps, calls } = makeDeps({ verify: async () => bad });
    assert.deepEqual(await flow.handleGoogleCallback(deps, input), err);
    assert.equal(calls.created.length, 0);
  }
  assert.deepEqual(await flow.handleGoogleCallback(makeDeps({ exchange: async () => { throw new Error("x"); } }).deps, input), err);
  assert.deepEqual(await flow.handleGoogleCallback(makeDeps({ verify: async () => { throw new Error("x"); } }).deps, input), err);
  assert.deepEqual(await flow.handleGoogleCallback(makeDeps({ config: null }).deps, input), { redirect: "/login?google=unavailable" });
});

test("callback: sucesso com identidade existente emite sessao e vai para /", async () => {
  const { deps, state, calls } = makeDeps();
  state.identity = { userId: "u1" };
  const r = await flow.handleGoogleCallback(deps, { code: "c", state: "ST", flowToken: await startedFlow() });
  assert.deepEqual(r, { redirect: "/?google=ok", sessionUserId: "u1" });
  assert.deepEqual(calls.touched, ["sub-1"]);
});

test("callback: e-mail ja existente sem identidade => account_exists, sem vincular", async () => {
  const { deps, state, calls } = makeDeps();
  state.userByEmail = { id: "u2" };
  const r = await flow.handleGoogleCallback(deps, { code: "c", state: "ST", flowToken: await startedFlow() });
  assert.deepEqual(r, { redirect: "/login?google=account_exists" });
  assert.equal(calls.linked.length + calls.created.length, 0);
});

test("callback: link com sessao valida vincula e entra", async () => {
  const { deps, state, calls } = makeDeps({ getSessionUser: async () => ({ id: "u2", email: "ana@clinica.com" }) });
  state.userByEmail = { id: "u2" };
  const r = await flow.handleGoogleCallback(deps, { code: "c", state: "ST", flowToken: await startedFlow("link") });
  assert.deepEqual(r, { redirect: "/?google=ok", sessionUserId: "u2" });
  assert.equal(calls.linked[0].sub, "sub-1");
  assert.equal(calls.linked[0].email, "ana@clinica.com");
});

test("callback: conta nova sem membership => cria, mas NAO emite sessao (no_access)", async () => {
  const { deps, state, calls } = makeDeps();
  state.membership = false;
  const r = await flow.handleGoogleCallback(deps, { code: "c", state: "ST", flowToken: await startedFlow() });
  assert.deepEqual(r, { redirect: "/login?google=no_access" });
  assert.equal(calls.created.length, 1);
  assert.equal(calls.created[0].email, "ana@clinica.com");
  assert.equal(calls.created[0].passwordHash, "hash");
});

test("callback: usuario com identidade mas sem membership => no_access", async () => {
  const { deps, state } = makeDeps();
  state.identity = { userId: "u1" };
  state.membership = false;
  assert.deepEqual(await flow.handleGoogleCallback(deps, { code: "c", state: "ST", flowToken: await startedFlow() }), { redirect: "/login?google=no_access" });
});

test("callback: erro de banco (ex.: P2002 em corrida) vira error, sem sessao", async () => {
  const { deps } = makeDeps();
  deps.repo.createUserWithIdentity = async () => { throw new Error("P2002"); };
  assert.deepEqual(await flow.handleGoogleCallback(deps, { code: "c", state: "ST", flowToken: await startedFlow() }), err);
});
