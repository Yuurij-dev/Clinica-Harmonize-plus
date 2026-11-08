import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test, { after } from "node:test";
import { registerHooks } from "node:module";
import { PrismaClient } from "@prisma/client";
import { completeGoogleSignup } from "../src/lib/google-signup.ts";

// completeGoogleSignup contra o Postgres LOCAL (atomicidade e unicidade reais). Ignora se o banco nao for
// localhost/127.0.0.1 banco harmonize. Cria so dados com prefixo unico e remove por IDs/prefixo proprios.

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    const match = readFileSync(file, "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (match) return match[1];
  }
  return null;
}

// google-signup-db.ts importa "./prisma" sem extensao (o Next resolve, o Node puro nao): este hook so
// completa ".ts" em imports relativos, sem alterar o codigo de producao.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); } catch (error) {
      if (specifier.startsWith(".") && !/\.\w+$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
});
const { prismaSignupRepo } = await import("../src/lib/google-signup-db.ts");
const { prisma: appPrisma } = await import("../src/lib/prisma.ts");

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
    } catch {
      skipReason = "banco local nao respondeu: teste de banco ignorado";
      await prisma.$disconnect().catch(() => {});
      prisma = null;
    }
  }
}
const opts = { skip: skipReason ?? false };

const tag = `zz-e2e-gsu-${Date.now()}`;
const mail = (label) => `${tag}-${label}@example.invalid`;
const repo = prisma ? prismaSignupRepo : null;
const profile = { clinicName: `${tag} Clinica`, name: "Dona Teste", phone: "11999990000", profession: "Biomedica", practiceArea: "Estetica", hasSecretary: "Sim" };

let suffixN = 0;
const run = (pending, prof = profile, hashCalls = { n: 0 }, now = new Date()) =>
  completeGoogleSignup(repo, {
    pending,
    profile: prof,
    makePasswordHash: async () => { hashCalls.n += 1; return "hash-teste"; },
    newSuffix: () => `${tag.slice(-4)}${++suffixN}`.padEnd(8, "x"),
  }, now);

const counts = async () => ({
  clinics: await prisma.clinic.count({ where: { name: { startsWith: tag } } }),
  users: await prisma.user.count({ where: { email: { startsWith: tag } } }),
  identities: await prisma.userIdentity.count({ where: { providerSubject: { startsWith: tag } } }),
});

after(async () => {
  if (!prisma) return;
  try {
    const users = (await prisma.user.findMany({ where: { email: { startsWith: tag } }, select: { id: true } })).map((u) => u.id);
    const clinics = (await prisma.clinic.findMany({ where: { name: { startsWith: tag } }, select: { id: true } })).map((c) => c.id);
    await prisma.clinicMembership.deleteMany({ where: { OR: [{ clinicId: { in: clinics } }, { userId: { in: users } }] } });
    await prisma.userIdentity.deleteMany({ where: { OR: [{ userId: { in: users } }, { providerSubject: { startsWith: tag } }] } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.clinic.deleteMany({ where: { id: { in: clinics } } });
  } finally {
    await prisma.$disconnect();
    await appPrisma.$disconnect();
  }
});

test("conta nova: cria Clinic + User ADMIN + identidade Google + membership owner (trial 3 dias)", opts, async () => {
  const pending = { sub: `${tag}-sub-ok`, email: mail("ok"), name: "Nome Google" };
  const now = new Date();
  const result = await run(pending, profile, { n: 0 }, now);
  assert.equal(result.ok, true);
  const user = await prisma.user.findUnique({ where: { id: result.userId } });
  assert.equal(user.email, pending.email);
  assert.equal(user.role, "ADMIN");
  assert.equal(user.name, "Dona Teste");
  assert.ok(user.emailVerifiedAt);
  const identity = await prisma.userIdentity.findUnique({ where: { provider_providerSubject: { provider: "google", providerSubject: pending.sub } } });
  assert.equal(identity.userId, user.id);
  const memberships = await prisma.clinicMembership.findMany({ where: { userId: user.id }, include: { clinic: true } });
  assert.equal(memberships.length, 1);
  assert.equal(memberships[0].isOwner, true);
  assert.equal(memberships[0].role, "ADMIN");
  assert.equal(memberships[0].clinic.name, profile.clinicName);
  const days = (memberships[0].clinic.trialEndsAt - memberships[0].clinic.trialStartedAt) / 86_400_000;
  assert.equal(days, 3);
  assert.ok(Math.abs(memberships[0].clinic.trialStartedAt - now) < 1000);
});

test("e-mail ja existente: account_exists e nada criado", opts, async () => {
  const email = mail("dup-email");
  const before = await prisma.user.create({ data: { name: "Existente", email, passwordHash: "x", role: "STAFF" } });
  const base = await counts();
  const result = await run({ sub: `${tag}-sub-dup-email`, email, name: "N" });
  assert.deepEqual(result, { ok: false, code: "account_exists" });
  assert.deepEqual(await counts(), base);
  assert.equal(await prisma.userIdentity.count({ where: { userId: before.id } }), 0);
});

test("sub ja existente com outro e-mail: account_exists e nada criado", opts, async () => {
  const sub = `${tag}-sub-dup-sub`;
  assert.equal((await run({ sub, email: mail("sub-a"), name: "N" })).ok, true);
  const base = await counts();
  const result = await run({ sub, email: mail("sub-b"), name: "N" });
  assert.deepEqual(result, { ok: false, code: "account_exists" });
  assert.deepEqual(await counts(), base);
  assert.equal(await prisma.user.count({ where: { email: mail("sub-b") } }), 0);
});

test("corrida: dois cadastros simultaneos do mesmo e-mail criam so uma conta", opts, async () => {
  const pending = { sub: `${tag}-sub-race`, email: mail("race"), name: "N" };
  const base = await counts();
  const [a, b] = await Promise.all([run(pending), run(pending)]);
  assert.deepEqual([a.ok, b.ok].sort(), [false, true]);
  const failed = a.ok ? b : a;
  assert.equal(failed.code, "account_exists");
  const after = await counts();
  assert.equal(after.users, base.users + 1);
  assert.equal(after.clinics, base.clinics + 1);
  assert.equal(after.identities, base.identities + 1);
});

test("perfil invalido: recusado sem criar nada e sem gerar hash", opts, async () => {
  const base = await counts();
  const hashCalls = { n: 0 };
  const bad = [
    { ...profile, clinicName: "   " },
    { ...profile, clinicName: "x".repeat(101) },
    { ...profile, phone: "" },
    { ...profile, hasSecretary: "talvez" },
  ];
  for (const prof of bad) {
    const result = await run({ sub: `${tag}-sub-bad`, email: mail("bad"), name: "N" }, prof, hashCalls);
    assert.equal(result.ok, false);
    assert.equal(result.code, "invalid_profile");
  }
  assert.equal((await run({ sub: `${tag}-sub-bad`, email: mail("bad"), name: "N" }, null, hashCalls)).code, "invalid_profile");
  assert.equal(hashCalls.n, 0);
  assert.deepEqual(await counts(), base);
});
