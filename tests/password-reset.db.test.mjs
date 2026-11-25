import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createPrismaPasswordResetRepo, createSessionIfPasswordUnchanged, invalidatePendingResetTokens } from "../src/lib/password-reset-repo.ts";
import { generateResetToken, hashResetToken } from "../src/lib/password-reset-rules.ts";

// Concorrência, efeitos da redefinição e limite atômico contra o Postgres LOCAL. Skip se DATABASE_URL não for o banco local
// de dev ou se ele não responder. Cria só dados com prefixo único e remove tudo no final.

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    const match = readFileSync(file, "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (match) return match[1];
  }
  return null;
}

let prisma = null;
let skipReason = "DATABASE_URL não aponta para o banco local de dev (localhost, banco harmonize)";
const url = databaseUrl();
if (url) {
  let local = false;
  try { const u = new URL(url); local = ["localhost", "127.0.0.1"].includes(u.hostname) && u.pathname === "/harmonize"; } catch { /* url inválida */ }
  if (local) {
    prisma = new PrismaClient({ datasourceUrl: `${url}${url.includes("?") ? "&" : "?"}connection_limit=20&pool_timeout=20` });
    try {
      await prisma.$queryRaw`SELECT 1`;
      skipReason = null;
    } catch {
      skipReason = "banco local não respondeu";
      await prisma.$disconnect().catch(() => {});
      prisma = null;
    }
  }
}
const opts = { skip: skipReason ?? false };

const tag = `zz-e2e-reset-${Date.now()}`;
const userIds = [];
const repo = prisma ? createPrismaPasswordResetRepo(prisma) : null;
const later = () => new Date(Date.now() + 30 * 60_000);

async function makeUser(label, data = {}) {
  const user = await prisma.user.create({ data: { name: `${tag}-${label}`, email: `${tag}-${label}@example.test`, passwordHash: "antigo", ...data }, select: { id: true, email: true } });
  userIds.push(user.id);
  return user;
}

async function makeToken(userId) {
  const tokenHash = hashResetToken(generateResetToken());
  const id = await repo.createToken({ userId, tokenHash, expiresAt: later(), now: new Date() });
  return { id, tokenHash };
}

after(async () => {
  if (!prisma) return;
  await prisma.passwordResetRateLimit.deleteMany({ where: { key: { startsWith: tag } } });
  await prisma.securityEvent.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

test("limite: incrementos simultâneos contam todos e a janela vencida recomeça", opts, async () => {
  const key = `${tag}-limite`;
  const now = new Date();
  const hits = await Promise.all(Array.from({ length: 15 }, () => repo.hit(key, 60_000, now)));
  assert.deepEqual(hits.sort((a, b) => a - b), Array.from({ length: 15 }, (_, i) => i + 1));
  assert.equal(await repo.hit(key, 60_000, new Date(now.getTime() + 59_000)), 16);
  assert.equal(await repo.hit(key, 60_000, new Date(now.getTime() + 60_000)), 1);
  const row = await prisma.passwordResetRateLimit.findUnique({ where: { key } });
  assert.equal(row.expiresAt.getTime(), now.getTime() + 120_000);
});

test("solicitações simultâneas deixam exatamente um token válido", opts, async () => {
  const user = await makeUser("pedidos");
  await Promise.all(Array.from({ length: 8 }, () => makeToken(user.id)));
  assert.equal(await prisma.passwordResetToken.count({ where: { userId: user.id } }), 8);
  assert.equal(await prisma.passwordResetToken.count({ where: { userId: user.id, usedAt: null, invalidatedAt: null } }), 1);
});

test("consumo simultâneo: um sucesso; senha, sessões, dispositivos e código mudam, 2FA fica", opts, async () => {
  const user = await makeUser("consumo", { mustChangePassword: true, failedLogins: 7, lockedUntil: later() });
  const bystander = await makeUser("alheio");
  for (const userId of [user.id, bystander.id]) {
    await prisma.authSession.create({ data: { userId, expiresAt: later() } });
    await prisma.trustedDevice.create({ data: { userId, tokenHash: `${tag}-${userId}`, label: "x", expiresAt: later() } });
    await prisma.loginVerificationCode.create({ data: { userId, codeHash: "h", expiresAt: later(), lastSentAt: new Date() } });
  }
  await prisma.mfaSetting.create({ data: { userId: user.id, secretEnc: "segredo", enabledAt: new Date() } });
  await prisma.mfaRecoveryCode.createMany({ data: [{ userId: user.id, codeHash: `${tag}-rc` }] });
  await prisma.userIdentity.create({ data: { userId: user.id, provider: "google", providerSubject: `${tag}-sub`, email: user.email } });
  const token = await makeToken(user.id);

  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => repo.consume({ tokenId: token.id, userId: user.id, passwordHash: `novo-${i}` })));
  const won = results.filter(Boolean);
  assert.deepEqual(won, [{ sessions: 1, devices: 1 }]);

  const row = await prisma.user.findUnique({ where: { id: user.id } });
  assert.equal(row.passwordHash, `novo-${results.findIndex(Boolean)}`);
  assert.equal(row.mustChangePassword, false);
  assert.equal(row.failedLogins, 0);
  assert.equal(row.lockedUntil, null);
  assert.ok(row.emailVerifiedAt);
  assert.equal(await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } }), 0);
  assert.equal(await prisma.trustedDevice.count({ where: { userId: user.id, revokedAt: null } }), 0);
  assert.equal(await prisma.loginVerificationCode.count({ where: { userId: user.id } }), 0);
  assert.ok((await prisma.mfaSetting.findUnique({ where: { userId: user.id } })).enabledAt);
  assert.equal(await prisma.mfaRecoveryCode.count({ where: { userId: user.id, usedAt: null } }), 1);
  assert.equal(await prisma.userIdentity.count({ where: { userId: user.id } }), 1);
  // Outro usuário intacto.
  assert.equal(await prisma.authSession.count({ where: { userId: bystander.id, revokedAt: null } }), 1);
  assert.equal(await prisma.trustedDevice.count({ where: { userId: bystander.id, revokedAt: null } }), 1);
  assert.equal(await prisma.loginVerificationCode.count({ where: { userId: bystander.id } }), 1);
  // Login conferido com o hash antigo não vira sessão; com o novo, sim.
  const session = (passwordHash) => createSessionIfPasswordUnchanged(prisma, passwordHash, { userId: user.id, expiresAt: later() });
  assert.equal(await session("antigo"), null);
  assert.ok((await session(row.passwordHash)).id);
  assert.equal(await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } }), 1);
});

