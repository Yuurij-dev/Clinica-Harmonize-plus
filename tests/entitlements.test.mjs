import assert from "node:assert/strict";
import { test } from "node:test";
import { canWriteCore, checkFeature, checkLimit, limitStatus, PAST_DUE_GRACE_DAYS, resolveEntitlements } from "../src/lib/entitlements.ts";
import { applyDependencies, featureDependencies, features, planCatalog, resolvePlanFeatures } from "../src/lib/plans.ts";

const now = new Date("2026-11-15T12:00:00.000Z");
const hours = (n) => new Date(now.getTime() + n * 3_600_000);
const sub = (patch) => ({ plan: null, status: "TRIALING", trialEndsAt: null, ...patch });

test("trial in progress: premium features, full access, unlimited", () => {
  const ent = resolveEntitlements(sub({ trialEndsAt: hours(24) }), now);
  assert.equal(ent.plan, "premium");
  assert.equal(ent.accessMode, "full");
  assert.equal(ent.reason, "trial");
  assert.deepEqual([...ent.features].sort(), [...features].sort());
  assert.deepEqual(ent.limits, { professionals: null, patients: null });
});

test("trial without end date keeps today's behaviour (never expires)", () => {
  const ent = resolveEntitlements(sub({ trialEndsAt: null }), now);
  assert.equal(ent.accessMode, "full");
  assert.equal(ent.reason, "trial");
});

test("trial ends exactly now: readonly (same rule as trialEndsAt <= now)", () => {
  assert.equal(resolveEntitlements(sub({ trialEndsAt: now }), now).accessMode, "readonly");
  assert.equal(resolveEntitlements(sub({ trialEndsAt: hours(-1) }), now).reason, "trial_expired");
  assert.equal(resolveEntitlements(sub({ trialEndsAt: hours(1) }), now).accessMode, "full");
});

test("expired trial: readonly but features stay visible (nothing is hidden)", () => {
  const ent = resolveEntitlements(sub({ trialEndsAt: hours(-48) }), now);
  assert.equal(ent.accessMode, "readonly");
  assert.equal(ent.features.has("stock"), true);
  assert.equal(checkFeature(ent, "stock", "read").allowed, true);
  assert.deepEqual(checkFeature(ent, "stock", "write"), { allowed: false, code: "SUBSCRIPTION_READONLY", feature: "stock" });
  assert.equal(canWriteCore(ent), false);
});

test("active Start: no gated feature, limits 2 professionals / 100 patients", () => {
  const ent = resolveEntitlements(sub({ plan: "start", status: "ACTIVE" }), now);
  assert.equal(ent.accessMode, "full");
  assert.equal(ent.reason, "subscription");
  assert.equal(ent.features.size, 0);
  assert.deepEqual(ent.limits, { professionals: 2, patients: 100 });
  assert.deepEqual(checkFeature(ent, "stock"), { allowed: false, code: "PLAN_FEATURE", feature: "stock", requiredPlan: "pro" });
  assert.equal(checkFeature(ent, "reports").allowed, false);
  assert.equal(canWriteCore(ent), true);
});

test("active Pro: management yes, premium-only no", () => {
  const ent = resolveEntitlements(sub({ plan: "pro", status: "ACTIVE" }), now);
  assert.equal(checkFeature(ent, "stock", "write").allowed, true);
  assert.equal(checkFeature(ent, "costs", "write").allowed, true);
  assert.deepEqual(checkFeature(ent, "googleCalendar"), { allowed: false, code: "PLAN_FEATURE", feature: "googleCalendar", requiredPlan: "premium" });
  assert.equal(checkFeature(ent, "reportsConsolidated").allowed, false);
  assert.deepEqual(ent.limits, { professionals: 5, patients: null });
});

test("active Premium: everything, unlimited", () => {
  const ent = resolveEntitlements(sub({ plan: "premium", status: "ACTIVE" }), now);
  for (const feature of features) assert.equal(checkFeature(ent, feature, "write").allowed, true, feature);
  assert.deepEqual(ent.limits, { professionals: null, patients: null });
});

const days = (n) => new Date(now.getTime() + n * 86_400_000);
const paid = (status, periodEnd, plan = "pro") => resolveEntitlements({ plan, status, trialEndsAt: null, currentPeriodEnd: periodEnd }, now);

