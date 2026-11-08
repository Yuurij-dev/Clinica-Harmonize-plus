import assert from "node:assert/strict";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import * as rules from "../src/lib/google-oauth-rules.ts";
import * as flow from "../src/lib/google-oauth-flow.ts";
import * as g from "../src/lib/google-oauth.ts";

console.warn = () => {}; // diagnostico esperado nos caminhos de erro

const CID = "cid.apps.googleusercontent.com";
const { publicKey, privateKey } = await generateKeyPair("RS256");
const other = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), alg: "RS256", kid: "k1" };
const keys = createLocalJWKSet({ keys: [jwk] });
const sign = (claims, { key = privateKey, alg = "RS256", exp = "1h" } = {}) =>
  new SignJWT({ email: "a@x.com", email_verified: true, ...claims })
    .setProtectedHeader({ alg, kid: "k1" }).setIssuer(claims.iss ?? "https://accounts.google.com")
    .setAudience(claims.aud ?? CID).setSubject("sub-1").setIssuedAt().setExpirationTime(exp).sign(key);

test("verifyGoogleIdToken: valido, issuer alternativo e azp correto", async () => {
  assert.equal((await g.verifyGoogleIdToken(await sign({}), CID, keys)).sub, "sub-1");
  assert.equal((await g.verifyGoogleIdToken(await sign({ iss: "accounts.google.com" }), CID, keys)).sub, "sub-1");
  assert.equal((await g.verifyGoogleIdToken(await sign({ azp: CID }), CID, keys)).sub, "sub-1");
  assert.equal((await g.verifyGoogleIdToken(await sign({ aud: [CID, "x"], azp: CID }), CID, keys)).sub, "sub-1");
});

test("verifyGoogleIdToken: recusas", async () => {
  const bad = [
    ["iss errado", sign({ iss: "https://evil.com" })],
    ["aud errado", sign({ aud: "outro" })],
    ["expirado", sign({}, { exp: Math.floor(Date.now() / 1000) - 3600 })],
    ["assinatura de outra chave", sign({}, { key: other.privateKey })],
    ["azp divergente", sign({ azp: "outro" })],
    ["aud em lista sem azp", sign({ aud: [CID, "x"] })],
  ];
  for (const [name, p] of bad) {
    await assert.rejects(g.verifyGoogleIdToken(await p, CID, keys), (e) => e.code === "invalid_id_token", name);
  }
  // HS256 (confusao de algoritmo) e alg none
  const hs = await new SignJWT({}).setProtectedHeader({ alg: "HS256", kid: "k1" }).setIssuer("https://accounts.google.com").setAudience(CID).setExpirationTime("1h").sign(new TextEncoder().encode("x".repeat(40)));
  await assert.rejects(g.verifyGoogleIdToken(hs, CID, keys), (e) => e.code === "invalid_id_token");
  const none = [{ alg: "none" }, { iss: "https://accounts.google.com", aud: CID, exp: 9999999999, sub: "s" }]
    .map((o) => Buffer.from(JSON.stringify(o)).toString("base64url")).join(".") + ".";
  await assert.rejects(g.verifyGoogleIdToken(none, CID, keys), (e) => e.code === "invalid_id_token");
});

test("exchangeCodeForIdToken: corpo, metodo, timeout e erros seguros", async () => {
  const cfg = { clientId: CID, clientSecret: "SECRET", redirectUri: "https://app/cb" };
  let seen;
  const ok = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ id_token: "IDT" }), { status: 200 }); };
  assert.equal(await g.exchangeCodeForIdToken({ code: "C", codeVerifier: "V", redirectUri: cfg.redirectUri }, cfg, ok), "IDT");
  assert.equal(seen.url, "https://oauth2.googleapis.com/token");
  assert.equal(seen.init.method, "POST");
  assert.ok(seen.init.signal instanceof AbortSignal);
  assert.deepEqual(Object.fromEntries(seen.init.body), {
    code: "C", client_id: CID, client_secret: "SECRET", redirect_uri: "https://app/cb", grant_type: "authorization_code", code_verifier: "V",
  });
  const run = (f) => g.exchangeCodeForIdToken({ code: "C", codeVerifier: "V", redirectUri: "r" }, cfg, f);
  await assert.rejects(run(async () => new Response("{}", { status: 400 })), (e) => e.code === "exchange_failed" && !e.message.includes("SECRET"));
  await assert.rejects(run(async () => { throw new DOMException("t", "TimeoutError"); }), (e) => e.code === "exchange_failed");
  await assert.rejects(run(async () => new Response("{}", { status: 200 })), (e) => e.code === "no_id_token");
  await assert.rejects(run(async () => new Response("nao-json", { status: 200 })), (e) => e.code === "no_id_token");
});

