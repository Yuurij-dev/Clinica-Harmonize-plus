// Regras puras da anamnese versionada (sem acesso a banco), compartilhadas entre rotas, telas e testes.
//
// Princípios:
// - Resposta tri-estado: "yes" | "no" | "not_informed". Campo nunca respondido fica `null` e NUNCA vira "no".
// - Versão concluída é imutável (só o conteúdo de RASCUNHO é editável); editar uma concluída cria nova versão.
// - "Revisão pendente" é uma marcação explícita (PENDENTE_REVISAO) feita por um profissional. O tempo decorrido só
//   conta se a clínica ligar uma política (`ReviewPolicy.maxAgeDays`), que fica desligada por padrão.
// - Alertas são apenas informativos; nada aqui declara o paciente apto ou inapto.

export type TriState = "yes" | "no" | "not_informed";
export type Answer = { value: TriState | null; detail: string };
export type AnamnesisStatus = "RASCUNHO" | "CONCLUIDA" | "PENDENTE_REVISAO";
export type AnamnesisOrigin = "empty" | "current-version" | "evaluation";

export const ANAMNESIS_SCHEMA_VERSION = 1;

export const healthItems = [
  { key: "chronicDiseases", label: "Doenças crônicas" },
  { key: "hypertension", label: "Hipertensão arterial" },
  { key: "diabetes", label: "Diabetes mellitus" },
  { key: "autoimmune", label: "Doenças autoimunes" },
  { key: "cardiac", label: "Doenças cardíacas" },
  { key: "coagulation", label: "Distúrbios de coagulação" },
  { key: "cancer", label: "Câncer (atual ou prévio)" },
  { key: "hormonal", label: "Problemas hormonais" },
  { key: "pregnancy", label: "Gestação ou lactação" },
  { key: "anticoagulants", label: "Uso de anticoagulante" },
  { key: "keloid", label: "Tendência a queloide" },
  { key: "smoking", label: "Tabagismo" },
  { key: "alcohol", label: "Etilismo frequente" },
] as const;

export const allergyItems = [
  { key: "medications", label: "Alergia a medicamentos" },
  { key: "anesthetics", label: "Alergia a anestésicos" },
  { key: "foods", label: "Alergia a alimentos" },
  { key: "latex", label: "Alergia a látex" },
  { key: "topicals", label: "Sensibilidade a produtos tópicos" },
] as const;

export type HealthKey = typeof healthItems[number]["key"];
export type AllergyKey = typeof allergyItems[number]["key"];

export type MedicationRow = { id: string; name: string; purpose: string; dose: string; notes: string };
export type PreviousProcedureRow = { id: string; name: string; region: string; date: string; notes: string };

export type AnamnesisContent = {
  schemaVersion: number;
  complaint: { chiefComplaint: string; treatmentGoal: string };
  health: { items: Record<HealthKey, Answer>; notes: string };
  allergies: { items: Record<AllergyKey, Answer>; notes: string };
  medications: { usesMedication: TriState | null; items: MedicationRow[] };
  previousProcedures: { hadPrevious: TriState | null; items: PreviousProcedureRow[] };
  contraindications: { notes: string; observations: string };
  // Ponto de extensão: perguntas específicas por procedimento (chave = id/slug do procedimento). Hoje sem formulário.
  procedureSpecific: Record<string, unknown>;
};

export const limits = { short: 200, text: 2000, rows: 30, extension: 20_000 } as const;

const triValues: readonly string[] = ["yes", "no", "not_informed"];

export const triLabels: Record<TriState, string> = { yes: "Sim", no: "Não", not_informed: "Não informado" };

// Rótulo exibido para uma resposta; ausência de resposta nunca é apresentada como "Não".
export function answerLabel(value: TriState | null | undefined) {
  return value ? triLabels[value] : "Não informado";
}

function emptyAnswers<K extends string>(items: ReadonlyArray<{ key: K }>) {
  return Object.fromEntries(items.map((item) => [item.key, { value: null, detail: "" }])) as Record<K, Answer>;
}

