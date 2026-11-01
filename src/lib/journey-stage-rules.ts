// Etapa da jornada do tratamento: fonte única para a lista de tratamentos e para a tela que a abre.
// A tela de dentro (patient-detail) segue a mesma ordem: avaliação (inclusive rascunho) -> orçamento -> procedimento -> pós -> retorno.
export const JOURNEY_STAGE_LABELS = ["Avaliação", "Orçamento", "Procedimento", "Pós-procedimento", "Retorno", "Concluído"] as const;
export type JourneyStageLabel = (typeof JOURNEY_STAGE_LABELS)[number];

export type JourneyStageInput = {
  status: string;
  hasEvaluation: boolean;
  /** Existe avaliação ainda em rascunho: a jornada abre na avaliação, mesmo com orçamento. */
  hasDraftEvaluation?: boolean;
  hasPaidQuote: boolean;
  hasProcedure: boolean;
  /** Sessão concluída: só ela abre o pós-procedimento/retorno no detalhe; sem ela a jornada segue em Procedimento. */
  latestCompletedSessionId?: string | null;
  hasReturnScheduled: boolean;
  hasReturn: boolean;
};

// Etapas já cumpridas, na ordem de JOURNEY_STAGE_LABELS (avaliação em rascunho não conta como cumprida).
export function journeyStagesDone(journey: JourneyStageInput): boolean[] {
  return [
    journey.hasEvaluation && !journey.hasDraftEvaluation,
    journey.hasPaidQuote,
    journey.hasProcedure || Boolean(journey.latestCompletedSessionId),
    Boolean(journey.latestCompletedSessionId),
    journey.hasReturnScheduled || journey.hasReturn,
    journey.status === "Concluído",
  ];
}

// Etapa em que a jornada abre (a que o profissional precisa trabalhar agora).
export function currentJourneyStage(journey: JourneyStageInput): JourneyStageLabel {
  if (journey.status === "Concluído") return "Concluído";
  if (!journey.hasEvaluation || journey.hasDraftEvaluation) return "Avaliação";
  if (!journey.hasPaidQuote) return "Orçamento";
  if (!journey.hasProcedure || !journey.latestCompletedSessionId) return "Procedimento";
  return journey.hasReturnScheduled || journey.hasReturn ? "Retorno" : "Pós-procedimento";
}