test("grupo de limites: tudo ou nada, atômico sob concorrência", opts, async () => {
  const now = new Date();
  const entries = (pair) => [{ key: `${tag}-par-${pair}`, limit: 5, windowMs: 60_000 }, { key: `${tag}-global`, limit: 4, windowMs: 60_000 }];
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => repo.hitAll(entries(i % 2), now)));
  assert.equal(results.filter(Boolean).length, 4);
  const rows = await prisma.passwordResetRateLimit.findMany({ where: { key: { startsWith: `${tag}-` } } });
  const hits = Object.fromEntries(rows.map((r) => [r.key.slice(tag.length + 1), r.hits]));
  assert.equal(hits.global, 4);
  // Os pedidos barrados não gastaram o limite do par.
  assert.equal((hits["par-0"] ?? 0) + (hits["par-1"] ?? 0), 4);
});

test("logins simultâneos à redefinição não deixam sessão ativa", opts, async () => {
  for (let round = 0; round < 5; round++) {
    const user = await makeUser(`corrida-${round}`);
    const token = await makeToken(user.id);
    const login = () => createSessionIfPasswordUnchanged(prisma, "antigo", { userId: user.id, expiresAt: later() });
    const [done, ...sessions] = await Promise.all([
      repo.consume({ tokenId: token.id, userId: user.id, passwordHash: "novo" }),
      ...Array.from({ length: 6 }, login),
    ]);
    assert.ok(done);
    // Quem entrou antes foi revogado pela redefinição; quem veio depois recebeu null.
    assert.equal(done.sessions, sessions.filter(Boolean).length);
    assert.equal(await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } }), 0);
    assert.equal(await login(), null);
  }
});

test("a criação da sessão espera a troca de senha em andamento e lê o hash novo", opts, async () => {
  const user = await makeUser("espera");
  let locked, release;
  const isLocked = new Promise((resolve) => (locked = resolve));
  const gate = new Promise((resolve) => (release = resolve));
  const resetting = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
    await tx.user.update({ where: { id: user.id }, data: { passwordHash: "novo" } });
    locked();
    await gate;
  });
  await isLocked;
  let settled = false;
  const login = createSessionIfPasswordUnchanged(prisma, "antigo", { userId: user.id, expiresAt: later() }).finally(() => (settled = true));
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(settled, false);
  release();
  await resetting;
  assert.equal(await login, null);
});

test("token invalidado, expirado ou de outro usuário não altera nada", opts, async () => {
  const user = await makeUser("recusas");
  const other = await makeUser("recusas-outro");
  const first = await makeToken(user.id);
  await invalidatePendingResetTokens(prisma, user.id);
  assert.equal(await repo.consume({ tokenId: first.id, userId: user.id, passwordHash: "novo" }), null);
  const second = await makeToken(user.id);
  assert.equal(await repo.consume({ tokenId: second.id, userId: other.id, passwordHash: "novo" }), null);
  await prisma.passwordResetToken.update({ where: { id: second.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal(await repo.consume({ tokenId: second.id, userId: user.id, passwordHash: "novo" }), null);
  assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).passwordHash, "antigo");
  assert.equal((await prisma.user.findUnique({ where: { id: other.id } })).passwordHash, "antigo");
});

test("faxina apaga só o que venceu; excluir o usuário leva os tokens", opts, async () => {
  const user = await makeUser("faxina");
  const old = await makeToken(user.id);
  const recent = await makeToken(user.id);
  await prisma.passwordResetToken.update({ where: { id: old.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await repo.cleanup(new Date());
  assert.deepEqual((await prisma.passwordResetToken.findMany({ where: { userId: user.id }, select: { id: true } })).map((r) => r.id), [recent.id]);
  await prisma.user.delete({ where: { id: user.id } });
  assert.equal(await prisma.passwordResetToken.count({ where: { id: recent.id } }), 0);
});
