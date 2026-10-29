// Regras puras da avaliação clínica (cliente e servidor usam as mesmas).
//
// Para CONCLUIR a avaliação todos os campos abaixo são obrigatórios. Nos cinco campos de anamnese rápida o select
// oferece "Não informado" (vazio), "Não" e "Sim": só vazio não vale; "Sim", "Não" ou texto legado contam como preenchido.
// Rascunhos e avaliações antigas com campos vazios continuam legíveis e salváveis; a exigência é só ao concluir.

export const requiredAssessmentFields = [
  { key: "chiefComplaint", message: "Informe a queixa principal para avançar.", ask: "a queixa principal" },
  { key: "patientGoal", message: "Informe o objetivo do paciente para avançar.", ask: "o objetivo do paciente" },
  { key: "allergies", message: "Informe se há alergias (Sim ou Não).", ask: "se há alergias (Sim ou Não)" },
  { key: "pregnancyStatus", message: "Informe se a paciente está gestante (Sim ou Não).", ask: "se a paciente está gestante (Sim ou Não)" },
  { key: "anticoagulantUse", message: "Informe o uso de anticoagulante (Sim ou Não).", ask: "o uso de anticoagulante (Sim ou Não)" },
  { key: "autoimmuneDiseases", message: "Informe se há doenças autoimunes (Sim ou Não).", ask: "se há doenças autoimunes (Sim ou Não)" },
  { key: "previousProcedures", message: "Informe se há procedimentos anteriores (Sim ou Não).", ask: "se há procedimentos anteriores (Sim ou Não)" },
  { key: "clinicalNotes", message: "Informe as observações clínicas para avançar.", ask: "as observações clínicas" },
] as const;

export type RequiredAssessmentField = typeof requiredAssessmentFields[number]["key"];
type AssessmentValues = Partial<Record<RequiredAssessmentField, string | null | undefined>>;

// Campos obrigatórios ainda vazios, na ordem da tela.
// `previous` = valores gravados de uma avaliação JÁ concluída: nela só conta como pendente o campo que estava preenchido e
// foi esvaziado. Campo que já era vazio (avaliação antiga) e continua vazio passa, para não travar o salvamento de fotos e marcações.
// Concluir a partir de rascunho (sem `previous`) exige os 8 campos.
export function missingAssessmentFields(assessment: AssessmentValues, previous?: AssessmentValues | null) {
  return requiredAssessmentFields.filter((field) => !(assessment[field.key] ?? "").trim() && (!previous || (previous[field.key] ?? "").trim()));
}

// Erros por campo para a tela (mesmo padrão da queixa principal).
export function assessmentFieldErrors(assessment: AssessmentValues, previous?: AssessmentValues | null) {
  return Object.fromEntries(missingAssessmentFields(assessment, previous).map((field) => [field.key, field.message])) as Partial<Record<RequiredAssessmentField, string>>;
}

/** Limite das observações da avaliação facial (campo opcional, nunca bloqueia salvar nem concluir). */
export const facialNotesMaxLength = 500;
export const facialNotesTooLongMessage = `As observações da avaliação facial aceitam até ${facialNotesMaxLength} caracteres.`;

/** Valida e normaliza (trim) o campo enviado ao PUT. Quem não envia o campo (app mobile) não chama isto e o valor gravado fica como está. */
export function parseFacialNotes(value: unknown): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof value !== "string") return { ok: false, message: "As observações da avaliação facial devem ser um texto." };
  const trimmed = value.trim();
  if (trimmed.length > facialNotesMaxLength) return { ok: false, message: facialNotesTooLongMessage };
  return { ok: true, value: trimmed };
}

// Mensagem da API ao concluir sem todos os campos.
export function assessmentCompletionError(assessment: AssessmentValues, previous?: AssessmentValues | null) {
  const missing = missingAssessmentFields(assessment, previous);
  if (!missing.length) return null;
  return `Informe ${missing[0].ask} para concluir a avaliação.`;
}
