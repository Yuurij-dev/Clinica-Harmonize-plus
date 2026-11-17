import assert from "node:assert/strict";
import { test } from "node:test";
import { lockedSections, sectionRequiredFeature, visibleSections } from "../src/lib/permissions.ts";
import { visibleTourSteps } from "../src/lib/tour-rules.ts";
import { splitMobileSections, quickCreateFor } from "../src/lib/mobile-nav-rules.ts";
import { planReportCapabilities, reportCenterGroups } from "../src/lib/reports-center-rules.ts";
import { collectFeatureSearchResults, suggestFeatureSearchTerms } from "../src/lib/global-search-rules.ts";

const proFeatures = ["stock", "purchases", "finance", "technicalSheet", "costs", "reports"];

test("sem features (undefined) mantém o comportamento anterior", () => {
  assert.ok(visibleSections("ADMIN").includes("estoque"));
  assert.ok(visibleSections("ADMIN", undefined, false, undefined).includes("compras"));
});

test("Start (nenhum recurso) esconde Estoque, Compras, Financeiro e Relatórios e mantém o resto", () => {
  const sections = visibleSections("ADMIN", undefined, false, []);
  for (const hidden of ["estoque", "compras", "financeiro", "relatorios"]) assert.equal(sections.includes(hidden), false, hidden);
  // Pagamentos (do orçamento) continua no Start.
  assert.deepEqual(sections, ["dashboard", "agenda", "clientes", "procedimentos", "orcamentos", "pagamentos", "configuracoes"]);
});

test("Pro mostra Estoque e Compras", () => {
  const sections = visibleSections("ADMIN", undefined, false, proFeatures);
  assert.ok(sections.includes("estoque") && sections.includes("compras"));
});

test("cada seção exige o seu recurso", () => {
  const onlyStock = visibleSections("ADMIN", undefined, false, ["stock"]);
  assert.ok(onlyStock.includes("estoque"));
  assert.equal(onlyStock.includes("compras"), false);
  assert.equal(sectionRequiredFeature("estoque"), "stock");
  assert.equal(sectionRequiredFeature("compras"), "purchases");
  assert.equal(sectionRequiredFeature("financeiro"), "finance");
  assert.equal(sectionRequiredFeature("relatorios"), "reports");
  assert.equal(sectionRequiredFeature("pagamentos"), undefined);
});

test("papel sem permissão continua sem a seção mesmo com o recurso", () => {
  assert.equal(visibleSections("STAFF", undefined, false, proFeatures).includes("estoque"), false);
});

test("lockedSections: permitidas pelo papel mas fora do plano", () => {
  assert.deepEqual(lockedSections("ADMIN", undefined, false, []), ["estoque", "compras", "financeiro", "relatorios"]);
  assert.deepEqual(lockedSections("ADMIN", undefined, false, ["stock", "purchases"]), ["financeiro", "relatorios"]);
  assert.deepEqual(lockedSections("ADMIN", undefined, false, proFeatures), []);
  assert.deepEqual(lockedSections("ADMIN", undefined, false, ["stock"]), ["compras", "financeiro", "relatorios"]);
  // STAFF não enxerga estoque/compras pelo papel: não há aviso de plano para ele.
  assert.deepEqual(lockedSections("STAFF", undefined, false, []), []);
  assert.deepEqual(lockedSections(null, undefined, false, []), []);
});

test("navegação móvel e atalhos derivam das seções filtradas", () => {
  const start = visibleSections("ADMIN", undefined, false, []);
  const { bar, more } = splitMobileSections(start);
  assert.ok(![...bar, ...more].some((section) => section === "estoque" || section === "compras"));
  assert.equal(quickCreateFor(start).length, 4);
});

test("tour sem estoque não cita Estoque, Compras, fichas técnicas nem materiais", () => {
  const steps = visibleTourSteps(visibleSections("ADMIN", undefined, false, []), true, false);
  assert.equal(steps.some((step) => step.key === "estoque" || step.key === "compras"), false);
  for (const step of steps) assert.doesNotMatch(`${step.title} ${step.text}`, /estoque|compras|ficha|material|materiais/i, step.key);
});

test("tour com estoque mantém os textos completos", () => {
  const steps = visibleTourSteps(visibleSections("ADMIN", undefined, false, proFeatures), true, true);
  assert.ok(steps.some((step) => step.key === "estoque") && steps.some((step) => step.key === "compras"));
  assert.match(steps.find((step) => step.key === "procedimentos").text, /fichas técnicas/);
});

