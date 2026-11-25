import assert from "node:assert/strict";
import test from "node:test";
import { buildPasswordResetUrl } from "../src/lib/email.ts";
import { matchesPasswordFingerprint, passwordFingerprint } from "../src/lib/password-fingerprint.ts";
import { normalizeResetEmailInput, readResetTokenFromHash } from "../src/lib/password-reset-client.ts";
import * as flow from "../src/lib/password-reset-flow.ts";
import * as rules from "../src/lib/password-reset-rules.ts";

console.warn = () => {}; // diagnóstico esperado nos caminhos de falha

const SECRET = new TextEncoder().encode("s".repeat(40));
const STRONG = "Nova-Senha-123";
const IP = "198.51.100.1";
const T0 = new Date("2026-11-24T12:00:00.000Z");
const minutes = (n) => n * 60_000;

const user = (extra = {}) => ({ id: "u1", email: "ana@clinica.test", createdAt: new Date("2026-01-01"), googleIdentityCreatedAt: null, ...extra });

// Repositório em memória com a mesma semântica do Prisma (consumo condicional e uso único).
function fakeRepo(users = [user()]) {
  const state = { users, tokens: [], hits: new Map(), consumed: [] };
  const repo = {
    async hit(key, windowMs, now) {
      const row = state.hits.get(key);
      const next = !row || row.expiresAt <= now.getTime() ? { hits: 1, expiresAt: now.getTime() + windowMs } : { ...row, hits: row.hits + 1 };
      state.hits.set(key, next);
      return next.hits;
    },
    async hitAll(entries, now) {
      const current = (key) => { const row = state.hits.get(key); return row && row.expiresAt > now.getTime() ? row.hits : 0; };
      if (entries.some((e) => current(e.key) >= e.limit)) return false;
      for (const e of entries) await repo.hit(e.key, e.windowMs, now);
      return true;
    },
    async cleanup() {},
    async findUserByEmail(email) { return state.users.find((u) => u.email === email) ?? null; },
    async createToken({ userId, tokenHash, expiresAt, now }) {
      for (const t of state.tokens) if (t.userId === userId && !t.usedAt && !t.invalidatedAt) t.invalidatedAt = now;
      const id = `t${state.tokens.length + 1}`;
      state.tokens.push({ id, userId, tokenHash, expiresAt, usedAt: null, invalidatedAt: null });
      return id;
    },
    async invalidateToken(id, now) { state.tokens.find((t) => t.id === id).invalidatedAt = now; },
    async findToken(tokenHash) {
      const t = state.tokens.find((row) => row.tokenHash === tokenHash);
      return t ? { ...t, user: state.users.find((u) => u.id === t.userId) } : null;
    },
    async consume({ tokenId, userId, passwordHash }) {
      const t = state.tokens.find((row) => row.id === tokenId);
      if (!t || t.usedAt || t.invalidatedAt) return null;
      t.usedAt = new Date(T0);
      state.consumed.push({ userId, passwordHash });
      return { sessions: 2, devices: 1 };
    },
  };
  return { repo, state };
}

function setup({ users, env = {}, status = 200 } = {}) {
  const { repo, state } = fakeRepo(users);
  const sent = [];
  const devLog = [];
  const clock = { now: T0 };
  const deps = {
    repo,
    secret: SECRET,
    env: { RESEND_API_KEY: "re_test", EMAIL_FROM: "Harmonize+ <no-reply@x.test>", NEXT_PUBLIC_SITE_URL: "https://app.x.test/qualquer", NODE_ENV: "production", ...env },
    now: () => clock.now,
    fetchImpl: async (_url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify(status === 200 ? { id: "1" } : { name: "x" }), { status }); },
    hashPassword: async (p) => `hash:${p}`,
    logDevLink: (m) => devLog.push(m),
  };
  return { deps, state, sent, devLog, clock, advance: (ms) => { clock.now = new Date(clock.now.getTime() + ms); } };
}

const tokenFrom = (mail) => /#token=([A-Za-z0-9_-]+)/.exec(mail.text)[1];

async function requestToken(ctx) {
  await flow.processPasswordResetRequest("ana@clinica.test", IP, ctx.deps);
  return tokenFrom(ctx.sent.at(-1));
}

