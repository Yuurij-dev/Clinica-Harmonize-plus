import assert from "node:assert/strict";
import test from "node:test";
import { planLabel } from "../src/lib/plan-label.ts";

test("planLabel: Start, Pro e Premium", () => {
  assert.equal(planLabel({ plan: "start", contractedPlan: "start", mode: "full", reason: "subscription" }), "Plano Start");
  assert.equal(planLabel({ plan: "pro", contractedPlan: "pro", mode: "full", reason: "subscription" }), "Plano Pro");
  assert.equal(planLabel({ plan: "premium", contractedPlan: "premium", mode: "full", reason: "canceled_until_period_end" }), "Plano Premium");
});
test("planLabel: teste, somente leitura e sem assinatura", () => {
  assert.equal(planLabel({ plan: "premium", contractedPlan: null, mode: "full", reason: "trial" }), "Teste grátis");
  assert.equal(planLabel({ plan: "premium", contractedPlan: null, mode: "readonly", reason: "trial_expired" }), "Teste encerrado");
  assert.equal(planLabel({ plan: "pro", contractedPlan: "pro", mode: "readonly", reason: "subscription_inactive" }), "Plano Pro · somente leitura");
  assert.equal(planLabel({ plan: null, mode: "readonly", reason: "no_subscription" }), "Sem assinatura");
});
test("planLabel: sem dado ou plano desconhecido não inventa plano", () => {
  assert.equal(planLabel(null), null);
  assert.equal(planLabel(undefined), null);
  assert.equal(planLabel({ plan: "ouro", mode: "full", reason: "subscription" }), null);
});
