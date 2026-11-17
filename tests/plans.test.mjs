import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyDependencies, countsAsProfessional, featureDependencies, features, isFeature, isPlanId, limitResources, lowestPlanWith, planCatalog, planIds, resolvePlanFeatures, TRIAL_PLAN,
} from "../src/lib/plans.ts";

const set = (plan) => resolvePlanFeatures(plan);

test("catalog: three plans with the confirmed limits", () => {
  assert.deepEqual(planIds, ["start", "pro", "premium"]);
  assert.deepEqual(planCatalog.start.limits, { professionals: 2, patients: 100 });
  assert.deepEqual(planCatalog.pro.limits, { professionals: 5, patients: null });
  assert.deepEqual(planCatalog.premium.limits, { professionals: null, patients: null });
  // armazenamento ainda não foi definido: não existe como limite
  assert.deepEqual([...limitResources], ["professionals", "patients"]);
});

test("catalog: Start has no gated feature", () => {
  assert.equal(set("start").size, 0);
});

test("catalog: Pro has management features but not the premium-only ones", () => {
  for (const feature of ["stock", "purchases", "finance", "technicalSheet", "costs", "reports", "reportsExport", "rolePermissions", "agendaAutomations", "emailNotifications"]) {
    assert.equal(set("pro").has(feature), true, feature);
  }
  for (const feature of ["reportsAdvanced", "reportsConsolidated", "googleCalendar", "multiClinic"]) {
    assert.equal(set("pro").has(feature), false, feature);
  }
});

test("catalog: Premium has every feature and each plan includes the previous one", () => {
  assert.deepEqual([...set("premium")].sort(), [...features].sort());
  for (const feature of set("start")) assert.equal(set("pro").has(feature), true);
  for (const feature of set("pro")) assert.equal(set("premium").has(feature), true);
});

test("dependencies: purchases need stock and finance; technical sheet needs stock; costs are independent", () => {
  assert.deepEqual([...featureDependencies.purchases].sort(), ["finance", "stock"]);
  assert.deepEqual(featureDependencies.technicalSheet, ["stock"]);
  assert.deepEqual(featureDependencies.costs, []);
  assert.deepEqual(featureDependencies.stock, []);
});

test("dependencies: graph references only known features and has no cycles", () => {
  for (const [feature, deps] of Object.entries(featureDependencies)) {
    assert.equal(isFeature(feature), true);
    for (const dep of deps) assert.equal(isFeature(dep), true, `${feature} -> ${dep}`);
  }
  const visiting = new Set(); const done = new Set();
  const visit = (feature) => {
    assert.equal(visiting.has(feature), false, `cycle at ${feature}`);
    if (done.has(feature)) return;
    visiting.add(feature);
    for (const dep of featureDependencies[feature]) visit(dep);
    visiting.delete(feature); done.add(feature);
  };
  for (const feature of features) visit(feature);
});

test("dependencies: a feature whose dependency is missing is dropped, transitively", () => {
  const withoutStock = applyDependencies(planCatalog.pro.features.filter((feature) => feature !== "stock"));
  assert.equal(withoutStock.has("purchases"), false);
  assert.equal(withoutStock.has("technicalSheet"), false);
  assert.equal(withoutStock.has("costs"), true);   // independente do estoque
  assert.equal(withoutStock.has("finance"), true);
  const withoutFinance = applyDependencies(planCatalog.pro.features.filter((feature) => feature !== "finance"));
  assert.equal(withoutFinance.has("purchases"), false);
  assert.equal(withoutFinance.has("stock"), true);
  // cascata em dois níveis: sem relatórios saem exportações, insights e consolidado
  const withoutReports = applyDependencies(planCatalog.premium.features.filter((feature) => feature !== "reports"));
  for (const feature of ["reportsExport", "reportsAdvanced", "reportsConsolidated"]) assert.equal(withoutReports.has(feature), false, feature);
  assert.equal(applyDependencies(["purchases"]).size, 0);
});

test("lowestPlanWith: the first plan that includes the feature", () => {
  assert.equal(lowestPlanWith("stock"), "pro");
  assert.equal(lowestPlanWith("reportsExport"), "pro");
  assert.equal(lowestPlanWith("reportsAdvanced"), "premium");
  assert.equal(lowestPlanWith("reportsConsolidated"), "premium");
  assert.equal(lowestPlanWith("googleCalendar"), "premium");
});

test("guards: type predicates", () => {
  assert.equal(isPlanId("pro"), true);
  assert.equal(isPlanId("PRO"), false);
  assert.equal(isPlanId(null), false);
  assert.equal(isFeature("stock"), true);
  assert.equal(isFeature("__proto__"), false);
  assert.equal(isFeature("toString"), false);
});

test("professionals: ADMIN and PROFESSIONAL count, STAFF and unknown do not", () => {
  assert.equal(countsAsProfessional("ADMIN"), true);
  assert.equal(countsAsProfessional("PROFESSIONAL"), true);
  assert.equal(countsAsProfessional("STAFF"), false);
  assert.equal(countsAsProfessional("admin"), false);
  assert.equal(countsAsProfessional(null), false);
  assert.equal(countsAsProfessional(undefined), false);
});

test("trial plan is premium", () => {
  assert.equal(TRIAL_PLAN, "premium");
});