const baseAccess = { dashboard: true, patients: true, agenda: true, appointmentRun: true, procedures: true, stock: false, purchases: false, quotes: true, payments: true, finance: true, reports: true, settings: true, settingsPermissions: true, settingsTeam: true, clinical: true, anamnesis: true };

test("busca global: sem estoque/compras não há áreas nem sugestões deles", () => {
  const titles = collectFeatureSearchResults("estoque", baseAccess).map((result) => result.title);
  assert.equal(titles.includes("Estoque"), false);
  assert.equal(collectFeatureSearchResults("compras", baseAccess).some((result) => result.title === "Compras"), false);
  assert.equal(suggestFeatureSearchTerms("estoqeu", baseAccess).includes("Estoque"), false);
  assert.ok(collectFeatureSearchResults("estoque", { ...baseAccess, stock: true }).some((result) => result.title === "Estoque"));
});

test("busca global: configuração de custos só com o recurso costs", () => {
  const withoutCosts = collectFeatureSearchResults("custos", { ...baseAccess, costs: false });
  assert.equal(withoutCosts.some((result) => result.settingsSection === "Custos e orçamento"), false);
  assert.ok(collectFeatureSearchResults("custos", { ...baseAccess, costs: true }).some((result) => result.settingsSection === "Custos e orçamento"));
  // Sem a chave `costs` (comportamento anterior), a configuração continua pesquisável.
  assert.ok(collectFeatureSearchResults("custos", baseAccess).some((result) => result.settingsSection === "Custos e orçamento"));
});

test("Pro mostra Financeiro e Relatórios; só Relatórios ou só Financeiro dependem de cada recurso", () => {
  const pro = visibleSections("ADMIN", undefined, false, proFeatures);
  assert.ok(pro.includes("financeiro") && pro.includes("relatorios"));
  assert.equal(visibleSections("ADMIN", undefined, false, ["reports"]).includes("financeiro"), false);
  assert.equal(visibleSections("ADMIN", undefined, false, ["finance"]).includes("relatorios"), false);
  assert.equal(lockedSections("STAFF", undefined, false, []).includes("financeiro"), false);
});

test("Start: navegação móvel, atalhos e tour não citam Financeiro nem Relatórios", () => {
  const start = visibleSections("ADMIN", undefined, false, []);
  const { bar, more } = splitMobileSections(start);
  assert.ok(![...bar, ...more].some((section) => section === "financeiro" || section === "relatorios"));
  const steps = visibleTourSteps(start, true, false);
  assert.equal(steps.some((step) => step.key === "financeiro" || step.key === "relatorios"), false);
  assert.ok(steps.some((step) => step.key === "pagamentos"));
});

test("busca global: sem finance/reports não há áreas nem sugestões de Financeiro e Relatórios", () => {
  const start = { ...baseAccess, finance: false, reports: false };
  assert.equal(collectFeatureSearchResults("financeiro", start).some((result) => result.title === "Financeiro"), false);
  assert.equal(collectFeatureSearchResults("relatorios", start).some((result) => result.title === "Relatórios"), false);
  assert.equal(suggestFeatureSearchTerms("relatorois", start).includes("Relatórios"), false);
  assert.ok(collectFeatureSearchResults("relatorios", baseAccess).some((result) => result.title === "Relatórios"));
});

const reportInput = { isProfessional: false, canFinance: true, canQuotes: true, canStock: true, hasFinance: true, hasStock: true };

test("abas de relatório sem a visão geral (Pro): papel E plano", () => {
  assert.deepEqual(planReportCapabilities(reportInput), { finance: true, quotes: true, stock: true });
  assert.deepEqual(planReportCapabilities({ ...reportInput, hasFinance: false, hasStock: false }), { finance: false, quotes: true, stock: false });
  assert.deepEqual(planReportCapabilities({ ...reportInput, canQuotes: false, canStock: false }), { finance: true, quotes: false, stock: false });
  // PROFESSIONAL nunca vê o financeiro, mesmo com finance:access.
  assert.equal(planReportCapabilities({ ...reportInput, isProfessional: true }).finance, false);
});

test("central de relatórios sem finance/stock não lista essas áreas", () => {
  const ids = (capabilities) => reportCenterGroups(capabilities).flatMap((group) => group.reports.map((report) => report.id));
  const withoutModules = ids(planReportCapabilities({ ...reportInput, hasFinance: false, hasStock: false }));
  assert.equal(withoutModules.includes("finance"), false);
  assert.equal(withoutModules.includes("stock"), false);
  assert.ok(withoutModules.includes("procedures"));
});
