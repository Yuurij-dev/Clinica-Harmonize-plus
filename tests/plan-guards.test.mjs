import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveEntitlements } from "../src/lib/entitlements.ts";
import { denyIfOverLimit, denyIfReadonly, denyUnlessFeature } from "../src/lib/plan-guards.ts";
import { isPlanErrorCode, parsePlanErrorBody, planErrorBodyFromDecision, PLAN_ERROR_CODES } from "../src/lib/plan-errors.ts";
import { checkFeature, checkLimit } from "../src/lib/entitlements.ts";

const now = new Date("2026-11-15T12:00:00.000Z");
const ent = (patch) => resolveEntitlements({ plan: null, status: "TRIALING", trialEndsAt: null, currentPeriodEnd: null, ...patch }, now);
const principal = (patch) => ({ entitlements: ent(patch) });
const body = async (response) => response.json();

test("error codes are exactly the three commercial ones", () => {
  assert.deepEqual([...PLAN_ERROR_CODES], ["PLAN_FEATURE", "PLAN_LIMIT", "SUBSCRIPTION_READONLY"]);
  assert.equal(isPlanErrorCode("PLAN_LIMIT"), true);
  assert.equal(isPlanErrorCode("UNAUTHORIZED"), false);
  assert.equal(isPlanErrorCode(undefined), false);
});

test("denyIfReadonly: full access passes, readonly gets 403 SUBSCRIPTION_READONLY (never 401)", async () => {
  assert.equal(denyIfReadonly(principal({ trialEndsAt: new Date(now.getTime() + 3_600_000) })), null);
  assert.equal(denyIfReadonly(principal({})), null); // legado sem data
  for (const readonlyPrincipal of [
    principal({ trialEndsAt: new Date(now.getTime() - 1) }),
    principal({ plan: "pro", status: "EXPIRED" }),
    principal({ plan: "pro", status: "ACTIVE", currentPeriodEnd: new Date(now.getTime() - 1) }),
    { entitlements: resolveEntitlements(null, now) },
  ]) {
    const response = denyIfReadonly(readonlyPrincipal);
    assert.ok(response);
    assert.equal(response.status, 403);
    assert.notEqual(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const data = await body(response);
    assert.equal(data.code, "SUBSCRIPTION_READONLY");
    assert.equal(typeof data.message, "string");
  }
});

test("denyIfReadonly: statuses that still allow writing (paid period, grace, canceled until the end)", () => {
  assert.equal(denyIfReadonly(principal({ plan: "pro", status: "ACTIVE", currentPeriodEnd: new Date(now.getTime() + 86_400_000) })), null);
  assert.equal(denyIfReadonly(principal({ plan: "pro", status: "CANCELED", currentPeriodEnd: new Date(now.getTime() + 86_400_000) })), null);
  assert.equal(denyIfReadonly(principal({ plan: "pro", status: "PAST_DUE", currentPeriodEnd: new Date(now.getTime() - 3 * 86_400_000) })), null);
});

test("denyUnlessFeature: PLAN_FEATURE with the lowest plan that has it; readonly write -> SUBSCRIPTION_READONLY", async () => {
  const start = principal({ plan: "start", status: "ACTIVE" });
  const denied = denyUnlessFeature(start, "stock");
  assert.equal(denied.status, 403);
  assert.deepEqual(await body(denied), { code: "PLAN_FEATURE", message: "Este recurso não está incluído no plano atual da clínica.", feature: "stock", requiredPlan: "pro" });
  assert.equal(denyUnlessFeature(principal({ plan: "pro", status: "ACTIVE" }), "stock", "write"), null);

  const expiredPro = principal({ plan: "pro", status: "EXPIRED" });
  assert.equal(denyUnlessFeature(expiredPro, "stock", "read"), null); // consulta continua
  const writeDenied = denyUnlessFeature(expiredPro, "stock", "write");
  assert.equal(writeDenied.status, 403);
  assert.equal((await body(writeDenied)).code, "SUBSCRIPTION_READONLY");
});

test("denyIfOverLimit: PLAN_LIMIT carries resource, limit and used; throws on broken input (fail closed)", async () => {
  const start = principal({ plan: "start", status: "ACTIVE" });
  assert.equal(denyIfOverLimit(start, "patients", 99), null);
  const denied = denyIfOverLimit(start, "patients", 100);
  assert.equal(denied.status, 403);
  const data = await body(denied);
  assert.equal(data.code, "PLAN_LIMIT");
  assert.equal(data.resource, "patients");
  assert.equal(data.limit, 100);
  assert.equal(data.used, 100);
  assert.throws(() => denyIfOverLimit(start, "patients", Number.NaN), TypeError);
  assert.equal(denyIfOverLimit(principal({ plan: "premium", status: "ACTIVE" }), "professionals", 9999), null);
  // somente leitura impede adicionar mesmo abaixo do limite
  assert.equal((await body(denyIfOverLimit(principal({ plan: "pro", status: "EXPIRED" }), "patients", 0))).code, "SUBSCRIPTION_READONLY");
});

test("planErrorBodyFromDecision: allowed decisions produce no error; denied ones map to the right code", () => {
  const e = ent({ plan: "start", status: "ACTIVE" });
  assert.equal(planErrorBodyFromDecision(checkFeature(ent({ plan: "pro", status: "ACTIVE" }), "stock")), null);
  assert.equal(planErrorBodyFromDecision(checkLimit(e, "patients", 1)), null);
  assert.equal(planErrorBodyFromDecision(checkFeature(e, "stock")).code, "PLAN_FEATURE");
  assert.equal(planErrorBodyFromDecision(checkLimit(e, "professionals", 2)).code, "PLAN_LIMIT");
});

test("parsePlanErrorBody (client): accepts only commercial codes, validates fields, never throws", () => {
  assert.equal(parsePlanErrorBody(null), null);
  assert.equal(parsePlanErrorBody("x"), null);
  assert.equal(parsePlanErrorBody({}), null);
  assert.equal(parsePlanErrorBody({ code: "FORBIDDEN", message: "Seu cargo não tem permissão" }), null); // 403 de papel não é comercial
  assert.deepEqual(parsePlanErrorBody({ code: "PLAN_FEATURE", message: "m", feature: "stock", requiredPlan: "pro", extra: "x" }), { code: "PLAN_FEATURE", message: "m", feature: "stock", requiredPlan: "pro" });
  const dirty = parsePlanErrorBody({ code: "PLAN_LIMIT", message: "", feature: "constructor", resource: "__proto__", requiredPlan: "gold", limit: "9", used: Number.NaN });
  assert.equal(dirty.code, "PLAN_LIMIT");
  assert.equal("feature" in dirty, false);
  assert.equal("resource" in dirty, false);
  assert.equal("requiredPlan" in dirty, false);
  assert.equal("limit" in dirty, false);
  assert.equal("used" in dirty, false);
  assert.ok(dirty.message.length > 0);
});