test("token: 32 bytes base64url, só o SHA-256 é guardado, validade de 30 minutos", async () => {
  const ctx = setup();
  const token = await requestToken(ctx);
  assert.equal(Buffer.from(token, "base64url").length, 32);
  assert.ok(rules.isResetTokenShape(token));
  const [row] = ctx.state.tokens;
  assert.equal(row.tokenHash, rules.hashResetToken(token));
  assert.ok(!JSON.stringify(ctx.state.tokens).includes(token));
  assert.equal(row.expiresAt.getTime() - T0.getTime(), minutes(30));
});

test("envio: botão, link em fragmento na origem configurada, validade e aviso de segurança", async () => {
  const ctx = setup();
  const token = await requestToken(ctx);
  const [mail] = ctx.sent;
  assert.deepEqual(mail.to, ["ana@clinica.test"]);
  assert.match(mail.text, new RegExp(`https://app\\.x\\.test/redefinir-senha#token=${token}`));
  assert.match(mail.html, /Redefinir senha/);
  assert.match(mail.text, /30 minutos/);
  assert.match(mail.text, /Se não foi você, ignore/);
  assert.match(mail.text, /duas etapas/);
});

test("e-mail inexistente: nada é criado nem enviado, mas os limites contam igual", async () => {
  const ctx = setup();
  await flow.processPasswordResetRequest("ninguem@x.test", IP, ctx.deps);
  assert.equal(ctx.sent.length, 0);
  assert.equal(ctx.state.tokens.length, 0);
  assert.equal(ctx.state.hits.size, 5);
  assert.ok([...ctx.state.hits.keys()].every((key) => !key.includes("ninguem")));
});

test("conta só-Google: orientação por e-mail, sem token", async () => {
  const createdAt = new Date("2026-02-01T10:00:00Z");
  const ctx = setup({ users: [user({ createdAt, googleIdentityCreatedAt: createdAt })] });
  await flow.processPasswordResetRequest("ana@clinica.test", IP, ctx.deps);
  assert.equal(ctx.state.tokens.length, 0);
  assert.match(ctx.sent[0].text, /Entrar com Google/);
  assert.doesNotMatch(ctx.sent[0].text, /token=/);
});

test("conta que vinculou o Google depois (tem senha) recebe o link", async () => {
  const ctx = setup({ users: [user({ googleIdentityCreatedAt: new Date("2026-03-01") })] });
  await requestToken(ctx);
  assert.equal(ctx.state.tokens.length, 1);
});

test("falha do provedor: o token criado é invalidado e a função não lança", async () => {
  const ctx = setup({ status: 500 });
  await flow.processPasswordResetRequest("ana@clinica.test", IP, ctx.deps);
  assert.equal(ctx.state.tokens.length, 1);
  assert.ok(ctx.state.tokens[0].invalidatedAt);
});

test("timeout no envio: o e-mail pode ter chegado, o token continua válido", async () => {
  const ctx = setup();
  ctx.deps.fetchImpl = async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); };
  await flow.processPasswordResetRequest("ana@clinica.test", IP, ctx.deps);
  assert.equal(ctx.state.tokens.length, 1);
  assert.equal(ctx.state.tokens[0].invalidatedAt, null);
});

test("configuração ausente: nenhum token nem envio", async () => {
  for (const env of [{ RESEND_API_KEY: "" }, { EMAIL_FROM: "" }, { NEXT_PUBLIC_SITE_URL: "" }]) {
    const ctx = setup({ env });
    await flow.processPasswordResetRequest("ana@clinica.test", IP, ctx.deps);
    assert.equal(ctx.state.tokens.length, 0, JSON.stringify(env));
    assert.equal(ctx.sent.length, 0);
  }
});

test("falha do banco em segundo plano não lança", async () => {
  const ctx = setup();
  ctx.deps.repo.findUserByEmail = async () => { throw new Error("db"); };
  await flow.processPasswordResetRequest("ana@clinica.test", IP, ctx.deps);
});

