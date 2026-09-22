import type {
  CustomerJourneyStage,
  JourneyStageId,
  PatientJourneyRecord,
} from "@/types/clinic";

const stageOrder: { id: JourneyStageId; label: string }[] = [
  { id: "lead", label: "Lead" },
  { id: "evaluation", label: "Avaliação" },
  { id: "quote", label: "Orçamento" },
  { id: "procedure", label: "Procedimento" },
  { id: "return", label: "Retorno" },
  { id: "aftercare", label: "Pós-atendimento" },
];

function completedDate(record: PatientJourneyRecord, id: JourneyStageId) {
  const { events } = record;

  return {
    lead: events.leadAt,
    evaluation: events.evaluationCompletedAt,
    quote: events.quoteApprovedAt,
    procedure: events.procedureCompletedAt,
    return: events.returnCompletedAt,
    aftercare: events.aftercareCompletedAt,
  }[id];
}

function displayDate(record: PatientJourneyRecord, id: JourneyStageId) {
  const completed = completedDate(record, id);
  if (completed) return completed;
  if (id === "procedure") return record.events.scheduledProcedureAt ?? null;
  if (id === "return") return record.events.scheduledReturnAt ?? null;
  return null;
}

export function buildCustomerJourney(
  record: PatientJourneyRecord,
): CustomerJourneyStage[] {
  const cancelled = new Set(record.events.cancelledStages ?? []);
  const firstIncomplete = stageOrder.find(
    ({ id }) => !completedDate(record, id) && !cancelled.has(id),
  )?.id;

  return stageOrder.map(({ id, label }) => ({
    id,
    label,
    status: cancelled.has(id)
      ? "cancelled"
      : completedDate(record, id)
        ? "completed"
        : id === firstIncomplete
          ? "current"
          : "pending",
    date: displayDate(record, id),
    details: record.details[id] ?? [],
    actionLabel: {
      lead: "Ver contato",
      evaluation: "Ver avaliação",
      quote: "Ver orçamento",
      procedure: "Ver atendimento",
      return: "Ver retorno",
      aftercare: "Ver pós-atendimento",
    }[id],
  }));
}

export function formatJourneyDate(date: string | null) {
  if (!date) return "A definir";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );
}
