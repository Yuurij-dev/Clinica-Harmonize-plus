// Regras puras do prontuário: lista unificada de atendimentos (avaliação, sessão de procedimento, retorno),
// filtros, indicadores, linha do tempo, evolução, resumo do tratamento e pendências clínicas.
// Tudo é derivado dos registros existentes; nada aqui cria estrutura paralela.

export type EncounterType = "evaluation" | "session" | "followup";
export type EncounterStatus = "Concluído" | "Em andamento" | "Com pendência";

export type EncounterItem = {
  key: string;
  type: EncounterType;
  id: string;
  journeyId: string | null;
  journeyName: string;
  sessionId: string | null;
  quoteId: string | null;
  occurredAt: string;
  status: EncounterStatus;
  title: string;
  summary: string;
  evolution: string;
  professional: string;
  treatment: string;
  region: string;
  photoCount: number;
  pendings: string[];
};

export const encounterTypeLabels: Record<EncounterType, string> = { evaluation: "Avaliação", session: "Procedimento", followup: "Retorno" };

const clinicTimeZone = "America/Sao_Paulo";

// Chave de dia (YYYY-MM-DD) no fuso da clínica.
export function clinicDateKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: clinicTimeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function excerpt(value: string | null | undefined, max = 160) {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function firstFilled(...values: Array<string | null | undefined>) {
  return values.map((value) => (value ?? "").trim()).find(Boolean) ?? "";
}

type Iso = string;

export type EvaluationRow = { id: string; journeyId: string | null; journeyName?: string | null; professional: string; status: string; createdAt: Iso; chiefComplaint: string; patientGoal: string; clinicalNotes: string; photoCount: number };
export type SessionRow = { id: string; journeyId: string; journeyName?: string | null; quoteId: string; procedureName: string; treatedAreas: string; technique: string; professional: string; status: string; performedAt: Iso; startedAt: Iso | null; observations: string; complications: string; photoCount: number; pendingMaterials: boolean };
export type FollowUpRow = { id: string; journeyId: string; journeyName?: string | null; sessionId: string; procedureName: string; treatedAreas: string; professional: string; occurredAt: Iso; complaints: string; observations: string; guidanceText: string; photoCount: number };
export type FollowUpDraftRow = { sessionId: string; journeyId: string; journeyName?: string | null; procedureName: string; treatedAreas: string; professional: string; updatedAt: Iso; complaints: string; observations: string; photoCount: number };

export function evaluationEncounter(row: EvaluationRow): EncounterItem {
  const done = row.status === "Concluída";
  return {
    key: `evaluation:${row.id}`, type: "evaluation", id: row.id, journeyId: row.journeyId, journeyName: row.journeyName ?? "", sessionId: null, quoteId: null,
    occurredAt: row.createdAt, status: done ? "Concluído" : "Com pendência", title: "Avaliação",
    summary: excerpt(firstFilled(row.chiefComplaint, row.patientGoal, row.clinicalNotes)), evolution: "",
    professional: row.professional, treatment: row.journeyName ?? "", region: "", photoCount: row.photoCount,
    pendings: done ? [] : ["Avaliação não concluída"],
  };
}

export function sessionEncounter(row: SessionRow): EncounterItem {
  const status: EncounterStatus = row.status === "Concluída" ? "Concluído" : row.status === "Em execução" ? "Em andamento" : "Com pendência";
  const pendings = [
    ...(status === "Com pendência" ? ["Sessão não iniciada"] : []),
    ...(row.pendingMaterials ? ["Conferir materiais usados"] : []),
  ];
  return {
    key: `session:${row.id}`, type: "session", id: row.id, journeyId: row.journeyId, journeyName: row.journeyName ?? "", sessionId: row.id, quoteId: row.quoteId,
    occurredAt: row.startedAt ?? row.performedAt, status, title: row.procedureName,
    summary: excerpt(firstFilled(row.observations, row.technique ? `Técnica: ${row.technique}` : "")), evolution: excerpt(firstFilled(row.observations, row.complications), 600),
    professional: row.professional, treatment: row.procedureName, region: row.treatedAreas, photoCount: row.photoCount, pendings,
  };
}

export function followUpEncounter(row: FollowUpRow): EncounterItem {
  return {
    key: `followup:${row.id}`, type: "followup", id: row.id, journeyId: row.journeyId, journeyName: row.journeyName ?? "", sessionId: row.sessionId, quoteId: null,
    occurredAt: row.occurredAt, status: "Concluído", title: `Retorno · ${row.procedureName}`,
    summary: excerpt(firstFilled(row.complaints, row.observations, row.guidanceText)), evolution: excerpt(firstFilled(row.observations, row.complaints), 600),
    professional: row.professional, treatment: row.procedureName, region: row.treatedAreas, photoCount: row.photoCount, pendings: [],
  };
}

export function followUpDraftEncounter(row: FollowUpDraftRow): EncounterItem {
  return {
    key: `followup-draft:${row.sessionId}`, type: "followup", id: row.sessionId, journeyId: row.journeyId, journeyName: row.journeyName ?? "", sessionId: row.sessionId, quoteId: null,
    occurredAt: row.updatedAt, status: "Com pendência", title: `Retorno · ${row.procedureName}`,
    summary: excerpt(firstFilled(row.complaints, row.observations)), evolution: "",
    professional: row.professional, treatment: row.procedureName, region: row.treatedAreas, photoCount: row.photoCount, pendings: ["Retorno em rascunho"],
  };
}

export function sortEncounters(items: EncounterItem[]) {
  return [...items].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.key.localeCompare(right.key));
}

// --- Filtros ---