export function emptyAnamnesisContent(): AnamnesisContent {
  return {
    schemaVersion: ANAMNESIS_SCHEMA_VERSION,
    complaint: { chiefComplaint: "", treatmentGoal: "" },
    health: { items: emptyAnswers(healthItems), notes: "" },
    allergies: { items: emptyAnswers(allergyItems), notes: "" },
    medications: { usesMedication: null, items: [] },
    previousProcedures: { hadPrevious: null, items: [] },
    contraindications: { notes: "", observations: "" },
    procedureSpecific: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function tri(value: unknown): TriState | null {
  return typeof value === "string" && triValues.includes(value) ? value as TriState : null;
}

function normalizeAnswers<K extends string>(raw: unknown, items: ReadonlyArray<{ key: K }>) {
  const source = isRecord(raw) ? raw : {};
  return Object.fromEntries(items.map((item) => {
    const answer = isRecord(source[item.key]) ? source[item.key] as Record<string, unknown> : {};
    return [item.key, { value: tri(answer.value), detail: text(answer.detail, limits.short) }];
  })) as Record<K, Answer>;
}

function rowId(value: unknown, index: number) {
  return typeof value === "string" && value.length > 0 && value.length <= 40 ? value : `row-${index}`;
}

// Sanitiza qualquer entrada (JSON do banco ou do cliente) para o formato atual, limitando tamanhos.
// Não preenche respostas ausentes com "no": o que não foi respondido continua `null`.
export function normalizeAnamnesisContent(raw: unknown): AnamnesisContent {
  const source = isRecord(raw) ? raw : {};
  const complaint = isRecord(source.complaint) ? source.complaint : {};
  const health = isRecord(source.health) ? source.health : {};
  const allergies = isRecord(source.allergies) ? source.allergies : {};
  const medications = isRecord(source.medications) ? source.medications : {};
  const previous = isRecord(source.previousProcedures) ? source.previousProcedures : {};
  const contraindications = isRecord(source.contraindications) ? source.contraindications : {};
  let procedureSpecific: Record<string, unknown> = {};
  if (isRecord(source.procedureSpecific)) {
    try {
      const serialized = JSON.stringify(source.procedureSpecific);
      if (serialized.length <= limits.extension) procedureSpecific = JSON.parse(serialized) as Record<string, unknown>;
    } catch { procedureSpecific = {}; }
  }
  return {
    schemaVersion: ANAMNESIS_SCHEMA_VERSION,
    complaint: { chiefComplaint: text(complaint.chiefComplaint, limits.text), treatmentGoal: text(complaint.treatmentGoal, limits.text) },
    health: { items: normalizeAnswers(health.items, healthItems), notes: text(health.notes, limits.text) },
    allergies: { items: normalizeAnswers(allergies.items, allergyItems), notes: text(allergies.notes, limits.text) },
    medications: {
      usesMedication: tri(medications.usesMedication),
      items: (Array.isArray(medications.items) ? medications.items : []).filter(isRecord).slice(0, limits.rows).map((row, index) => ({
        id: rowId(row.id, index), name: text(row.name, limits.short), purpose: text(row.purpose, limits.short), dose: text(row.dose, limits.short), notes: text(row.notes, limits.short),
      })),
    },
    previousProcedures: {
      hadPrevious: tri(previous.hadPrevious),
      items: (Array.isArray(previous.items) ? previous.items : []).filter(isRecord).slice(0, limits.rows).map((row, index) => ({
        id: rowId(row.id, index), name: text(row.name, limits.short), region: text(row.region, limits.short), date: text(row.date, 40), notes: text(row.notes, limits.short),
      })),
    },
    contraindications: { notes: text(contraindications.notes, limits.text), observations: text(contraindications.observations, limits.text) },
    procedureSpecific,
  };
}

// Lê o JSON salvo no banco; conteúdo corrompido vira um formulário vazio em vez de derrubar a tela.
export function parseAnamnesisContent(stored: string) {
  try { return normalizeAnamnesisContent(JSON.parse(stored)); } catch { return emptyAnamnesisContent(); }
}

function allAnswers(content: AnamnesisContent) {
  return [...Object.values(content.health.items), ...Object.values(content.allergies.items)];
}

function filled(value: string) {
  return value.trim().length > 0;
}

export function hasAnamnesisContent(content: AnamnesisContent) {
  return filled(content.complaint.chiefComplaint) || filled(content.complaint.treatmentGoal)
    || allAnswers(content).some((answer) => answer.value !== null || filled(answer.detail))
    || filled(content.health.notes) || filled(content.allergies.notes)
    || content.medications.usesMedication !== null || content.medications.items.some((row) => filled(row.name))
    || content.previousProcedures.hadPrevious !== null || content.previousProcedures.items.some((row) => filled(row.name))
    || filled(content.contraindications.notes) || filled(content.contraindications.observations);
}

// Quantidade de perguntas de saúde/alergia ainda sem resposta (null) ou marcadas como "Não informado".
export function unansweredCount(content: AnamnesisContent) {
  return allAnswers(content).filter((answer) => answer.value === null || answer.value === "not_informed").length;
}

export function completionCheck(content: AnamnesisContent) {
  const errors: string[] = [];
  if (!hasAnamnesisContent(content)) errors.push("Preencha ao menos uma informação antes de concluir a anamnese.");
  const incompleteMedication = content.medications.items.some((row) => !filled(row.name) && (filled(row.purpose) || filled(row.dose) || filled(row.notes)));
  if (incompleteMedication) errors.push("Informe o nome de cada medicamento preenchido.");
  const incompleteProcedure = content.previousProcedures.items.some((row) => !filled(row.name) && (filled(row.region) || filled(row.date) || filled(row.notes)));
  if (incompleteProcedure) errors.push("Informe o nome de cada procedimento anterior preenchido.");
  return { ok: errors.length === 0, errors, unanswered: unansweredCount(content) };
}

// Remove linhas totalmente vazias antes de concluir.
export function pruneEmptyRows(content: AnamnesisContent): AnamnesisContent {
  return {
    ...content,
    medications: { ...content.medications, items: content.medications.items.filter((row) => [row.name, row.purpose, row.dose, row.notes].some(filled)) },
    previousProcedures: { ...content.previousProcedures, items: content.previousProcedures.items.filter((row) => [row.name, row.region, row.date, row.notes].some(filled)) },
  };
}

// --- Alertas clínicos (somente informativos) ---

export type AlertLevel = "important" | "attention" | "info";
export type AnamnesisAlert = { id: string; level: AlertLevel; label: string; detail: string; section: "health" | "allergies" | "medications" | "contraindications" };

const healthAlertLevels: Record<HealthKey, AlertLevel> = {
  chronicDiseases: "attention", hypertension: "attention", diabetes: "attention", autoimmune: "attention", cardiac: "attention",
  coagulation: "important", cancer: "attention", hormonal: "attention", pregnancy: "important", anticoagulants: "important",
  keloid: "attention", smoking: "info", alcohol: "info",
};

const levelOrder: Record<AlertLevel, number> = { important: 0, attention: 1, info: 2 };

// Só respostas "Sim" geram alerta. "Não", "Não informado" e campos em branco nunca produzem alerta nem afirmação de ausência.
export function deriveAnamnesisAlerts(content: AnamnesisContent): AnamnesisAlert[] {
  const alerts: AnamnesisAlert[] = [];
  for (const item of allergyItems) {
    const answer = content.allergies.items[item.key];
    if (answer.value === "yes") alerts.push({ id: `allergy-${item.key}`, level: "important", label: item.label, detail: answer.detail, section: "allergies" });
  }
  if (content.allergies.notes.trim() && !alerts.some((alert) => alert.section === "allergies")) {
    alerts.push({ id: "allergy-notes", level: "attention", label: "Alergias e sensibilidades (observações)", detail: content.allergies.notes.trim().slice(0, 160), section: "allergies" });
  }
  for (const item of healthItems) {
    const answer = content.health.items[item.key];
    if (answer.value === "yes") alerts.push({ id: `health-${item.key}`, level: healthAlertLevels[item.key], label: item.label, detail: answer.detail, section: "health" });
  }
  const medicines = content.medications.items.map((row) => row.name.trim()).filter(Boolean);
  if (medicines.length) alerts.push({ id: "medications", level: "info", label: `Medicamentos em uso (${medicines.length})`, detail: medicines.slice(0, 4).join(", ") + (medicines.length > 4 ? "…" : ""), section: "medications" });
  else if (content.medications.usesMedication === "yes") alerts.push({ id: "medications", level: "info", label: "Uso de medicamentos informado", detail: "", section: "medications" });
  if (content.contraindications.notes.trim()) alerts.push({ id: "contraindications", level: "attention", label: "Contraindicações registradas", detail: content.contraindications.notes.trim().slice(0, 160), section: "contraindications" });
  return alerts.sort((left, right) => levelOrder[left.level] - levelOrder[right.level]);
}

export function importantAlerts(alerts: AnamnesisAlert[]) {
  return alerts.filter((alert) => alert.level === "important");
}

// --- Versões, revisão e estado ---

type DateLike = string | Date | null | undefined;
export type VersionMeta = { id: string; version: number; status: string; completedAt?: DateLike; reviewConfirmedAt?: DateLike; reviewRequestedAt?: DateLike };

export const isFinalStatus = (status: string) => status === "CONCLUIDA" || status === "PENDENTE_REVISAO";

// Versão atual = a concluída de maior número (inclui as marcadas como pendente de revisão).
export function currentVersion<T extends VersionMeta>(versions: T[]) {
  return versions.filter((item) => isFinalStatus(item.status)).sort((left, right) => right.version - left.version)[0] ?? null;
}

export function openDraft<T extends VersionMeta>(versions: T[]) {
  return versions.filter((item) => item.status === "RASCUNHO").sort((left, right) => right.version - left.version)[0] ?? null;
}

export function nextVersionNumber(versions: Array<Pick<VersionMeta, "version">>) {
  return versions.reduce((max, item) => Math.max(max, item.version), 0) + 1;
}

// Só o rascunho aceita alteração de conteúdo. Versão concluída é imutável.
export function isContentEditable(status: string) {
  return status === "RASCUNHO";
}

const allowedTransitions: Record<string, readonly string[]> = {
  RASCUNHO: ["CONCLUIDA"],
  CONCLUIDA: ["PENDENTE_REVISAO"],
  PENDENTE_REVISAO: ["CONCLUIDA"],
};

export function canTransition(from: string, to: string) {
  return (allowedTransitions[from] ?? []).includes(to);
}

// Política opcional de revisão por tempo. `maxAgeDays: null` (padrão) = desligada: o tempo não gera pendência.
export type ReviewPolicy = { maxAgeDays: number | null };
export const defaultReviewPolicy: ReviewPolicy = { maxAgeDays: null };

export type AnamnesisState = "AUSENTE" | "SOMENTE_RASCUNHO" | "REVISAO_PENDENTE" | "REVISADA";
export type AnamnesisStateInfo<T extends VersionMeta> = { state: AnamnesisState; reason: "manual" | "policy" | null; current: T | null; draft: T | null };

function time(value: DateLike) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function anamnesisState<T extends VersionMeta>(versions: T[], now: Date = new Date(), policy: ReviewPolicy = defaultReviewPolicy): AnamnesisStateInfo<T> {
  const current = currentVersion(versions);
  const draft = openDraft(versions);
  if (!current) return { state: draft ? "SOMENTE_RASCUNHO" : "AUSENTE", reason: null, current: null, draft };
  if (current.status === "PENDENTE_REVISAO") return { state: "REVISAO_PENDENTE", reason: "manual", current, draft };
  if (policy.maxAgeDays && policy.maxAgeDays > 0) {
    const validatedAt = Math.max(time(current.completedAt), time(current.reviewConfirmedAt));
    if (validatedAt && now.getTime() - validatedAt > policy.maxAgeDays * 86_400_000) return { state: "REVISAO_PENDENTE", reason: "policy", current, draft };
  }
  return { state: "REVISADA", reason: null, current, draft };
}

export type StartGateDecision = "proceed" | "missing" | "draft" | "review";

// Decide o que "Iniciar atendimento" faz. Nenhum estado bloqueia o atendimento: "missing" e "draft" apenas avisam.
export function startGateDecision(state: AnamnesisState): StartGateDecision {
  if (state === "AUSENTE") return "missing";
  if (state === "SOMENTE_RASCUNHO") return "draft";
  if (state === "REVISAO_PENDENTE") return "review";
  return "proceed";
}

// --- Auditoria ---

export type AuditEntry = { at: string; by: string; userId: string; action: string; note?: string };

export function appendAudit(stored: string, entry: AuditEntry, max = 100) {
  let list: AuditEntry[] = [];
  try {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) list = parsed as AuditEntry[];
  } catch { list = []; }
  return JSON.stringify([...list, entry].slice(-max));
}

// --- Aproveitamento (leitura) dos campos de anamnese que hoje vivem na Evaluation ---

export type EvaluationAnamnesisFields = {
  chiefComplaint?: string | null; patientGoal?: string | null; medicalHistory?: string | null; allergies?: string | null;
  pregnancyStatus?: string | null; anticoagulantUse?: string | null; autoimmuneDiseases?: string | null;
  contraindications?: string | null; previousProcedures?: string | null; clinicalNotes?: string | null;
};

function joinLines(entries: Array<[string, string | null | undefined]>) {
  return entries.filter(([, value]) => value && value.trim()).map(([label, value]) => label ? `${label}: ${value!.trim()}` : value!.trim()).join("\n");
}

export function hasEvaluationAnamnesis(evaluation: EvaluationAnamnesisFields | null | undefined) {
  if (!evaluation) return false;
  return Object.values(pickAnamnesisFields(evaluation)).some((value) => typeof value === "string" && value.trim().length > 0);
}

// Pré-preenche um rascunho com o que a avaliação registrou como texto livre. Texto livre NUNCA define Sim/Não:
// as respostas continuam `null` e o profissional confirma cada uma.
export function contentFromEvaluation(evaluation: EvaluationAnamnesisFields): AnamnesisContent {
  const content = emptyAnamnesisContent();
  content.complaint.chiefComplaint = (evaluation.chiefComplaint ?? "").trim().slice(0, limits.text);
  content.complaint.treatmentGoal = (evaluation.patientGoal ?? "").trim().slice(0, limits.text);
  content.health.notes = joinLines([["", evaluation.medicalHistory], ["Gestação", evaluation.pregnancyStatus], ["Uso de anticoagulante", evaluation.anticoagulantUse], ["Doenças autoimunes", evaluation.autoimmuneDiseases]]).slice(0, limits.text);
  content.allergies.notes = (evaluation.allergies ?? "").trim().slice(0, limits.text);
  if ((evaluation.previousProcedures ?? "").trim()) content.previousProcedures.items = [{ id: "row-0", name: "Registrado na avaliação", region: "", date: "", notes: evaluation.previousProcedures!.trim().slice(0, limits.short) }];
  content.contraindications.notes = (evaluation.contraindications ?? "").trim().slice(0, limits.text);
  content.contraindications.observations = (evaluation.clinicalNotes ?? "").trim().slice(0, limits.text);
  return content;
}

export type EvaluationPrefill = { chiefComplaint?: string; patientGoal?: string; allergies?: string; pregnancyStatus?: string; anticoagulantUse?: string; autoimmuneDiseases?: string; previousProcedures?: string };

const triToChoice = (value: TriState | null | undefined) => value === "yes" ? "Sim" : value === "no" ? "Não" : undefined;

// Inverso de `contentFromEvaluation` para os campos Sim/Não da avaliação. Só devolve o que a anamnese responde de fato:
// null/"not_informed" NUNCA vira "Não". Alergias: "Sim" se qualquer item for sim; "Não" só se TODOS os itens forem não.
export function evaluationFieldsFromAnamnesis(content: AnamnesisContent): EvaluationPrefill {
  const result: EvaluationPrefill = {};
  const complaint = content.complaint.chiefComplaint.trim();
  const goal = content.complaint.treatmentGoal.trim();
  if (complaint) result.chiefComplaint = complaint;
  if (goal) result.patientGoal = goal;
  const allergyAnswers = Object.values(content.allergies.items).map((answer) => answer.value);
  const allergies = allergyAnswers.includes("yes") ? "Sim" : allergyAnswers.every((value) => value === "no") ? "Não" : undefined;
  if (allergies) result.allergies = allergies;
  const pregnancy = triToChoice(content.health.items.pregnancy.value);
  if (pregnancy) result.pregnancyStatus = pregnancy;
  const anticoagulants = triToChoice(content.health.items.anticoagulants.value);
  if (anticoagulants) result.anticoagulantUse = anticoagulants;
  const autoimmune = triToChoice(content.health.items.autoimmune.value);
  if (autoimmune) result.autoimmuneDiseases = autoimmune;
  const previous = triToChoice(content.previousProcedures.hadPrevious);
  if (previous) result.previousProcedures = previous;
  return result;
}

// Aplica o pré-preenchimento só nos campos da avaliação que estão vazios; nunca sobrescreve o que foi escrito.
// Devolve o mesmo objeto quando nada muda.
export function fillEmptyEvaluationFields<T extends Record<keyof EvaluationPrefill, string>>(assessment: T, prefill: EvaluationPrefill): T {
  const next = { ...assessment };
  let changed = false;
  for (const key of Object.keys(prefill) as Array<keyof EvaluationPrefill>) {
    const value = prefill[key];
    if (value && !assessment[key].trim()) { next[key] = value as T[typeof key]; changed = true; }
  }
  return changed ? next : assessment;
}

// Alertas informativos quando só existe o registro antigo da avaliação (sem anamnese).
export function alertsFromEvaluation(evaluation: EvaluationAnamnesisFields | null | undefined): AnamnesisAlert[] {
  if (!evaluation) return [];
  const alerts: AnamnesisAlert[] = [];
  const allergies = (evaluation.allergies ?? "").trim();
  if (allergies) alerts.push({ id: "evaluation-allergies", level: "attention", label: "Alergias registradas na avaliação", detail: allergies.slice(0, 160), section: "allergies" });
  const contraindications = (evaluation.contraindications ?? "").trim();
  if (contraindications) alerts.push({ id: "evaluation-contraindications", level: "attention", label: "Contraindicações registradas na avaliação", detail: contraindications.slice(0, 160), section: "contraindications" });
  return alerts;
}

// --- Conflito de edição (controle otimista) ---

// A revisão do rascunho é o `updatedAt` (ISO). Sem revisão esperada, ou diferente da atual, há conflito.
export function revisionConflict(expected: unknown, actual: Date | string) {
  if (typeof expected !== "string" || !expected) return true;
  const expectedTime = new Date(expected).getTime();
  const actualTime = new Date(actual).getTime();
  return Number.isNaN(expectedTime) || Number.isNaN(actualTime) || expectedTime !== actualTime;
}

export const staleDraftMessage = "Este rascunho foi alterado em outra aba ou por outra pessoa. Recarregue para ver a versão mais recente; suas alterações não foram gravadas por cima.";

// --- Exibição do status no histórico ---

// Uma versão marcada para revisão que já foi superada por uma versão mais nova concluída não é mais "pendente".
export function displayVersionStatus(version: { id: string; status: string }, currentId: string | null | undefined) {
  if (version.status === "RASCUNHO") return "RASCUNHO" as const;
  if (version.id !== currentId) return "SUBSTITUIDA" as const;
  return version.status === "PENDENTE_REVISAO" ? "PENDENTE_REVISAO" as const : "CONCLUIDA" as const;
}

// --- Avaliação de origem ("Usar dados da avaliação") ---

// Mesma regra para a leitura (alertas auxiliares) e para a criação do rascunho: avaliação mais recente COM dados de
// anamnese. Se um id foi pedido, ele precisa estar entre as avaliações do paciente e ter dados.
export function pickEvaluationSource<T extends EvaluationAnamnesisFields & { id: string }>(evaluationsNewestFirst: T[], requestedId?: string | null) {
  if (requestedId) {
    const requested = evaluationsNewestFirst.find((item) => item.id === requestedId);
    return requested && hasEvaluationAnamnesis(pickAnamnesisFields(requested)) ? requested : null;
  }
  return evaluationsNewestFirst.find((item) => hasEvaluationAnamnesis(pickAnamnesisFields(item))) ?? null;
}

// Só os campos de anamnese: id, data e profissional não contam como "dado".
export function pickAnamnesisFields(evaluation: EvaluationAnamnesisFields): EvaluationAnamnesisFields {
  return {
    chiefComplaint: evaluation.chiefComplaint, patientGoal: evaluation.patientGoal, medicalHistory: evaluation.medicalHistory, allergies: evaluation.allergies,
    pregnancyStatus: evaluation.pregnancyStatus, anticoagulantUse: evaluation.anticoagulantUse, autoimmuneDiseases: evaluation.autoimmuneDiseases,
    contraindications: evaluation.contraindications, previousProcedures: evaluation.previousProcedures, clinicalNotes: evaluation.clinicalNotes,
  };
}

// --- Pedido de abrir a anamnese (cadastro, gate, agenda) ---

export type AnamnesisRequest = { mode: "fill" | "new-version"; nonce: number };
export type AutoStartAction = "edit-draft" | "create-empty" | "create-from-current" | "none";

// O que um pedido faz, dado o estado atual. Um pedido vale uma única vez (nonce) e nunca cria rascunho sem necessidade:
// com rascunho aberto só o abre; sem nenhuma versão cria vazio; com versão atual só cria cópia se pediram "nova versão".
export function autoStartAction(mode: AnamnesisRequest["mode"], state: { hasDraft: boolean; hasCurrent: boolean }): AutoStartAction {
  if (state.hasDraft) return "edit-draft";
  if (!state.hasCurrent) return "create-empty";
  return mode === "new-version" ? "create-from-current" : "none";
}

// true quando o pedido ainda não foi consumido.
export function isFreshRequest(request: AnamnesisRequest | null | undefined, handledNonce: number | null) {
  return Boolean(request) && request!.nonce !== handledNonce;
}
