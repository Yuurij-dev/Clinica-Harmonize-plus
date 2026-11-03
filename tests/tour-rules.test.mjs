import assert from "node:assert/strict";
import { test } from "node:test";
import { TOUR_SEEN, TOUR_STEPS, clampStep, isLastStep, shouldShowTour, tourKey, visibleTourSteps } from "../src/lib/tour-rules.ts";
import { visibleSections } from "../src/lib/permissions.ts";

test("tour completo para quem vê todas as seções", () => {
  const steps = visibleTourSteps(visibleSections("ADMIN"));
  assert.equal(steps.length, TOUR_STEPS.length);
  assert.equal(steps[0].key, "oi");
  assert.equal(steps.at(-1).key, "fim");
});

test("filtra passos por permissão e mantém abertura e fim", () => {
  const steps = visibleTourSteps(["agenda", "clientes"]);
  assert.deepEqual(steps.map((s) => s.key), ["oi", "agenda", "clientes", "fim"]);
});

test("STAFF não recebe passos de seções que não enxerga", () => {
  const allowed = visibleSections("STAFF");
  for (const step of visibleTourSteps(allowed)) if (step.section) assert.ok(allowed.includes(step.section));
});

test("sem nenhuma seção permitida não há tour", () => {
  assert.deepEqual(visibleTourSteps([]), []);
});

test("todo passo com seção tem título, texto e pose", () => {
  for (const s of TOUR_STEPS) assert.ok(s.title && s.text && s.pose);
});

test("shouldShowTour: só quando ainda não viu e a leitura funcionou", () => {
  assert.equal(shouldShowTour(null), true);
  assert.equal(shouldShowTour(undefined), true);
  assert.equal(shouldShowTour(TOUR_SEEN), false);
  assert.equal(shouldShowTour(null, true), false);
});

test("tourKey é por usuário e sanitiza", () => {
  assert.equal(tourKey("abc-1"), "harmonize_tour_v1_abc-1");
  assert.notEqual(tourKey("a"), tourKey("b"));
  assert.equal(tourKey("a/b c"), "harmonize_tour_v1_a_b_c");
  assert.equal(tourKey(""), "harmonize_tour_v1_anon");
});

test("clampStep e isLastStep", () => {
  assert.equal(clampStep(-3, 5), 0);
  assert.equal(clampStep(9, 5), 4);
  assert.equal(clampStep(2.7, 5), 2);
  assert.equal(clampStep(NaN, 5), 0);
  assert.equal(clampStep(1, 0), 0);
  assert.equal(isLastStep(4, 5), true);
  assert.equal(isLastStep(3, 5), false);
});

test("texto sem acesso clínico não cita avaliação, fotos nem documentos", () => {
  const staff = visibleTourSteps(visibleSections("STAFF"), false);
  const clinical = /avalia|foto|document|jornada/i;
  for (const step of staff) assert.doesNotMatch(step.text, clinical, step.key);
  assert.match(visibleTourSteps(visibleSections("ADMIN"), true).find((s) => s.key === "clientes").text, /fotos/);
});

test("fim manda rever o tour pelo botão da topbar, com ou sem Configurações", () => {
  // O botão que reabre o tour fica na topbar, então o texto não depende mais da permissão.
  for (const secoes of [["agenda"], ["agenda", "configuracoes"]]) {
    const fim = visibleTourSteps(secoes).at(-1);
    assert.equal(fim.key, "fim");
    assert.doesNotMatch(fim.text, /Configura/);
    assert.match(fim.text, /\?/);
  }
});

test("texto de configurações não promete equipe nem permissões", () => {
  const cfg = visibleTourSteps(["configuracoes"]).find((s) => s.key === "configuracoes");
  assert.doesNotMatch(cfg.text, /equipe|permiss/i);
});