export type StatusFilter = "all" | "completed" | "in_progress" | "returns" | "pending";
export type TypeFilter = "all" | EncounterType;
export type EncounterFilters = { status: StatusFilter; type: TypeFilter; search: string; from: string; to: string };
export const defaultEncounterFilters: EncounterFilters = { status: "all", type: "all", search: "", from: "", to: "" };

function matchesStatus(item: EncounterItem, status: StatusFilter) {
  if (status === "completed") return item.status === "Concluído";
  if (status === "in_progress") return item.status === "Em andamento";
  if (status === "returns") return item.type === "followup";
  if (status === "pending") return item.status === "Com pendência" || item.pendings.length > 0;
  return true;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
}

export function filterEncounters(items: EncounterItem[], filters: EncounterFilters) {
  const search = normalize(filters.search.trim());
  return items.filter((item) => {
    if (!matchesStatus(item, filters.status)) return false;
    if (filters.type !== "all" && item.type !== filters.type) return false;
    const day = clinicDateKey(item.occurredAt);
    if (filters.from && day < filters.from) return false;
    if (filters.to && day > filters.to) return false;
    if (!search) return true;
    return normalize([item.title, item.summary, item.professional, item.treatment, item.region, item.journeyName].join(" ")).includes(search);
  });
}

export function statusCounts(items: EncounterItem[]) {
  const count = (status: StatusFilter) => items.filter((item) => matchesStatus(item, status)).length;
  return { all: items.length, completed: count("completed"), in_progress: count("in_progress"), returns: count("returns"), pending: count("pending") };
}

// --- Indicadores ---

export type ClinicalIndicators = { total: number; inProgress: number; pending: number; completed: number; lastReturn: { occurredAt: string; daysAgo: number } | null };

function dayNumber(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return Math.floor(Date.UTC(year, (month || 1) - 1, day || 1) / 86_400_000);
}

export function clinicalIndicators(items: EncounterItem[], now: Date = new Date()): ClinicalIndicators {
  const counts = statusCounts(items);
  const lastReturn = sortEncounters(items.filter((item) => item.type === "followup" && item.status === "Concluído"))[0];
  return {
    total: counts.all, inProgress: counts.in_progress, pending: counts.pending, completed: counts.completed,
    lastReturn: lastReturn ? { occurredAt: lastReturn.occurredAt, daysAgo: Math.max(0, dayNumber(clinicDateKey(now)) - dayNumber(clinicDateKey(lastReturn.occurredAt))) } : null,
  };
}

// --- Evolução, tratamento, retorno, pendências ---

export type Evolution = { occurredAt: string; professional: string; text: string; title: string };

// Evolução mais recente: prefere retorno concluído; depois sessão com observações.
export function latestEvolution(items: EncounterItem[]): Evolution | null {
  const candidate = sortEncounters(items).find((item) => item.status === "Concluído" && item.evolution && (item.type === "followup" || item.type === "session"));
  return candidate ? { occurredAt: candidate.occurredAt, professional: candidate.professional, text: candidate.evolution, title: candidate.title } : null;
}

export type JourneyRow = { id: string; name: string; status: string; professional: string; createdAt: Iso };
export type TreatmentSummary = { journeyId: string; status: string; mainTreatment: string; region: string; professional: string; startedAt: string };

// Tratamento ativo = jornada "Em andamento" mais recente.
export function activeTreatmentSummary(journeys: JourneyRow[], items: EncounterItem[]): TreatmentSummary | null {
  const journey = [...journeys].filter((item) => item.status === "Em andamento").sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (!journey) return null;
  const sessions = items.filter((item) => item.type === "session" && item.journeyId === journey.id);
  const latest = sortEncounters(sessions)[0];
  const first = [...sessions].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))[0];
  return {
    journeyId: journey.id, status: journey.status, mainTreatment: latest?.treatment || journey.name, region: latest?.region ?? "",
    professional: journey.professional || latest?.professional || "", startedAt: first?.occurredAt ?? journey.createdAt,
  };
}

export type NextReturn = { id: string; journeyId: string | null; date: string; time: string; procedure: string; professional: string; notes: string };

export type ClinicalPendingTarget = "anamnesis" | "encounters";
export type ClinicalPending = { id: string; label: string; detail: string; tone: "required" | "info"; target: ClinicalPendingTarget };

export function clinicalPendings(input: { anamnesisState: "AUSENTE" | "SOMENTE_RASCUNHO" | "REVISAO_PENDENTE" | "REVISADA" | null; draftVersion?: number | null; items: EncounterItem[] }): ClinicalPending[] {
  const pendings: ClinicalPending[] = [];
  if (input.anamnesisState === "AUSENTE") pendings.push({ id: "anamnesis-missing", label: "Preencher anamnese", detail: "Nenhuma anamnese registrada para esta cliente.", tone: "info", target: "anamnesis" });
  if (input.anamnesisState === "SOMENTE_RASCUNHO") pendings.push({ id: "anamnesis-draft", label: "Concluir anamnese em rascunho", detail: input.draftVersion ? `Versão ${input.draftVersion} ainda não concluída.` : "Rascunho ainda não concluído.", tone: "required", target: "anamnesis" });
  if (input.anamnesisState === "REVISAO_PENDENTE") pendings.push({ id: "anamnesis-review", label: "Revisar anamnese", detail: "A última versão está marcada para revisão.", tone: "required", target: "anamnesis" });
  for (const item of sortEncounters(input.items)) {
    for (const pending of item.pendings) pendings.push({ id: `${item.key}:${pending}`, label: pending, detail: `${item.title} · ${clinicDateKey(item.occurredAt).split("-").reverse().join("/")}`, tone: "required", target: "encounters" });
  }
  return pendings;
}
