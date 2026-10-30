// Etapas da avaliação no atendimento: formulário clínico e avaliação facial (fotos + marcação). A facial tem URL própria (`?step=facial`).
export type EvaluationStep = "clinical" | "facial";

/** Qualquer valor diferente de "facial" (ausente, lixo, outra etapa) cai na etapa clínica, a entrada padrão. */
export function evaluationStepFromParams(params: URLSearchParams): EvaluationStep {
  return params.get("step") === "facial" ? "facial" : "clinical";
}

/** Query string da etapa pedida, mantendo os demais parâmetros (`patient`, `journey`...). A clínica não leva `step`. */
export function paramsWithEvaluationStep(params: URLSearchParams, step: EvaluationStep) {
  const next = new URLSearchParams(params);
  if (step === "facial") next.set("step", "facial");
  else next.delete("step");
  return next;
}
