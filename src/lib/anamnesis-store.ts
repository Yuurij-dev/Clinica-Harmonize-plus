import type { Prisma } from "@prisma/client";
import { alertsFromEvaluation, anamnesisState, defaultReviewPolicy, deriveAnamnesisAlerts, parseAnamnesisContent, pickEvaluationSource, type AuditEntry } from "./anamnesis-rules";
import { prisma } from "./prisma";

// Acesso a dados da anamnese. Toda consulta é filtrada por clinicId e patientId.
export const anamnesisMetaSelect = {
  id: true, version: true, status: true, origin: true, basedOnVersion: true,
  createdBy: true, updatedBy: true, completedBy: true, completedAt: true,
  reviewRequestedBy: true, reviewRequestedAt: true, reviewReason: true, reviewConfirmedBy: true, reviewConfirmedAt: true,
  createdAt: true, updatedAt: true,
} satisfies Prisma.PatientAnamnesisSelect;

export const anamnesisFullSelect = { ...anamnesisMetaSelect, content: true, auditLog: true } satisfies Prisma.PatientAnamnesisSelect;

type MetaRow = Prisma.PatientAnamnesisGetPayload<{ select: typeof anamnesisMetaSelect }>;
type FullRow = Prisma.PatientAnamnesisGetPayload<{ select: typeof anamnesisFullSelect }>;

export function serializeFull(row: FullRow) {
  const { content, auditLog, ...meta } = row;
  const parsed = parseAnamnesisContent(content);
  let audit: AuditEntry[] = [];
  try { const value = JSON.parse(auditLog); if (Array.isArray(value)) audit = value as AuditEntry[]; } catch { audit = []; }
  return { ...meta, content: parsed, alerts: deriveAnamnesisAlerts(parsed), audit };
}

export async function loadAnamnesisOverview(clinicId: string, patientId: string, canRead: boolean) {
  const versions = await prisma.patientAnamnesis.findMany({ where: { clinicId, patientId }, orderBy: { version: "desc" }, take: 100, select: anamnesisMetaSelect });
  const info = anamnesisState<MetaRow>(versions, new Date(), defaultReviewPolicy);
  if (!canRead) {
    // Quem não lê conteúdo clínico só descobre se existe uma anamnese concluída.
    return { restricted: true as const, exists: Boolean(info.current) };
  }
  const [current, draft] = await Promise.all([
    info.current ? prisma.patientAnamnesis.findFirst({ where: { id: info.current.id, clinicId, patientId }, select: anamnesisFullSelect }) : null,
    info.draft ? prisma.patientAnamnesis.findFirst({ where: { id: info.draft.id, clinicId, patientId }, select: anamnesisFullSelect }) : null,
  ]);
  // Sem anamnese concluída: lê (sem alterar) os campos de anamnese da avaliação mais recente como informação auxiliar.
  let evaluationFallback = null;
  if (!info.current) {
    const evaluation = await findEvaluationSource(clinicId, patientId);
    if (evaluation) evaluationFallback = { evaluationId: evaluation.id, createdAt: evaluation.createdAt, professional: evaluation.professional, alerts: alertsFromEvaluation(evaluation) };
  }
  return {
    restricted: false as const,
    exists: Boolean(info.current),
    state: info.state,
    reason: info.reason,
    versions,
    current: current ? serializeFull(current) : null,
    draft: draft ? serializeFull(draft) : null,
    alerts: current ? deriveAnamnesisAlerts(parseAnamnesisContent(current.content)) : evaluationFallback?.alerts ?? [],
    evaluationFallback,
  };
}

// Avaliação usada como origem (leitura auxiliar e "Usar dados da avaliação"): sempre escopada por clínica e paciente.
export async function findEvaluationSource(clinicId: string, patientId: string, requestedId?: string | null) {
  const evaluations = await prisma.evaluation.findMany({
    where: { clinicId, patientId }, orderBy: { createdAt: "desc" }, take: 30,
    select: { id: true, createdAt: true, professional: true, chiefComplaint: true, patientGoal: true, medicalHistory: true, allergies: true, pregnancyStatus: true, anticoagulantUse: true, autoimmuneDiseases: true, contraindications: true, previousProcedures: true, clinicalNotes: true },
  });
  return pickEvaluationSource(evaluations, requestedId);
}
