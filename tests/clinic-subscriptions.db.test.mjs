import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test, { after } from "node:test";
import { registerHooks } from "node:module";
import { PrismaClient } from "@prisma/client";

// Persistência das assinaturas contra o Postgres LOCAL: o trigger cria a assinatura de toda clínica nova espelhando o
// teste, o backfill é idempotente e não altera datas, a assinatura é única por clínica e some com a clínica (cascata).
// Ignora se DATABASE_URL não for localhost/127.0.0.1, banco harmonize. Dados com prefixo único, apagados no fim.

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    const match = readFileSync(file, "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (match) return match[1];
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); } catch (error) {
      if (specifier.startsWith(".") && !/\.\w+$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
});

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
      await prisma.clinicSubscription.count();
    } catch {
      skipReason = "banco local sem a migration clinic_subscriptions: teste de banco ignorado";
      await prisma.$disconnect().catch(() => {});
      prisma = null;
    }
  }
}
const opts = { skip: skipReason ?? false };
const { resolveEntitlements } = await import("../src/lib/entitlements.ts");

const tag = `zzsub${Date.now().toString(36)}`;
const clinicIds = [];
async function clinic(label, data = {}) {
  const created = await prisma.clinic.create({ data: { name: `${tag} ${label}`, slug: `${tag}-${label}`, ...data }, select: { id: true } });
  clinicIds.push(created.id);
  return created.id;
}

after(async () => {
  if (!prisma) return;
  if (clinicIds.length) await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
  await prisma.$disconnect();
});

const hours = (n) => new Date(Date.now() + n * 3_600_000);

test("new clinic with a trial gets a TRIALING subscription mirroring the dates, no plan, and a TRIAL_STARTED event", opts, async () => {
  const start = new Date(Date.now() - 3_600_000);
  const end = hours(72);
  const id = await clinic("trial", { trialStartedAt: start, trialEndsAt: end });
  const sub = await prisma.clinicSubscription.findUnique({ where: { clinicId: id } });
  assert.ok(sub);
  assert.equal(sub.status, "TRIALING");
  assert.equal(sub.plan, null);
  assert.equal(sub.trialStartedAt?.getTime(), start.getTime());
  assert.equal(sub.trialEndsAt?.getTime(), end.getTime());
  const events = await prisma.clinicSubscriptionEvent.findMany({ where: { clinicId: id } });
  assert.deepEqual(events.map((event) => [event.type, event.toStatus]), [["TRIAL_STARTED", "TRIALING"]]);
});

test("new clinic without trial dates keeps a null end (never expires, same rule as auth.ts) and logs no event", opts, async () => {
  const id = await clinic("legacy");
  const sub = await prisma.clinicSubscription.findUnique({ where: { clinicId: id } });
  assert.ok(sub);
  assert.equal(sub.status, "TRIALING");
  assert.equal(sub.trialEndsAt, null);
  assert.equal(await prisma.clinicSubscriptionEvent.count({ where: { clinicId: id } }), 0);
  assert.equal(resolveEntitlements(sub, new Date()).accessMode, "full");
});

test("entitlements read from the persisted row give the same trial verdict as Clinic.trialEndsAt", opts, async () => {
  const active = await clinic("vigente", { trialStartedAt: hours(-1), trialEndsAt: hours(24) });
  const expired = await clinic("vencido", { trialStartedAt: hours(-100), trialEndsAt: hours(-1) });
  for (const [id, expectedExpired] of [[active, false], [expired, true]]) {
    const row = await prisma.clinic.findUnique({ where: { id }, select: { trialEndsAt: true, subscription: true } });
    const legacyExpired = Boolean(row.trialEndsAt && row.trialEndsAt.getTime() <= Date.now()); // regra atual de auth.ts
    const ent = resolveEntitlements(row.subscription, new Date());
    assert.equal(legacyExpired, expectedExpired);
    assert.equal(ent.accessMode === "readonly", legacyExpired);
    assert.equal(ent.reason, expectedExpired ? "trial_expired" : "trial");
  }
});

test("exactly one subscription per clinic (unique clinicId)", opts, async () => {
  const id = await clinic("unico");
  await assert.rejects(() => prisma.clinicSubscription.create({ data: { clinicId: id } }), (error) => error?.code === "P2002");
  assert.equal(await prisma.clinicSubscription.count({ where: { clinicId: id } }), 1);
});

