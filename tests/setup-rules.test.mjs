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

test("plano de destaque: clínica só mira os campos que faltam; revisão não destaca nada", async () => {
  const { setupSpotlightPlan } = await import("../src/lib/setup-rules.ts");
  const all = { name: true, phone: true, address: true };
  const plan = setupSpotlightPlan("clinica", { name: true, phone: false, address: false });
  assert.deepEqual(plan.targets, ['[data-setup-target="clinica:phone"]', '[data-setup-target="clinica:address"]', '[data-setup-target="clinica:save"]']);
  assert.match(plan.hint, /telefone/);
  assert.equal(setupSpotlightPlan("clinica", all), null);
  assert.equal(setupSpotlightPlan("revisao", all), null);
  for (const step of SETUP_STEPS.filter((item) => item.key !== "clinica" && item.key !== "revisao")) assert.equal(setupSpotlightPlan(step.key, all).targets.length, 1);
});

test("dica da clínica cita todos os campos que faltam", async () => {
  const { setupSpotlightPlan } = await import("../src/lib/setup-rules.ts");
  assert.equal(setupSpotlightPlan("clinica", { name: true, phone: false, address: false }).hint, "Preencha o telefone e o endereço da clínica e salve os dados");
  assert.equal(setupSpotlightPlan("clinica", { name: true, phone: true, address: false }).hint, "Preencha o endereço da clínica e salve os dados");
  assert.equal(setupSpotlightPlan("clinica", { name: false, phone: false, address: false }).hint, "Preencha o nome, o telefone e o endereço da clínica e salve os dados");
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
