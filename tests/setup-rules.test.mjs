import assert from "node:assert/strict";
import { test } from "node:test";
import { SETUP_STEPS, canDecide, evaluateSetup, hasValidSetupHours, parseSetupDecisions, shouldInviteSetup } from "../src/lib/setup-rules.ts";

const empty = {
  name: "Clínica", phone: null, address: null,
  professionalCount: 0, procedureCount: 0, materialCount: 0, productCount: 0, recurringExpenseCount: 0,
  openingTime: "08:00", closingTime: "19:00", professionalOpeningTime: "09:00", professionalClosingTime: "18:00",
};
const decided = (decision) => ({ decision, by: "u1", at: "2026-11-10T10:00:00.000Z" });
const step = (evaluation, key) => evaluation.steps.find((item) => item.key === key);

test("são 10 etapas na ordem do documento, 4 obrigatórias", () => {
  assert.deepEqual(SETUP_STEPS.map((item) => item.key), ["clinica", "equipe", "agenda", "procedimentos", "materiais", "produtos", "custos", "financeiro", "notificacoes", "revisao"]);
  assert.deepEqual(SETUP_STEPS.filter((item) => item.required).map((item) => item.key), ["clinica", "equipe", "agenda", "procedimentos"]);
});

test("clínica exige nome, telefone e endereço; CNPJ e e-mail não", () => {
  assert.equal(step(evaluateSetup(empty, {}), "clinica").done, false);
  assert.equal(step(evaluateSetup({ ...empty, phone: "11999990000" }, {}), "clinica").done, false);
  assert.equal(step(evaluateSetup({ ...empty, phone: "11999990000", address: "  " }, {}), "clinica").done, false);
  assert.equal(step(evaluateSetup({ ...empty, phone: "11999990000", address: "Rua A, 1" }, {}), "clinica").done, true);
});

test("equipe conclui com um profissional ou com a confirmação", () => {
  assert.equal(step(evaluateSetup(empty, {}), "equipe").done, false);
  assert.equal(step(evaluateSetup({ ...empty, professionalCount: 1 }, {}), "equipe").done, true);
  assert.equal(step(evaluateSetup(empty, { equipe: decided("confirmed") }), "equipe").done, true);
});

test("agenda exige confirmação e horários válidos", () => {
  assert.equal(step(evaluateSetup(empty, {}), "agenda").done, false);
  assert.equal(step(evaluateSetup(empty, { agenda: decided("confirmed") }), "agenda").done, true);
  assert.equal(step(evaluateSetup({ ...empty, closingTime: "08:00" }, { agenda: decided("confirmed") }), "agenda").done, false);
  assert.equal(step(evaluateSetup({ ...empty, professionalClosingTime: "08:30" }, { agenda: decided("confirmed") }), "agenda").done, false);
  assert.equal(hasValidSetupHours({ ...empty, openingTime: "xx" }), false);
});

test("procedimentos exige ao menos um cadastrado", () => {
  assert.equal(step(evaluateSetup(empty, {}), "procedimentos").done, false);
  assert.equal(step(evaluateSetup({ ...empty, procedureCount: 2 }, {}), "procedimentos").done, true);
});

test("opcionais concluem por dado ou por 'não utilizamos', sinalizando o skip", () => {
  const byData = evaluateSetup({ ...empty, materialCount: 1, productCount: 1, recurringExpenseCount: 1 }, {});
  for (const key of ["materiais", "produtos", "financeiro"]) {
    assert.equal(step(byData, key).done, true);
    assert.equal(step(byData, key).skipped, false);
  }
  const skipped = evaluateSetup(empty, { materiais: decided("skipped"), produtos: decided("skipped"), custos: decided("skipped"), notificacoes: decided("skipped"), financeiro: decided("skipped") });
  for (const key of ["materiais", "produtos", "custos", "notificacoes", "financeiro"]) {
    assert.equal(step(skipped, key).done, true);
    assert.equal(step(skipped, key).skipped, true);
  }
  assert.equal(step(evaluateSetup(empty, { custos: decided("confirmed") }), "custos").done, true);
  assert.equal(step(evaluateSetup(empty, {}), "notificacoes").done, false);
});