test("ACTIVE: full until currentPeriodEnd; at or after it, readonly; no end date = status rules", () => {
  assert.equal(paid("ACTIVE", null).accessMode, "full");
  assert.equal(paid("ACTIVE", undefined).accessMode, "full");
  const inside = paid("ACTIVE", days(10));
  assert.equal(inside.accessMode, "full");
  assert.equal(inside.reason, "subscription");
  assert.equal(inside.accessEndsAt?.getTime(), days(10).getTime());
  assert.equal(paid("ACTIVE", now).accessMode, "readonly");          // exatamente no vencimento
  assert.equal(paid("ACTIVE", days(-1)).accessMode, "readonly");
  assert.equal(paid("ACTIVE", days(-1)).reason, "subscription_inactive");
  assert.equal(paid("ACTIVE", new Date("x")).accessMode, "readonly"); // data inválida nunca vira "sem fim"
  assert.equal(paid("ACTIVE", "2099-01-01").accessMode, "readonly");  // não-Date idem
  assert.equal(checkFeature(paid("ACTIVE", days(-1)), "stock", "read").allowed, true);   // consulta continua
  assert.equal(checkFeature(paid("ACTIVE", days(-1)), "stock", "write").allowed, false);
});

test("CANCELED: full access until the end of the paid period, then readonly", () => {
  const running = paid("CANCELED", days(5));
  assert.equal(running.accessMode, "full");
  assert.equal(running.reason, "canceled_until_period_end");
  assert.equal(running.accessEndsAt?.getTime(), days(5).getTime());
  assert.equal(checkFeature(running, "finance", "write").allowed, true);
  assert.equal(paid("CANCELED", now).accessMode, "readonly");
  assert.equal(paid("CANCELED", days(-3)).reason, "subscription_inactive");
  assert.equal(paid("CANCELED", null).accessMode, "readonly");        // sem período pago conhecido: nada a honrar
  assert.equal(paid("CANCELED", new Date("x")).accessMode, "readonly");
});

test("PAST_DUE: 7 days of grace after the due date, then readonly", () => {
  assert.equal(PAST_DUE_GRACE_DAYS, 7);
  const dueYesterday = paid("PAST_DUE", days(-1));
  assert.equal(dueYesterday.accessMode, "full");
  assert.equal(dueYesterday.reason, "grace_period");
  assert.equal(dueYesterday.accessEndsAt?.getTime(), days(6).getTime());
  assert.equal(paid("PAST_DUE", days(-6.9)).accessMode, "full");
  assert.equal(paid("PAST_DUE", days(-7)).accessMode, "readonly");    // fim exato da carência
  assert.equal(paid("PAST_DUE", days(-8)).reason, "subscription_inactive");
  assert.equal(paid("PAST_DUE", days(2)).accessMode, "full");         // vencimento ainda no futuro
  assert.equal(paid("PAST_DUE", null).accessMode, "readonly");        // sem vencimento conhecido: falha fechada
  assert.equal(paid("PAST_DUE", new Date("x")).accessMode, "readonly");
});

test("EXPIRED: readonly immediately, even with a future period end; features stay visible", () => {
  const ent = paid("EXPIRED", days(30));
  assert.equal(ent.accessMode, "readonly");
  assert.equal(ent.reason, "subscription_inactive");
  assert.equal(ent.accessEndsAt, null);
  assert.equal(checkFeature(ent, "finance", "read").allowed, true);
  assert.deepEqual(checkFeature(ent, "finance", "write"), { allowed: false, code: "SUBSCRIPTION_READONLY", feature: "finance" });
  assert.equal(paid("EXPIRED", null).accessMode, "readonly");
});

test("paid statuses need a valid plan: otherwise fail closed with no features", () => {
  for (const status of ["ACTIVE", "CANCELED", "PAST_DUE", "EXPIRED"]) {
    const ent = resolveEntitlements({ plan: null, status, currentPeriodEnd: days(10) }, now);
    assert.equal(ent.accessMode, "readonly", status);
    assert.equal(ent.features.size, 0, status);
    assert.equal(ent.reason, "no_subscription", status);
  }
});

test("status transitions over time: ACTIVE -> CANCELED (paid period) -> readonly; PAST_DUE -> grace -> readonly", () => {
  const sub0 = (status, end) => ({ plan: "premium", status, currentPeriodEnd: end });
  const at = (n) => new Date(now.getTime() + n * 86_400_000);
  // contratou, vigente
  assert.equal(resolveEntitlements(sub0("ACTIVE", at(20)), now).accessMode, "full");
  // cancelou hoje: segue com acesso completo até o fim do período
  assert.equal(resolveEntitlements(sub0("CANCELED", at(20)), now).accessMode, "full");
  assert.equal(resolveEntitlements(sub0("CANCELED", at(20)), at(19.9)).accessMode, "full");
  assert.equal(resolveEntitlements(sub0("CANCELED", at(20)), at(20)).accessMode, "readonly");
  // venceu sem pagar: carência de 7 dias
  assert.equal(resolveEntitlements(sub0("PAST_DUE", at(20)), at(20)).reason, "grace_period");
  assert.equal(resolveEntitlements(sub0("PAST_DUE", at(20)), at(26.9)).accessMode, "full");
  assert.equal(resolveEntitlements(sub0("PAST_DUE", at(20)), at(27)).accessMode, "readonly");
});