test("the backfill SQL of the migration is idempotent and never rewrites existing rows or dates", opts, async () => {
  const dir = readdirSync("prisma/migrations").find((name) => name.endsWith("_clinic_subscriptions"));
  assert.ok(dir, "migration clinic_subscriptions não encontrada");
  const sql = readFileSync(`prisma/migrations/${dir}/migration.sql`, "utf8");
  const start = sql.indexOf("WITH inserted AS");
  const end = sql.indexOf(";", sql.indexOf("FROM inserted"));
  assert.ok(start > 0 && end > start);
  const backfill = sql.slice(start, end + 1);

  const id = await clinic("backfill", { trialStartedAt: hours(-5), trialEndsAt: hours(5) });
  // Uma clínica sem assinatura (como as que existiam antes da migration): remove a criada pelo trigger.
  await prisma.clinicSubscription.delete({ where: { clinicId: id } });
  await prisma.$executeRawUnsafe(backfill);
  const created = await prisma.clinicSubscription.findUnique({ where: { clinicId: id } });
  assert.ok(created);
  assert.equal(created.status, "TRIALING");
  assert.equal(created.plan, null);
  const clinicRow = await prisma.clinic.findUnique({ where: { id }, select: { trialStartedAt: true, trialEndsAt: true } });
  assert.equal(created.trialEndsAt?.getTime(), clinicRow.trialEndsAt?.getTime());
  assert.equal(created.trialStartedAt?.getTime(), clinicRow.trialStartedAt?.getTime());
  assert.deepEqual((await prisma.clinicSubscriptionEvent.findMany({ where: { clinicId: id }, orderBy: { createdAt: "asc" } })).map((event) => event.type), ["TRIAL_STARTED", "BACKFILLED"]);

  // Reexecutar não cria nada novo e não altera as linhas já existentes (nem um plano já contratado).
  await prisma.clinicSubscription.update({ where: { clinicId: id }, data: { plan: "pro", status: "ACTIVE" } });
  const eventsBefore = await prisma.clinicSubscriptionEvent.count({ where: { clinicId: id } });
  await prisma.$executeRawUnsafe(backfill);
  // Por clinica (outros arquivos de teste criam clinicas em paralelo, entao a contagem global nao serve).
  assert.equal(await prisma.clinicSubscription.count({ where: { clinicId: id } }), 1);
  const after2 = await prisma.clinicSubscription.findUnique({ where: { clinicId: id } });
  assert.equal(after2.plan, "pro");
  assert.equal(after2.status, "ACTIVE");
  assert.equal(await prisma.clinicSubscriptionEvent.count({ where: { clinicId: id } }), eventsBefore);
});

test("the existing clinics are untouched: every clinic has a subscription and no date diverges", opts, async () => {
  const clinicsWithout = await prisma.clinic.count({ where: { subscription: null } });
  assert.equal(clinicsWithout, 0);
  const rows = await prisma.clinic.findMany({ select: { trialStartedAt: true, trialEndsAt: true, subscription: { select: { status: true, plan: true, trialStartedAt: true, trialEndsAt: true } } } });
  for (const row of rows) {
    if (row.subscription.status !== "TRIALING") continue; // linhas já alteradas por etapas futuras não precisam espelhar
    assert.equal(row.subscription.trialEndsAt?.getTime() ?? null, row.trialEndsAt?.getTime() ?? null);
    assert.equal(row.subscription.trialStartedAt?.getTime() ?? null, row.trialStartedAt?.getTime() ?? null);
  }
});

test("deleting a clinic removes its subscription and events (cascade)", opts, async () => {
  const id = await clinic("cascade", { trialStartedAt: hours(-1), trialEndsAt: hours(10) });
  assert.equal(await prisma.clinicSubscription.count({ where: { clinicId: id } }), 1);
  await prisma.clinic.delete({ where: { id } });
  clinicIds.splice(clinicIds.indexOf(id), 1);
  assert.equal(await prisma.clinicSubscription.count({ where: { clinicId: id } }), 0);
  assert.equal(await prisma.clinicSubscriptionEvent.count({ where: { clinicId: id } }), 0);
});

test("subscriptions of different clinics are independent (no cross-clinic effect)", opts, async () => {
  const a = await clinic("iso-a", { trialStartedAt: hours(-1), trialEndsAt: hours(24) });
  const b = await clinic("iso-b", { trialStartedAt: hours(-1), trialEndsAt: hours(24) });
  await prisma.clinicSubscription.update({ where: { clinicId: a }, data: { plan: "start", status: "ACTIVE" } });
  const subB = await prisma.clinicSubscription.findUnique({ where: { clinicId: b } });
  assert.equal(subB.status, "TRIALING");
  assert.equal(subB.plan, null);
});