test("pular obrigatória é recusado e uma decisão guardada de skip em obrigatória é ignorada", () => {
  for (const key of ["clinica", "equipe", "agenda", "procedimentos", "revisao"]) assert.equal(canDecide(key, "skipped"), false);
  assert.equal(canDecide("materiais", "skipped"), true);
  assert.equal(canDecide("materiais", "confirmed"), false);
  assert.equal(canDecide("procedimentos", "confirmed"), false);
  for (const key of ["equipe", "agenda", "custos", "financeiro", "notificacoes"]) assert.equal(canDecide(key, "confirmed"), true);
  assert.equal(canDecide("inexistente", "confirmed"), false);
  assert.equal(canDecide("equipe", "talvez"), false);
  assert.equal(step(evaluateSetup(empty, { procedimentos: decided("skipped") }), "procedimentos").done, false);
});

test("percent, doneCount e canFinish", () => {
  const start = evaluateSetup(empty, {});
  assert.equal(start.total, 10);
  assert.equal(start.doneCount, 0);
  assert.equal(start.percent, 0);
  assert.equal(start.canFinish, false);
  assert.equal(start.nextPendingKey, "clinica");

  const required = { ...empty, phone: "1", address: "x", professionalCount: 1, procedureCount: 1 };
  const ready = evaluateSetup(required, { agenda: decided("confirmed") });
  assert.equal(ready.doneCount, 4);
  assert.equal(ready.percent, 40);
  assert.equal(ready.canFinish, true);
  assert.equal(ready.nextPendingKey, "materiais");

  const all = { materiais: decided("skipped"), produtos: decided("skipped"), custos: decided("confirmed"), financeiro: decided("skipped"), notificacoes: decided("confirmed"), agenda: decided("confirmed") };
  const beforeFinish = evaluateSetup(required, all);
  assert.equal(beforeFinish.doneCount, 9);
  assert.equal(beforeFinish.percent, 90);
  assert.equal(beforeFinish.nextPendingKey, "revisao");
  const finished = evaluateSetup(required, all, true);
  assert.equal(finished.doneCount, 10);
  assert.equal(finished.percent, 100);
  assert.equal(finished.nextPendingKey, null);
});

test("finalizada não conta a revisão se uma obrigatória deixou de valer", () => {
  const evaluation = evaluateSetup(empty, {}, true);
  assert.equal(step(evaluation, "revisao").done, false);
  assert.equal(evaluation.canFinish, false);
});

test("parseSetupDecisions descarta lixo e decisões inválidas para a etapa", () => {
  assert.deepEqual(parseSetupDecisions(null), {});
  assert.deepEqual(parseSetupDecisions([]), {});
  const parsed = parseSetupDecisions({ equipe: decided("confirmed"), procedimentos: decided("skipped"), foo: decided("confirmed"), agenda: { decision: "x" } });
  assert.deepEqual(Object.keys(parsed), ["equipe"]);
});

test("convite só aparece enquanto pendente", () => {
  assert.equal(shouldInviteSetup("pending"), true);
  for (const status of ["in_progress", "dismissed", "completed"]) assert.equal(shouldInviteSetup(status), false);
});

test("plano de destaque: clínica em ordem (nome, telefone, endereço, salvar); revisão não destaca nada; demais têm um botão", async () => {
  const { setupSpotlightPlan } = await import("../src/lib/setup-rules.ts");
  const plan = setupSpotlightPlan("clinica");
  assert.deepEqual(plan.items.map((item) => item.selector), ['[data-setup-target="clinica:name"]', '[data-setup-target="clinica:phone"]', '[data-setup-target="clinica:address"]', '[data-setup-target="clinica:save"]']);
  assert.deepEqual(plan.items.map((item) => item.fieldKey), ["name", "phone", "address", undefined]);
  assert.match(plan.items[2].hint, /endereço/);
  assert.match(plan.items[3].hint, /Salvar dados/);
  assert.equal(setupSpotlightPlan("revisao"), null);
  for (const step of SETUP_STEPS.filter((item) => item.key !== "clinica" && item.key !== "revisao")) {
    const single = setupSpotlightPlan(step.key);
    assert.equal(single.items.length, 1);
    assert.equal(single.items[0].fieldKey, undefined);
  }
});

