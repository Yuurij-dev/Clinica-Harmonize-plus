import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import { maxUploadBytes, type FileAuditAction } from "./clinical-files-rules";

type Actor = { id: string; name: string; clinicId: string };
type AuditDetails = { fileName?: string; category?: string; note?: string };

// Linha de auditoria pronta para entrar na MESMA $transaction da mutação (upload, edição, arquivar, excluir).
export function auditEntry(actor: Actor, patientId: string, fileKind: "DOCUMENT" | "PHOTO", fileId: string, action: FileAuditAction, details: AuditDetails = {}) {
  return prisma.clinicalFileAudit.create({ data: { clinicId: actor.clinicId, patientId, fileKind, fileId, action, actorId: actor.id, actorName: actor.name, fileName: (details.fileName ?? "").slice(0, 200), category: details.category ?? "", note: (details.note ?? "").slice(0, 300) } });
}

// Só para leitura (VIEW/DOWNLOAD): a falha na trilha não derruba a resposta. Mutações usam auditEntry dentro da transação.
export async function recordReadAudit(actor: Actor, patientId: string, fileKind: "DOCUMENT" | "PHOTO", fileId: string, action: "VIEW" | "DOWNLOAD", details: AuditDetails = {}, dedupeMinutes = 0) {
  try {
    // Visualizações repetidas do mesmo arquivo pelo mesmo usuário numa janela curta contam uma vez (miniaturas e reaberturas).
    if (dedupeMinutes > 0 && await prisma.clinicalFileAudit.findFirst({ where: { clinicId: actor.clinicId, patientId, fileId, action, actorId: actor.id, createdAt: { gte: new Date(Date.now() - dedupeMinutes * 60_000) } }, select: { id: true } })) return;
    await auditEntry(actor, patientId, fileKind, fileId, action, details);
  } catch {
    // ver comentário acima
  }
}

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export async function findPatientScoped(clinicId: string, patientId: string) {
  return prisma.patient.findFirst({ where: { id: patientId, clinicId }, select: { id: true } });
}

// Termos da jornada (não arquivados) que liberam ou ainda pendem o início do procedimento. Sempre escopado por clínica/paciente/jornada.
export async function consentCounts(clinicId: string, patientId: string, journeyId: string, db: Pick<typeof prisma, "clinicalDocument"> = prisma) {
  const where = { clinicId, patientId, journeyId, category: "TERMOS", archivedAt: null };
  const [signed, pending] = await Promise.all([
    db.clinicalDocument.count({ where: { ...where, signatureStatus: "ASSINADO" } }),
    db.clinicalDocument.count({ where: { ...where, signatureStatus: "PENDENTE" } }),
  ]);
  return { signed, pending };
}

const multipartSlack = 64 * 1024;

// Recusa antes de bufferizar: exige Content-Length dentro do limite e ainda corta a leitura do corpo se ele passar do declarado/limite.
export async function readUploadForm(request: Request): Promise<{ form: FormData } | { response: Response }> {
  const tooLarge = () => ({ response: Response.json({ message: "O arquivo excede 4 MB." }, { status: 413 }) });
  const declared = Number(request.headers.get("content-length"));
  if (!request.headers.get("content-length") || !Number.isFinite(declared) || declared < 0) return { response: Response.json({ message: "Tamanho do envio não informado." }, { status: 413 }) };
  const limit = maxUploadBytes + multipartSlack;
  if (declared > limit) return tooLarge();
  const type = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data/i.test(type) || !request.body) return { response: Response.json({ message: "Envie o arquivo em multipart/form-data." }, { status: 400 }) };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limit) { await reader.cancel().catch(() => undefined); return tooLarge(); }
    chunks.push(value);
  }
  try {
    const form = await new Response(new Blob(chunks as BlobPart[]), { headers: { "content-type": type } }).formData();
    return { form };
  } catch {
    return { response: Response.json({ message: "Envio inválido." }, { status: 400 }) };
  }
}

export type LinkInput = { journeyId: string | null; encounterType: string | null; encounterId: string | null };

// Normaliza e valida o vínculo a tratamento/atendimento (mesma clínica e mesmo paciente). Quem não pode vincular atendimento
// (includeEncounter=false, ex.: STAFF) recebe sempre a mesma recusa, sem revelar se o id existe.
export async function resolveLinks(clinicId: string, patientId: string, input: { journeyId?: unknown; encounterType?: unknown; encounterId?: unknown }, includeEncounter: boolean): Promise<{ ok: true; links: LinkInput } | { ok: false; message: string }> {
  const journeyId = typeof input.journeyId === "string" && input.journeyId ? input.journeyId : null;
  const encounterType = typeof input.encounterType === "string" && input.encounterType ? input.encounterType : null;
  const encounterId = typeof input.encounterId === "string" && input.encounterId ? input.encounterId : null;
  if ((encounterType || encounterId) && !includeEncounter) return { ok: false, message: "Vínculo com atendimento não permitido." };
  if (journeyId && !await prisma.patientJourney.findFirst({ where: { id: journeyId, clinicId, patientId }, select: { id: true } })) return { ok: false, message: "Tratamento não encontrado." };
  if (!encounterType && !encounterId) return { ok: true, links: { journeyId, encounterType: null, encounterId: null } };
  if (!encounterType || !encounterId || !["evaluation", "session", "followup"].includes(encounterType)) return { ok: false, message: "Atendimento inválido." };
  const where = { id: encounterId, clinicId, patientId };
  const found = encounterType === "evaluation" ? await prisma.evaluation.findFirst({ where, select: { journeyId: true } })
    : encounterType === "session" ? await prisma.patientProcedureSession.findFirst({ where, select: { journeyId: true } })
      : await prisma.patientProcedureFollowUp.findFirst({ where, select: { journeyId: true } });
  if (!found) return { ok: false, message: "Atendimento não encontrado." };
  if (journeyId && found.journeyId !== journeyId) return { ok: false, message: "O atendimento não pertence ao tratamento informado." };
  return { ok: true, links: { journeyId: journeyId ?? found.journeyId ?? null, encounterType, encounterId } };
}