test("legacy clinic (TRIALING, no dates) keeps full access and gets no artificial expiry", () => {
  const ent = resolveEntitlements({ plan: null, status: "TRIALING", trialEndsAt: null, currentPeriodEnd: null }, new Date("2099-01-01"));
  assert.equal(ent.accessMode, "full");
  assert.equal(ent.reason, "trial");
  assert.equal(ent.accessEndsAt, null);
});

test("fail closed: missing, inconsistent or unknown subscription never grants features or writes", () => {
  for (const input of [null, undefined, sub({ plan: null, status: "ACTIVE" }), sub({ plan: "gold", status: "ACTIVE" }), sub({ plan: "pro", status: "WHATEVER" }), sub({ plan: null, status: "CANCELED" })]) {
    const ent = resolveEntitlements(input, now);
    assert.equal(ent.accessMode, "readonly");
    assert.equal(ent.features.size, 0);
    assert.equal(ent.plan, null);
    assert.equal(canWriteCore(ent), false);
    assert.equal(checkLimit(ent, "patients", 0).allowed, false);
  }
  assert.equal(resolveEntitlements(null, now).reason, "no_subscription");
});

test("a contracted plan during trial does not change trial rights", () => {
  const ent = resolveEntitlements(sub({ plan: "start", status: "TRIALING", trialEndsAt: hours(5) }), now);
  assert.equal(ent.plan, "premium");
  assert.equal(ent.contractedPlan, "start");
  assert.equal(ent.features.has("googleCalendar"), true);
});

test("feature decisions never throw and are deterministic", () => {
  const ent = resolveEntitlements(sub({ plan: "start", status: "ACTIVE" }), now);
  assert.deepEqual(checkFeature(ent, "stock"), checkFeature(ent, "stock"));
  assert.equal(resolvePlanFeatures("start").size, 0);
});

test("limit: Start professionals (2) — third is blocked", () => {
  const ent = resolveEntitlements(sub({ plan: "start", status: "ACTIVE" }), now);
  assert.deepEqual(checkLimit(ent, "professionals", 0), { allowed: true, limit: 2, used: 0, remaining: 1 });
  assert.deepEqual(checkLimit(ent, "professionals", 1), { allowed: true, limit: 2, used: 1, remaining: 0 });
  assert.deepEqual(checkLimit(ent, "professionals", 2), { allowed: false, code: "PLAN_LIMIT", resource: "professionals", limit: 2, used: 2, remaining: 0 });
});

test("limit: Pro professionals (5) — sixth is blocked; pending invites reserve slots via `used`", () => {
  const ent = resolveEntitlements(sub({ plan: "pro", status: "ACTIVE" }), now);
  assert.equal(checkLimit(ent, "professionals", 4).allowed, true);
  assert.equal(checkLimit(ent, "professionals", 5).allowed, false);
  // 3 membros + 2 convites pendentes = 5 usados -> não cabe mais um
  assert.equal(checkLimit(ent, "professionals", 3 + 2).allowed, false);
  assert.equal(checkLimit(ent, "professionals", 3 + 1).allowed, true);
});

test("limit: Premium has no professional limit", () => {
  const ent = resolveEntitlements(sub({ plan: "premium", status: "ACTIVE" }), now);
  assert.deepEqual(checkLimit(ent, "professionals", 10_000), { allowed: true, limit: null, used: 10_000, remaining: null });
});

test("limit: Start patients (100) — 101st is blocked; Pro/Premium unlimited", () => {
  const start = resolveEntitlements(sub({ plan: "start", status: "ACTIVE" }), now);
  assert.equal(checkLimit(start, "patients", 99).allowed, true);
  assert.equal(checkLimit(start, "patients", 100).allowed, false);
  assert.equal(checkLimit(start, "patients", 100).code, "PLAN_LIMIT");
  for (const plan of ["pro", "premium"]) assert.equal(checkLimit(resolveEntitlements(sub({ plan, status: "ACTIVE" }), now), "patients", 5000).allowed, true);
});

test("limit: downgrade with usage above the limit only blocks new records (no negative remaining)", () => {
  const start = resolveEntitlements(sub({ plan: "start", status: "ACTIVE" }), now);
  const decision = checkLimit(start, "patients", 400);
  assert.equal(decision.allowed, false);
  assert.equal(decision.remaining, 0);
  assert.equal(limitStatus(start, "patients", 400).level, "exceeded");
});