test("teste local (@teste.com): link no console, sem e-mail; em produção nunca", async () => {
  const users = [user({ email: "ana@teste.com" })];
  const dev = setup({ users, env: { NODE_ENV: "development", ENABLE_DEV_TEST_LOGIN: "1", NEXT_PUBLIC_SITE_URL: "", RESEND_API_KEY: "" } });
  await flow.processPasswordResetRequest("ana@teste.com", IP, dev.deps);
  assert.equal(dev.sent.length, 0);
  assert.match(dev.devLog[0], /http:\/\/localhost:3000\/redefinir-senha#token=/);
  await flow.notifyPasswordChanged("ana@teste.com", dev.deps);
  assert.equal(dev.sent.length, 0);

  const prod = setup({ users, env: { ENABLE_DEV_TEST_LOGIN: "1" } });
  await flow.processPasswordResetRequest("ana@teste.com", IP, prod.deps);
  assert.equal(prod.devLog.length, 0);
  assert.equal(prod.sent.length, 1);
});

test("nova solicitação invalida a anterior", async () => {
  const ctx = setup();
  const first = await requestToken(ctx);
  ctx.advance(minutes(1) + 1);
  const second = await requestToken(ctx);
  assert.equal(await flow.isValidResetToken(first, ctx.deps), false);
  assert.equal(await flow.isValidResetToken(second, ctx.deps), true);
});

test("limite por e-mail + IP: intervalo de 60 s, 5 por hora e 10 em 24 h", async () => {
  const ctx = setup();
  const ask = () => flow.processPasswordResetRequest("ana@clinica.test", IP, ctx.deps);
  await ask(); await ask();
  ctx.advance(59_000); await ask();
  assert.equal(ctx.sent.length, 1);
  for (let i = 0; i < 8; i++) { ctx.advance(61_000); await ask(); }
  assert.equal(ctx.sent.length, 5);
  for (let i = 0; i < 12; i++) { ctx.advance(minutes(61)); await ask(); }
  assert.equal(ctx.sent.length, 10);
  ctx.advance(minutes(24 * 60)); await ask();
  assert.equal(ctx.sent.length, 11);
});

test("pedidos barrados pelo intervalo não gastam o teto da hora", async () => {
  const ctx = setup();
  const ask = () => flow.processPasswordResetRequest("ana@clinica.test", IP, ctx.deps);
  for (let i = 0; i < 20; i++) await ask();
  for (let i = 0; i < 4; i++) { ctx.advance(61_000); await ask(); }
  assert.equal(ctx.sent.length, 5);
});

test("terceiro em um IP não esgota o limite de quem pede de outro", async () => {
  const ctx = setup();
  const ask = (ip) => flow.processPasswordResetRequest("ana@clinica.test", ip, ctx.deps);
  for (let i = 0; i < 40; i++) { await ask("203.0.113.66"); ctx.advance(minutes(20)); }
  const before = ctx.sent.length;
  assert.equal(before, 10);
  await ask(IP);
  assert.equal(ctx.sent.length, before + 1);
});

test("teto global por e-mail: intervalo de 60 s e 30 em 24 h somando IPs", async () => {
  const ctx = setup();
  const ask = (ip) => flow.processPasswordResetRequest("ana@clinica.test", ip, ctx.deps);
  await ask("10.0.0.1"); await ask("10.0.0.2");
  assert.equal(ctx.sent.length, 1);
  for (let i = 0; i < 40; i++) { ctx.advance(61_000); await ask(`10.0.1.${i}`); }
  assert.equal(ctx.sent.length, 30);
  assert.ok([...ctx.state.hits.keys()].every((key) => !key.includes("10.0.") && !key.includes("ana")));
});

test("pedido barrado não gasta nenhum limite", async () => {
  const ctx = setup();
  const ask = (ip) => flow.processPasswordResetRequest("ana@clinica.test", ip, ctx.deps);
  await ask("10.0.0.1");
  const snapshot = JSON.stringify([...ctx.state.hits]);
  await ask("10.0.0.1"); // intervalo do par
  await ask("10.0.0.2"); // intervalo global
  assert.equal(JSON.stringify([...ctx.state.hits]), snapshot);
});

test("limite por IP: estoura no limite e a chave não guarda o IP", async () => {
  const ctx = setup();
  for (let i = 0; i < rules.RESET_TOKEN_IP_LIMIT.limit; i++) assert.equal(await flow.withinResetLimit(ctx.deps, rules.RESET_TOKEN_IP_LIMIT, "203.0.113.9"), true);
  assert.equal(await flow.withinResetLimit(ctx.deps, rules.RESET_TOKEN_IP_LIMIT, "203.0.113.9"), false);
  assert.equal(await flow.withinResetLimit(ctx.deps, rules.RESET_TOKEN_IP_LIMIT, "203.0.113.10"), true);
  assert.ok([...ctx.state.hits.keys()].every((key) => !key.includes("203.0.113")));
});

test("confirmação: senha fraca, longa ou divergente não consome o token", async () => {
  const ctx = setup();
  const token = await requestToken(ctx);
  const attempt = (password, confirmation = password) => flow.confirmPasswordReset({ token, password, confirmation }, ctx.deps);
  assert.equal((await attempt("fraca")).field, "password");
  assert.equal((await attempt(`Aa1!${"x".repeat(80)}`)).field, "password");
  assert.equal((await attempt(STRONG, `${STRONG}x`)).field, "confirmation");
  assert.equal((await attempt(STRONG, undefined)).ok, true);
  assert.equal(ctx.state.consumed.length, 1);
});

test("confirmação sem o campo de confirmação é recusada", async () => {
  const ctx = setup();
  const token = await requestToken(ctx);
  const result = await flow.confirmPasswordReset({ token, password: STRONG }, ctx.deps);
  assert.equal(result.field, "confirmation");
  assert.equal(ctx.state.consumed.length, 0);
});

test("token válido troca a senha uma vez; reutilizado, expirado ou inexistente é recusado", async () => {
  const ctx = setup();
  const token = await requestToken(ctx);
  const body = { token, password: STRONG, confirmation: STRONG };
  const done = await flow.confirmPasswordReset(body, ctx.deps);
  assert.deepEqual(done, { ok: true, userId: "u1", email: "ana@clinica.test", sessions: 2, devices: 1 });
  assert.deepEqual(ctx.state.consumed, [{ userId: "u1", passwordHash: `hash:${STRONG}` }]);
  assert.equal((await flow.confirmPasswordReset(body, ctx.deps)).code, "invalid_token");

  ctx.advance(minutes(2));
  const other = await requestToken(ctx);
  ctx.advance(minutes(30));
  assert.equal((await flow.confirmPasswordReset({ ...body, token: other }, ctx.deps)).code, "invalid_token");
  for (const bad of [undefined, "", "abc", rules.generateResetToken(), 123]) {
    assert.equal((await flow.confirmPasswordReset({ ...body, token: bad }, ctx.deps)).code, "invalid_token");
  }
});

test("consumo simultâneo: exatamente um sucesso", async () => {
  const ctx = setup();
  const token = await requestToken(ctx);
  const body = { token, password: STRONG, confirmation: STRONG };
  const results = await Promise.all([flow.confirmPasswordReset(body, ctx.deps), flow.confirmPasswordReset(body, ctx.deps)]);
  assert.equal(results.filter((r) => r.ok).length, 1);
});

test("usuário que passou a ser só-Google não usa o token", async () => {
  const ctx = setup();
  const token = await requestToken(ctx);
  ctx.state.users[0].googleIdentityCreatedAt = ctx.state.users[0].createdAt;
  assert.equal(await flow.isValidResetToken(token, ctx.deps), false);
});

test("aviso de senha alterada é enviado e a falha dele não lança", async () => {
  const ctx = setup();
  await flow.notifyPasswordChanged("ana@clinica.test", ctx.deps);
  assert.match(ctx.sent[0].subject, /senha .*alterada/i);
  const failing = setup({ status: 500 });
  await flow.notifyPasswordChanged("ana@clinica.test", failing.deps);
});

test("impressão do hash nos tokens pendentes: muda com a senha, o usuário e o segredo; ausente é recusada", () => {
  const claim = passwordFingerprint("u1", "hash-antigo", SECRET);
  assert.equal(matchesPasswordFingerprint(claim, "u1", "hash-antigo", SECRET), true);
  assert.equal(matchesPasswordFingerprint(claim, "u1", "hash-novo", SECRET), false);
  assert.equal(matchesPasswordFingerprint(claim, "u2", "hash-antigo", SECRET), false);
  assert.equal(matchesPasswordFingerprint(claim, "u1", "hash-antigo", new TextEncoder().encode("x".repeat(40))), false);
  assert.equal(matchesPasswordFingerprint(undefined, "u1", "hash-antigo", SECRET), false);
  assert.ok(!claim.includes("hash"));
});

test("URL, e-mail e leitura do fragmento", () => {
  assert.equal(buildPasswordResetUrl("abc", { NODE_ENV: "production" }), null);
  assert.equal(readResetTokenFromHash("#token=abc_-1"), "abc_-1");
  assert.equal(readResetTokenFromHash(""), "");
  assert.equal(rules.normalizeResetEmail("  Ana@X.Test "), "ana@x.test");
  assert.equal(normalizeResetEmailInput("sem-arroba"), "");
  for (const bad of ["", "a@b", 1, `${"a".repeat(260)}@x.test`]) assert.equal(rules.normalizeResetEmail(bad), null);
});
