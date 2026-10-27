import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyUnless } from "@/lib/api-guards";
import { appointmentDay, clinicToday, dateOnly } from "@/lib/clinic-time";
import { PROCEDURE_APPOINTMENT_PREFIX, scheduledAppointmentOrder } from "@/lib/procedure-session-rules";
import { consentCounts } from "@/lib/clinical-files-server";
import { consentSummary } from "@/lib/consent-rules";
import { prisma } from "@/lib/prisma";
import { lotBalances } from "@/lib/stock";
import { seedDraftMaterials } from "@/lib/session-materials";
import { combinedProcedureName, shouldRefreshDraftName } from "@/lib/procedure-session-rules";

type SessionPhotoInput = { id?: string; name?: string; phase?: string; category?: string; imageUrl?: string; sourceEvaluationPhotoId?: string; width?: number; height?: number };
type MaterialInput = { productId?: string; quantity?: number; allocations?: Array<{ lotId?: string; quantity?: number }> };
const statuses = new Set(["Rascunho", "Em execução", "Concluída"]);
const phases = new Set(["Antes", "Imediatamente após"]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
  const denied = denyUnless(user, "clinical:read");
  if (denied) return denied;
  const patientId = (await params).id;
  const query = new URL(request.url).searchParams;
  const journeyId = query.get("journeyId") ?? "";
  const quoteId = query.get("quoteId") ?? "";
  const [journey, quote] = await Promise.all([
    prisma.patientJourney.findFirst({ where: { id: journeyId, patientId, clinicId: user.clinicId, archivedAt: null }, select: { id: true, name: true, status: true } }),
    prisma.quote.findFirst({ where: { id: quoteId, patientId, journeyId, clinicId: user.clinicId }, select: { id: true, status: true, evaluationId: true, items: true, details: true, approvedAt: true } }),
  ]);
  if (!journey || !quote || !quote.evaluationId) return NextResponse.json({ message: "Jornada ou orçamento aprovado não encontrado." }, { status: 404 });
  if (!["Aprovado", "Pago"].includes(quote.status)) return NextResponse.json({ message: "O orçamento precisa estar aprovado antes de iniciar a execução." }, { status: 409 });
  const [evaluation, sessions, scheduled] = await Promise.all([
    prisma.evaluation.findFirst({ where: { id: quote.evaluationId, patientId, journeyId, clinicId: user.clinicId }, select: { id: true, chiefComplaint: true, patientGoal: true, allergies: true, contraindications: true, photos: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, imageUrl: true, width: true, height: true, category: true } } } }),
    prisma.patientProcedureSession.findMany({ where: { clinicId: user.clinicId, patientId, journeyId, quoteId }, orderBy: [{ performedAt: "desc" }, { createdAt: "desc" }] }),
    // Procedimento já marcado na Agenda para esta jornada (retornos são "Retorno - ..." e ficam de fora).
    prisma.appointment.findFirst({ where: { clinicId: user.clinicId, patientId, journeyId, procedure: { startsWith: PROCEDURE_APPOINTMENT_PREFIX }, status: { in: ["Agendado", "Em atendimento"] } }, orderBy: scheduledAppointmentOrder(), select: { id: true, date: true, time: true, procedure: true, professional: true, status: true } }),
  ]);
  if (!evaluation) return NextResponse.json({ message: "A avaliação associada ao orçamento não foi encontrada." }, { status: 404 });
  const stored = parseJson<{ items?: Array<{ procedureId: string; name: string; quantity: number }> }>(quote.details, {});
  const storedItems = stored.items ?? [];
  const procedureIds = storedItems.map((item) => item.procedureId).filter(Boolean);
  const [procedureCatalog, products, balances] = await Promise.all([
    prisma.procedure.findMany({ where: { clinicId: user.clinicId, ...(procedureIds.length ? { id: { in: procedureIds } } : {}) }, select: { id: true, name: true, durationMinutes: true, technicalSheet: { select: { productId: true, quantity: true } } } }),
    prisma.product.findMany({ where: { clinicId: user.clinicId, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true, unit: true, lots: { where: { expiresOn: { gte: new Date(`${clinicToday()}T00:00:00Z`) } }, orderBy: { expiresOn: "asc" }, select: { id: true, code: true, expiresOn: true } } } }),
    lotBalances(user.clinicId),
  ]);
  const selected = storedItems.length ? storedItems : restoreLegacyQuoteItems(quote.items, procedureCatalog);
  const selectedProcedureIds = new Set(selected.map((item) => item.procedureId));
  const procedures = procedureCatalog.filter((procedure) => selectedProcedureIds.has(procedure.id));
  const evaluationPhotos = evaluation.photos.map(({ imageUrl, ...photo }) => ({ ...photo, imageUrl }));
  return NextResponse.json({
    journey,
    quote: { id: quote.id, status: quote.status, approvedAt: quote.approvedAt, items: selected },
    evaluation: { id: evaluation.id, chiefComplaint: evaluation.chiefComplaint, patientGoal: evaluation.patientGoal, allergies: evaluation.allergies, contraindications: evaluation.contraindications, photos: evaluationPhotos },
    procedures: procedures.map((procedure) => ({ ...procedure, suggestedMaterials: procedure.technicalSheet.map((item) => ({ productId: item.productId, quantity: item.quantity })) })),
    materials: products.map((product) => ({ id: product.id, name: product.name, kind: product.kind, unit: product.unit, lots: product.lots.map((lot) => ({ id: lot.id, code: lot.code, expiresOn: dateOnly(lot.expiresOn), balance: balances.get(lot.id) ?? 0 })).filter((lot) => lot.balance > 0) })),
    sessions: sessions.map((session) => ({ ...session, materials: parseJson<unknown[]>(session.materials, []), photos: resolvePhotos(session.photos, evaluation.photos), auditLog: parseJson<unknown[]>(session.auditLog, []) })),
    scheduledProcedure: scheduled ? { ...scheduled, date: appointmentDay(scheduled.date) } : null,
    consent: consentSummary(await consentCounts(user.clinicId, patientId, journeyId)),
    clinicName: user.clinic?.name ?? "",
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
  const denied = denyUnless(user, "clinical:write");
  if (denied) return denied;
  const patientId = (await params).id;
  const body = await request.json().catch(() => null) as { journeyId?: string; quoteId?: string; procedureId?: string; performedAt?: string } | null;
  if (!body?.journeyId || !body.quoteId) return NextResponse.json({ message: "Informe o tratamento e o orçamento." }, { status: 400 });
  const [patient, journey, quote] = await Promise.all([
    prisma.patient.findFirst({ where: { id: patientId, clinicId: user.clinicId }, select: { id: true } }),
    prisma.patientJourney.findFirst({ where: { id: body.journeyId, patientId, clinicId: user.clinicId, archivedAt: null }, select: { id: true, professional: true } }),
    prisma.quote.findFirst({ where: { id: body.quoteId, patientId, journeyId: body.journeyId, clinicId: user.clinicId }, select: { id: true, status: true, evaluationId: true, items: true, details: true } }),
  ]);
  if (!patient || !journey || !quote || !quote.evaluationId) return NextResponse.json({ message: "Paciente, jornada ou orçamento não encontrado." }, { status: 404 });
  if (!["Aprovado", "Pago"].includes(quote.status)) return NextResponse.json({ message: "O orçamento precisa estar aprovado para criar uma sessão." }, { status: 409 });
  const evaluation = await prisma.evaluation.findFirst({ where: { id: quote.evaluationId!, patientId, journeyId: body.journeyId, clinicId: user.clinicId }, select: { id: true } });
  if (!evaluation) return NextResponse.json({ message: "A avaliação vinculada ao orçamento não está disponível nesta jornada." }, { status: 404 });
  // Uma única sessão reúne todos os procedimentos do orçamento aprovado.
  const stored = parseJson<{ items?: Array<{ procedureId: string; name: string; quantity?: number }> }>(quote.details, {}).items ?? [];
  const catalog = await prisma.procedure.findMany({ where: { clinicId: user.clinicId, ...(stored.length ? { id: { in: stored.map((item) => item.procedureId).filter(Boolean) } } : {}) }, select: { id: true, name: true, durationMinutes: true } });
  const lines: Array<{ procedureId: string; name: string; quantity?: number }> = stored.length ? stored : restoreLegacyQuoteItems(quote.items, catalog);
  if (!lines.length) return NextResponse.json({ message: "O orçamento aprovado não possui procedimentos para executar." }, { status: 400 });
  // Compatibilidade: se um procedureId for informado, ele ainda precisa pertencer ao orçamento.
  if (body.procedureId && !lines.some((item) => item.procedureId === body.procedureId)) return NextResponse.json({ message: "O procedimento não pertence ao orçamento aprovado." }, { status: 400 });
  const date = body.performedAt ? new Date(body.performedAt) : new Date();
  if (!Number.isFinite(date.getTime())) return NextResponse.json({ message: "Data da sessão inválida." }, { status: 400 });
  const assignedProfessional = journey.professional.trim() || user.name;
  const sessionName = combinedProcedureName(lines.map((item) => item.name));
  const estimated = lines.reduce((total, item) => total + (catalog.find((procedure) => procedure.id === item.procedureId)?.durationMinutes ?? 0) * Math.max(1, item.quantity ?? 1), 0);
  const { session: persisted, reused } = await prisma.$transaction(async (tx) => {
    // Serializa criações concorrentes do mesmo orçamento (clique duplo/corrida) e reaproveita o rascunho aberto.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${quote.id}))`;
    const open = await tx.patientProcedureSession.findFirst({ where: { clinicId: user.clinicId, patientId, journeyId: journey.id, quoteId: quote.id, status: { in: ["Rascunho", "Em execução"] } }, orderBy: { createdAt: "desc" } });
    if (open) {
      // Rascunho vazio ainda não semeado (inclusive legado) é semeado após o commit (ver seedDraftMaterials).
      if (!shouldRefreshDraftName(open, sessionName)) return { session: open, reused: true };
      // Rascunho legado (por item): alinha ao combinado do orçamento. Em execução/concluída nunca é alterada.
      const refreshed = await tx.patientProcedureSession.updateMany({ where: { id: open.id, clinicId: user.clinicId, status: "Rascunho" }, data: { procedureName: sessionName, ...(estimated > 0 ? { estimatedMinutes: Math.min(estimated, 1440) } : {}) } });
      const current = refreshed.count ? await tx.patientProcedureSession.findFirst({ where: { id: open.id, clinicId: user.clinicId } }) : open;
      return { session: current ?? open, reused: true };
    }
    const parent = await tx.patientProcedure.upsert({
      where: { quoteId: quote.id },
      update: { name: quote.items, journeyId: journey.id },
      create: { clinicId: user.clinicId, patientId, journeyId: journey.id, quoteId: quote.id, name: quote.items, professional: assignedProfessional, performedAt: date },
      select: { id: true },
    });
    const created = await tx.patientProcedureSession.create({ data: {
      clinicId: user.clinicId, patientId, journeyId: journey.id, evaluationId: quote.evaluationId!,
      procedureId: parent.id, quoteId: quote.id, procedureName: sessionName, professional: assignedProfessional,
      performedAt: date, status: "Rascunho", createdBy: user.name, updatedBy: user.name, ...(estimated > 0 ? { estimatedMinutes: Math.min(estimated, 1440) } : {}),
      auditLog: JSON.stringify([{ at: new Date().toISOString(), actor: user.name, action: "Sessão criada", fields: ["procedimento", "profissional", "data"] }]),
    } });
    return { session: created, reused: false };
  });
  // Fora da transação: falha ao semear nunca desfaz nem impede a criação da sessão.
  const session = await seedDraftMaterials({ clinicId: user.clinicId, session: persisted, lines });
  // Em reuso o cliente recarrega a sessão completa (fotos resolvidas) pelo GET.
  return NextResponse.json({ session: { ...session, materials: parseJson<unknown[]>(session.materials, []), photos: [], auditLog: parseJson<unknown[]>(session.auditLog, []) }, reused }, { status: reused ? 200 : 201 });
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function restoreLegacyQuoteItems(value: string, procedures: Array<{ id: string; name: string }>) {
  const items = value.split(",").map((item) => item.trim());
  return procedures.flatMap((procedure) => {
    const match = items.find((item) => item === procedure.name || item.startsWith(`${procedure.name} (`));
    const quantity = Number(match?.match(/\((\d+)x\)/i)?.[1] ?? (match === procedure.name ? 1 : 0));
    return quantity ? [{ procedureId: procedure.id, name: procedure.name, quantity }] : [];
  });
}

function resolvePhotos(value: string, evaluationPhotos: Array<{ id: string; name: string; imageUrl: string; width: number; height: number; category: string }>) {
  const photos = parseJson<SessionPhotoInput[]>(value, []);
  return photos.flatMap((photo) => {
    if (photo.sourceEvaluationPhotoId) {
      const original = evaluationPhotos.find((item) => item.id === photo.sourceEvaluationPhotoId);
      return original ? [{ ...photo, imageUrl: original.imageUrl, name: original.name, category: original.category, width: original.width, height: original.height }] : [];
    }
    return photo.imageUrl ? [photo] : [];
  });
}

export function validateSessionPayload(body: unknown) {
  const value = body as Record<string, unknown> | null;
  if (!value || !statuses.has(String(value.status ?? "Rascunho"))) return "Status de sessão inválido.";
  for (const field of ["technique", "treatedAreas", "anesthesia", "complications", "observations"] as const) {
    if (value[field] !== undefined && (typeof value[field] !== "string" || value[field].length > 5000)) return "Revise os campos clínicos da sessão.";
  }
  if (value.professional !== undefined && (typeof value.professional !== "string" || !value.professional.trim() || value.professional.length > 160)) return "Informe o profissional responsável.";
  for (const field of ["estimatedMinutes", "durationMinutes"] as const) if (value[field] !== undefined && value[field] !== null && (!Number.isInteger(value[field]) || Number(value[field]) < 0 || Number(value[field]) > 1440)) return "A duração deve ser um número de minutos válido.";
  if (value.performedAt !== undefined && (typeof value.performedAt !== "string" || !Number.isFinite(new Date(value.performedAt).getTime()))) return "Data da sessão inválida.";
  for (const field of ["startedAt", "endedAt"] as const) if (value[field] !== undefined && value[field] !== null && (typeof value[field] !== "string" || !Number.isFinite(new Date(value[field]).getTime()))) return "Horário da sessão inválido.";
  if (value.materials !== undefined && (!Array.isArray(value.materials) || value.materials.length > 40 || value.materials.some((item) => !isMaterial(item)))) return "Revise os produtos e quantidades informados.";
  if (value.photos !== undefined && (!Array.isArray(value.photos) || value.photos.length > 20 || value.photos.some((photo) => !isPhoto(photo)))) return "Revise as fotografias. São aceitas até 20 imagens válidas por sessão.";
  return null;
}

function isMaterial(value: unknown): value is MaterialInput {
  const item = value as MaterialInput | null;
  return Boolean(item && typeof item.productId === "string" && item.productId && Number.isFinite(item.quantity) && Number(item.quantity) > 0 && Number(item.quantity) <= 10000 && (!item.allocations || (Array.isArray(item.allocations) && item.allocations.length <= 20 && item.allocations.every((allocation) => typeof allocation.lotId === "string" && allocation.lotId && Number.isFinite(allocation.quantity) && Number(allocation.quantity) > 0))));
}

function isPhoto(value: unknown): value is SessionPhotoInput {
  const photo = value as SessionPhotoInput | null;
  if (!photo || typeof photo.id !== "string" || !photo.id || !phases.has(String(photo.phase))) return false;
  if (photo.sourceEvaluationPhotoId) return photo.phase === "Antes" && !photo.imageUrl;
  return typeof photo.imageUrl === "string" && /^data:image\/(jpeg|png|webp);base64,/i.test(photo.imageUrl) && photo.imageUrl.length <= 8_500_000 && typeof photo.name === "string" && photo.name.length <= 180 && Number.isInteger(photo.width) && Number(photo.width) > 0 && Number(photo.width) <= 8000 && Number.isInteger(photo.height) && Number(photo.height) > 0 && Number(photo.height) <= 8000 && Number(photo.width) * Number(photo.height) <= 25_000_000;
}