test("limit: adding more than one at once respects the remaining room", () => {
  const start = resolveEntitlements(sub({ plan: "start", status: "ACTIVE" }), now);
  assert.equal(checkLimit(start, "patients", 98, 2).allowed, true);
  assert.equal(checkLimit(start, "patients", 98, 3).allowed, false);
});

test("limit: readonly blocks adding even when under the limit", () => {
  const ent = resolveEntitlements(sub({ plan: "premium", status: "CANCELED" }), now);
  assert.deepEqual(checkLimit(ent, "patients", 0), { allowed: false, code: "SUBSCRIPTION_READONLY", resource: "patients", limit: null, used: 0, remaining: 0 });
});

test("limit: broken inputs throw instead of silently allowing (fail closed)", () => {
  const start = resolveEntitlements(sub({ plan: "start", status: "ACTIVE" }), now);
  for (const used of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, "3", null, undefined]) {
    assert.throws(() => checkLimit(start, "patients", used), TypeError, String(used));
    assert.throws(() => limitStatus(start, "patients", used), TypeError, String(used));
  }
  for (const adding of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) assert.throws(() => checkLimit(start, "patients", 0, adding), TypeError, String(adding));
  for (const resource of ["toString", "constructor", "__proto__", "storage", "", null, undefined, 7]) {
    assert.throws(() => checkLimit(start, resource, 0), TypeError, String(resource));
    assert.throws(() => limitStatus(start, resource, 0), TypeError, String(resource));
  }
  assert.equal(checkLimit(start, "patients", 100, 1).allowed, false);
});

test("trial: invalid dates fail closed (expired), never grant premium forever", () => {
  for (const trialEndsAt of [new Date("x"), "2099-01-01T00:00:00.000Z", 4102444800000, {}, false]) {
    const ent = resolveEntitlements(sub({ trialEndsAt }), now);
    assert.equal(ent.accessMode, "readonly", String(trialEndsAt));
    assert.equal(ent.reason, "trial_expired", String(trialEndsAt));
  }
  // `now` inválido também falha fechado (quando há data de término)
  assert.equal(resolveEntitlements(sub({ trialEndsAt: hours(24) }), new Date("x")).accessMode, "readonly");
  // sem data (legado) continua sem expirar, mesmo com undefined
  assert.equal(resolveEntitlements({ plan: null, status: "TRIALING" }, now).accessMode, "full");
});

test("no subscription exposes the most restrictive limits, not unlimited", () => {
  const ent = resolveEntitlements(null, now);
  assert.deepEqual(ent.limits, { professionals: 2, patients: 100 });
  assert.equal(limitStatus(ent, "patients", 100).level, "reached");
});

test("catalog is frozen at runtime and limits cannot be tampered with", () => {
  const ent = resolveEntitlements(sub({ plan: "start", status: "ACTIVE" }), now);
  assert.equal(Object.isFrozen(planCatalog), true);
  assert.equal(Object.isFrozen(planCatalog.start.limits), true);
  assert.equal(Object.isFrozen(planCatalog.pro.features), true);
  assert.equal(Object.isFrozen(featureDependencies), true);
  assert.throws(() => { ent.limits.patients = null; }, TypeError);
  assert.equal(checkLimit(ent, "patients", 100).allowed, false);
});

test("prototype keys never become features or plans", () => {
  assert.equal(resolvePlanFeatures("__proto__").size, 0);
  assert.equal(resolvePlanFeatures("constructor").size, 0);
  assert.equal(applyDependencies(["constructor", "__proto__", "toString"]).size, 0);
  const ent = resolveEntitlements(sub({ plan: "premium", status: "ACTIVE" }), now);
  assert.equal(checkFeature(ent, "constructor").allowed, false);
  assert.equal(checkFeature(ent, "__proto__").allowed, false);
  assert.equal(resolveEntitlements(sub({ plan: "__proto__", status: "ACTIVE" }), now).accessMode, "readonly");
});

test("limitStatus: ok, near (>=80%), reached, exceeded, unlimited", () => {
  const start = resolveEntitlements(sub({ plan: "start", status: "ACTIVE" }), now);
  assert.equal(limitStatus(start, "patients", 50).level, "ok");
  assert.equal(limitStatus(start, "patients", 80).level, "near");
  assert.equal(limitStatus(start, "patients", 100).level, "reached");
  assert.equal(limitStatus(start, "patients", 101).level, "exceeded");
  assert.equal(limitStatus(start, "professionals", 1).level, "ok");
  assert.equal(limitStatus(start, "professionals", 2).level, "reached");
  const premium = resolveEntitlements(sub({ plan: "premium", status: "ACTIVE" }), now);
  assert.deepEqual(limitStatus(premium, "patients", 9999), { resource: "patients", limit: null, used: 9999, level: "ok" });
});