test("getGoogleConfig: producao, desenvolvimento e URL invalida", () => {
  const base = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" };
  assert.equal(g.getGoogleConfig({}), null);
  assert.equal(g.getGoogleConfig({ GOOGLE_CLIENT_ID: "id" }), null);
  assert.equal(g.getGoogleConfig({ ...base, NODE_ENV: "production" }), null);
  assert.equal(g.getGoogleConfig({ ...base, NODE_ENV: "development" }).redirectUri, "http://localhost:3000/api/auth/google/callback");
  assert.equal(g.getGoogleConfig({ ...base, NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://app.harmonize.com/x/" }).redirectUri, "https://app.harmonize.com/api/auth/google/callback");
  assert.equal(g.getGoogleConfig({ ...base, NEXT_PUBLIC_SITE_URL: "nao e url" }), null);
});

// --- callback: bloqueio, senha provisoria, link, P2002 ---
const secret = new TextEncoder().encode("a".repeat(40));
const now = new Date("2026-06-01T12:00:00.000Z");
const config = { clientId: CID, clientSecret: "s", redirectUri: "https://app/cb" };
const claims = { iss: "https://accounts.google.com", aud: CID, exp: Math.floor(now.getTime() / 1000) + 3600, nonce: "N", sub: "sub-1", email: "ana@x.com", email_verified: true, name: "Ana" };
const tokenFor = (intent = "login") => rules.signOauthFlow({ state: "ST", nonce: "N", codeVerifier: "V", intent }, secret);
function deps(over = {}, st = {}) {
  const s = { identity: { userId: "u1" }, userByEmail: null, membership: true, access: { lockedUntil: null, mustChangePassword: false }, ...st };
  const calls = { touched: 0, linked: 0, created: 0 };
  return {
    calls,
    deps: {
      config, secret, now: () => now, exchange: async () => "t", verify: async () => claims,
      repo: {
        findIdentity: async () => s.identity, findUserByEmail: async () => s.userByEmail, hasMembership: async () => s.membership,
        getUserAccess: async () => s.access, touchIdentity: async () => { calls.touched++; },
        linkIdentity: async () => { calls.linked++; }, createUserWithIdentity: async () => { calls.created++; return "n"; },
      },
      getSessionUser: async () => null, makePasswordHash: async () => "h", ...over,
    },
  };
}

test("callback: conta bloqueada ou com senha provisoria => recusa sem sessao nem escrita", async () => {
  const input = async () => ({ code: "c", state: "ST", flowToken: await tokenFor() });
  const locked = deps({}, { access: { lockedUntil: new Date(now.getTime() + 1000), mustChangePassword: false } });
  assert.deepEqual(await flow.handleGoogleCallback(locked.deps, await input()), { redirect: "/login?google=locked" });
  assert.equal(locked.calls.touched, 0);
  const past = deps({}, { access: { lockedUntil: new Date(now.getTime() - 1000), mustChangePassword: false } });
  assert.equal((await flow.handleGoogleCallback(past.deps, await input())).sessionUserId, "u1");
  const must = deps({}, { access: { lockedUntil: null, mustChangePassword: true } });
  assert.deepEqual(await flow.handleGoogleCallback(must.deps, await input()), { redirect: "/login?google=must_change_password" });
  assert.equal(must.calls.touched, 0);
});

test("callback: link respeita bloqueio e senha provisoria", async () => {
  const st = { identity: null, userByEmail: { id: "u2" }, access: { lockedUntil: null, mustChangePassword: true } };
  const d = deps({ getSessionUser: async () => ({ id: "u2", email: "ana@x.com" }) }, st);
  assert.deepEqual(await flow.handleGoogleCallback(d.deps, { code: "c", state: "ST", flowToken: await tokenFor("link") }), { redirect: "/login?google=must_change_password" });
  assert.equal(d.calls.linked, 0);
});

test("callback: link com sessionUser de e-mail diferente => error, sem vincular", async () => {
  const d = deps({ getSessionUser: async () => ({ id: "u2", email: "outro@x.com" }) }, { identity: null, userByEmail: null });
  assert.deepEqual(await flow.handleGoogleCallback(d.deps, { code: "c", state: "ST", flowToken: await tokenFor("link") }), { redirect: "/login?google=error" });
  assert.equal(d.calls.linked, 0);
});

test("callback: P2002 em linkIdentity e na criacao => error sem sessao", async () => {
  const p2002 = Object.assign(new Error("dup"), { code: "P2002" });
  const l = deps({ getSessionUser: async () => ({ id: "u2", email: "ana@x.com" }) }, { identity: null, userByEmail: { id: "u2" } });
  l.deps.repo.linkIdentity = async () => { throw p2002; };
  assert.deepEqual(await flow.handleGoogleCallback(l.deps, { code: "c", state: "ST", flowToken: await tokenFor("link") }), { redirect: "/login?google=error" });
  const c = deps({}, { identity: null, userByEmail: null });
  c.deps.repo.createUserWithIdentity = async () => { throw p2002; };
  assert.deepEqual(await flow.handleGoogleCallback(c.deps, { code: "c", state: "ST", flowToken: await tokenFor() }), { redirect: "/login?google=error" });
});

test("diagnostico: so codigo estavel, nunca mensagem ou segredo", async () => {
  const logged = [];
  const orig = console.warn;
  console.warn = (...a) => logged.push(a);
  try {
    const d = deps({ exchange: async () => { throw Object.assign(new Error("code=SEGREDO-123"), { code: "exchange_failed" }); } });
    await flow.handleGoogleCallback(d.deps, { code: "SEGREDO-123", state: "ST", flowToken: await tokenFor() });
  } finally { console.warn = orig; }
  assert.deepEqual(logged, [["[google-oauth]", "exchange_failed"]]);
});

test("allowlist RS256: PS256 e recusado mesmo com chave valida no JWKS", async () => {
  const ps = await generateKeyPair("PS256");
  const psKeys = createLocalJWKSet({ keys: [{ ...(await exportJWK(ps.publicKey)), alg: "PS256", kid: "k1" }] });
  const token = await sign({}, { key: ps.privateKey, alg: "PS256" });
  await assert.rejects(g.verifyGoogleIdToken(token, CID, psKeys), (e) => e.code === "invalid_id_token");
  assert.equal((await g.verifyGoogleIdToken(await sign({}), CID, keys)).sub, "sub-1"); // RS256 continua valido
});

test("tolerancia de relogio de 5 s alinhada entre jwtVerify e validateGoogleClaims", async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  assert.equal((await g.verifyGoogleIdToken(await sign({}, { exp: nowSec - 3 }), CID, keys)).sub, "sub-1");
  await assert.rejects(g.verifyGoogleIdToken(await sign({}, { exp: nowSec - 30 }), CID, keys), (e) => e.code === "invalid_id_token");
  const ctx = { clientId: CID, nonce: "N", now: new Date() };
  const c = (exp) => rules.validateGoogleClaims({ iss: "accounts.google.com", aud: CID, exp, nonce: "N", sub: "s", email: "a@x.com", email_verified: true }, ctx);
  assert.equal(c(nowSec - 3).ok, true);
  assert.equal(c(nowSec - 30).ok, false);
});

test("diagnostico: codigo fora do padrao vira unknown", async () => {
  const logged = [];
  const orig = console.warn;
  console.warn = (...a) => logged.push(a);
  try {
    const d = deps({ exchange: async () => { throw Object.assign(new Error("x"), { code: "tem espaco e segredo=abc" }); } });
    await flow.handleGoogleCallback(d.deps, { code: "c", state: "ST", flowToken: await tokenFor() });
  } finally { console.warn = orig; }
  assert.deepEqual(logged, [["[google-oauth]", "unknown"]]);
});
