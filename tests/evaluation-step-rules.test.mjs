import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluationStepFromParams, paramsWithEvaluationStep } from "../src/lib/evaluation-step-rules.ts";

test("etapa vem de ?step=facial; o resto é a etapa clínica", () => {
  assert.equal(evaluationStepFromParams(new URLSearchParams("patient=p1&journey=j1&step=facial")), "facial");
  assert.equal(evaluationStepFromParams(new URLSearchParams("patient=p1&journey=j1")), "clinical");
  assert.equal(evaluationStepFromParams(new URLSearchParams("step=orcamento")), "clinical");
  assert.equal(evaluationStepFromParams(new URLSearchParams("step=")), "clinical");
});

test("trocar de etapa preserva paciente e tratamento e não altera o original", () => {
  const params = new URLSearchParams("patient=p1&journey=j1");
  assert.equal(paramsWithEvaluationStep(params, "facial").toString(), "patient=p1&journey=j1&step=facial");
  assert.equal(params.toString(), "patient=p1&journey=j1");
  assert.equal(paramsWithEvaluationStep(new URLSearchParams("patient=p1&journey=j1&step=facial"), "clinical").toString(), "patient=p1&journey=j1");
  assert.equal(paramsWithEvaluationStep(new URLSearchParams("patient=p1&journey=j1&step=facial"), "facial").toString(), "patient=p1&journey=j1&step=facial");
});