test("campo preenchido: texto não vazio; telefone exige 10 dígitos ou mais", async () => {
  const { isSetupFieldFilled } = await import("../src/lib/setup-rules.ts");
  assert.equal(isSetupFieldFilled("name", "  "), false);
  assert.equal(isSetupFieldFilled("name", " Bela "), true);
  assert.equal(isSetupFieldFilled("phone", "(11) 9876"), false);
  assert.equal(isSetupFieldFilled("phone", "(11) 3456-7890"), true);
  assert.equal(isSetupFieldFilled("phone", "(11) 98765-4321"), true);
});

test("alvo atual: primeiro campo vazio; avança ao preencher, volta se apagar; botão fica até a etapa concluir", async () => {
  const { setupSpotlightPlan, currentSetupTargetIndex } = await import("../src/lib/setup-rules.ts");
  const items = setupSpotlightPlan("clinica").items;
  assert.equal(currentSetupTargetIndex(items, [false, false, false, false]), 0);
  assert.equal(currentSetupTargetIndex(items, [true, false, false, false]), 1);
  assert.equal(currentSetupTargetIndex(items, [true, true, false, false]), 2);
  assert.equal(currentSetupTargetIndex(items, [true, true, true, false]), 3);
  assert.equal(currentSetupTargetIndex(items, [true, true, true, true]), 3);
  assert.equal(currentSetupTargetIndex(items, [true, false, true, false]), 1);
  // Alvo fora da tela é ignorado; sem nenhum alvo, -1.
  assert.equal(currentSetupTargetIndex(items, [null, false, false, false]), 1);
  assert.equal(currentSetupTargetIndex(items, [null, null, null, null]), -1);
  // Etapa de um botão só: sempre o botão.
  const single = setupSpotlightPlan("procedimentos").items;
  assert.equal(currentSetupTargetIndex(single, [false]), 0);
  assert.equal(currentSetupTargetIndex(single, [null]), -1);
});

test("balão nunca cobre alvos nem a barra de retorno", async () => {
  const { placeBalloon } = await import("../src/lib/setup-rules.ts");
  const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const size = { w: 320, h: 110 };
  const targets = [{ x: 300, y: 300, w: 600, h: 48 }, { x: 300, y: 380, w: 600, h: 48 }];
  const desk = placeBalloon({ targets, obstacles: [], viewport: { w: 1440, h: 900 }, size, desktop: true });
  assert.equal(targets.some((t) => hits({ x: desk.left, y: desk.top, ...size }, t)), false);
  const mobileTargets = [{ x: 16, y: 380, w: 358, h: 48 }];
  const obstacles = [{ x: 16, y: 470, w: 358, h: 100 }, { x: 0, y: 780, w: 390, h: 64 }];
  const mob = placeBalloon({ targets: mobileTargets, obstacles, viewport: { w: 390, h: 844 }, size, desktop: false });
  const box = { x: mob.left, y: mob.top, ...size };
  assert.equal([...mobileTargets, ...obstacles].some((r) => hits(box, r)), false);
  assert.ok(mob.left >= 12 && mob.left + 320 <= 378 && mob.top >= 12);
});

test("salvar nas etapas de conferência registra a confirmação; nas demais não", async () => {
  const { confirmsOnSave } = await import("../src/lib/setup-rules.ts");
  for (const key of ["agenda", "custos", "notificacoes"]) assert.equal(confirmsOnSave(key), true);
  for (const key of ["clinica", "equipe", "procedimentos", "materiais", "produtos", "financeiro", "revisao", "x"]) assert.equal(confirmsOnSave(key), false);
});
