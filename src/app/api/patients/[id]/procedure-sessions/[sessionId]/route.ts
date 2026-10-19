import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyUnless } from "@/lib/api-guards";
import { dateOnly } from "@/lib/clinic-time";
import { registerAttendanceOutputs, AttendanceMaterialsError } from "@/lib/attendance-materials";
import { approvedProcedureNames } from "@/lib/procedure-session-rules";
import { prisma } from "@/lib/prisma";
import { lockLots, lotBalances } from "@/lib/stock";
import { validateQuantity } from "@/lib/stock-rules";
import { validateSessionPayload } from "../route";

type Material = { productId: string; quantity: number; allocations?: Array<{ lotId: string; quantity: number }> };
type Photo = { id: string; phase: string; sourceEvaluationPhotoId?: string; imageUrl?: string; name?: string; category?: string; width?: number; height?: number };

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user.role, "clinical:write");
  if (denied) return denied;
  const { id: patientId, sessionId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const invalid = validateSessionPayload(body);
  if (invalid) return NextResponse.json({ message: invalid }, { status: 400 });
  const current = await prisma.patientProcedureSession.findFirst({ where: { id: sessionId, patientId, clinicId: user.clinicId }, select: { id: true, journeyId: true, quoteId: true, evaluationId: true, procedureId: true, procedureName: true, professional: true, performedAt: true, startedAt: true, status: true, updatedAt: true, auditLog: true, journey: { select: { status: true } } } });
  if (!current) return NextResponse.json({ message: "Sessão não encontrada." }, { status: 404 });
  if (current.status === "Concluída") return NextResponse.json({ message: "Sessão concluída não pode ser alterada. Crie uma nova sessão para continuar o tratamento." }, { status: 409 });

  const procedureName = typeof body?.procedureName === "string" ? body.procedureName.trim() : undefined;
  if (procedureName !== undefined) {
    const quote = await prisma.quote.findFirst({ where: { id: current.quoteId, patientId, clinicId: user.clinicId }, select: { details: true } });
    const approvedItems = approvedProcedureNames(quote?.details ?? "");
    if (!procedureName || procedureName.length > 180 || !approvedItems.includes(procedureName)) return NextResponse.json({ message: "O procedimento precisa corresponder a um item do orçamento aprovado." }, { status: 400 });
  }

  const photos = Array.isArray(body?.photos) ? body.photos as Photo[] : undefined;
  if (photos) {
    const sourceIds = photos.flatMap((photo) => photo.sourceEvaluationPhotoId ? [photo.sourceEvaluationPhotoId] : []);
    const validSources = sourceIds.length ? await prisma.evaluationPhoto.findMany({ where: { id: { in: sourceIds }, evaluationId: current.evaluationId }, select: { id: true } }) : [];
    if (validSources.length !== new Set(sourceIds).size) return NextResponse.json({ message: "Uma das fotos iniciais não pertence à avaliação desta jornada." }, { status: 400 });
  }
  const nextStatus = String(body?.status ?? current.status);
  const finalizing = nextStatus === "Concluída";
  if (nextStatus === "Rascunho" && current.status !== "Rascunho") return NextResponse.json({ message: "Não é possível retornar uma sessão iniciada para rascunho." }, { status: 409 });
  if (finalizing && current.status !== "Em execução") return NextResponse.json({ message: "Inicie o procedimento antes de finalizar a sessão." }, { status: 409 });
  const technique = typeof body?.technique === "string" ? body.technique.trim() : undefined;
  const treatedAreas = typeof body?.treatedAreas === "string" ? body.treatedAreas.trim() : undefined;
  const professional = typeof body?.professional === "string" ? body.professional.trim() : current.professional;
  const nextPhotos = photos ?? undefined;
  const materials = Array.isArray(body?.materials) ? body.materials as Material[] : undefined;
  if (nextStatus === "Em execução" && current.status === "Rascunho" && !nextPhotos?.some((photo) => photo.phase === "Antes")) return NextResponse.json({ message: "Registre uma foto de antes antes de iniciar o procedimento." }, { status: 400 });
  if (finalizing && (!technique || !treatedAreas || !professional)) return NextResponse.json({ message: "Informe a técnica, a região tratada e o profissional antes de finalizar." }, { status: 400 });
  if (finalizing && (!nextPhotos || !nextPhotos.some((photo) => photo.phase === "Antes") || !nextPhotos.some((photo) => photo.phase === "Imediatamente após"))) return NextResponse.json({ message: "Registre ao menos uma foto antes e uma imediatamente após a sessão." }, { status: 400 });
  if (materials && new Set(materials.map((item) => item.productId)).size !== materials.length) return NextResponse.json({ message: "Um produto aparece mais de uma vez. Ajuste a lista de materiais." }, { status: 400 });

  const performedAt = body?.performedAt ? new Date(String(body.performedAt)) : current.performedAt;
  const startedAt = body?.startedAt ? new Date(String(body.startedAt)) : current.startedAt;
  const endedAt = finalizing ? new Date() : body?.endedAt ? new Date(String(body.endedAt)) : null;
  const durationMinutes = body?.durationMinutes !== undefined ? Number(body.durationMinutes) : startedAt && endedAt ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000)) : null;
  if (startedAt && endedAt && endedAt < startedAt) return NextResponse.json({ message: "O horário de término deve ser posterior ao início." }, { status: 400 });

  const productRows = materials?.length ? await prisma.product.findMany({ where: { id: { in: materials.map((item) => item.productId) }, clinicId: user.clinicId }, select: { id: true, name: true, unit: true, lots: { select: { id: true, code: true, expiresOn: true } } } }) : [];
  if (materials && productRows.length !== materials.length) return NextResponse.json({ message: "Um produto não pertence ao estoque desta clínica." }, { status: 400 });
  for (const item of materials ?? []) {
    const product = productRows.find((row) => row.id === item.productId)!;
    const quantityError = validateQuantity(item.quantity, product.unit);
    if (quantityError) return NextResponse.json({ message: `${product.name}: ${quantityError}` }, { status: 400 });
    if (item.allocations?.some((allocation) => !product.lots.some((lot) => lot.id === allocation.lotId))) return NextResponse.json({ message: `${product.name}: lote inválido.` }, { status: 400 });
  }
  const photoSnapshot = nextPhotos ? JSON.stringify(nextPhotos) : undefined;
  const materialSnapshot = materials === undefined ? undefined : materials.length ? await createMaterialSnapshot(user.clinicId, materials, productRows) : "[]";
  const auditFields = Object.keys(body ?? {}).filter((field) => ["procedureName", "technique", "treatedAreas", "professional", "performedAt", "startedAt", "estimatedMinutes", "durationMinutes", "anesthesia", "complications", "observations", "materials", "photos"].includes(field));
  const auditLog = JSON.stringify([...parseJson<Array<{ at: string; actor: string; action: string; fields: string[] }>>(current.auditLog, []), { at: new Date().toISOString(), actor: user.name, action: finalizing ? "Sessão finalizada" : nextStatus === "Em execução" && current.status === "Rascunho" ? "Procedimento iniciado" : "Rascunho atualizado", fields: auditFields }].slice(-100));
  const updateData = {
    ...(procedureName !== undefined ? { procedureName } : {}),
    ...(technique !== undefined ? { technique } : {}),
    ...(treatedAreas !== undefined ? { treatedAreas } : {}),
    ...(body?.professional !== undefined ? { professional } : {}),
    ...(body?.performedAt !== undefined ? { performedAt } : {}),
    ...(body?.startedAt !== undefined ? { startedAt } : {}),
    ...(body?.estimatedMinutes !== undefined ? { estimatedMinutes: body.estimatedMinutes === null ? null : Number(body.estimatedMinutes) } : {}),
    ...(body?.durationMinutes !== undefined || finalizing ? { durationMinutes } : {}),
    ...(body?.anesthesia !== undefined ? { anesthesia: String(body.anesthesia).trim() } : {}),
    ...(body?.complications !== undefined ? { complications: String(body.complications).trim() } : {}),
    ...(body?.observations !== undefined ? { observations: String(body.observations).trim() } : {}),
    ...(materialSnapshot !== undefined ? { materials: materialSnapshot } : {}),
    ...(photoSnapshot !== undefined ? { photos: photoSnapshot } : {}),
    auditLog,
    status: nextStatus,
    updatedBy: user.name,
    ...(finalizing ? { endedAt, completedAt: endedAt, completedBy: user.name } : {}),
  };

  try {
    const updated = await prisma.$transaction(async (tx) => {
      if (finalizing) {
        const claimed = await tx.patientProcedureSession.updateMany({ where: { id: sessionId, patientId, clinicId: user.clinicId, status: "Em execução", updatedAt: current.updatedAt }, data: updateData });
        if (!claimed.count) throw new AttendanceMaterialsError("Esta sessão já foi finalizada em outra ação.");
        const sessionDate = performedAt;
        const attendance = { id: current.id, procedure: current.procedureName, date: sessionDate, status: "Atendido", materialsCheck: "done", patientId, patient: { name: "" }, kind: "procedure" as const };
        const pending = await registerAttendanceOutputs(tx, { clinicId: user.clinicId, userId: user.id, userName: user.name, attendance, items: (materials ?? []).map(({ productId, quantity, allocations }) => ({ productId, quantity, allocations })), procedureSessionId: sessionId });
        await tx.patientProcedure.update({ where: { id: current.procedureId }, data: { professional, performedAt, notes: String(body?.observations ?? "").trim() } });
        await tx.patientJourney.update({ where: { id: current.journeyId }, data: { status: current.journey.status } });
        const completed = await tx.patientProcedureSession.findUnique({ where: { id: sessionId } });
        return { session: completed, pending };
      }
      const saved = await tx.patientProcedureSession.updateMany({ where: { id: sessionId, patientId, clinicId: user.clinicId, status: { in: ["Rascunho", "Em execução"] }, updatedAt: current.updatedAt }, data: updateData });
      if (!saved.count) throw new AttendanceMaterialsError("Esta sessão não está mais disponível para edição.");
      return { session: await tx.patientProcedureSession.findUnique({ where: { id: sessionId } }), pending: [] };
    });
    const savedPhotos = updated.session ? parseJson<Photo[]>(updated.session.photos, []) : [];
    const sourcePhotoIds = savedPhotos.flatMap((photo) => photo.sourceEvaluationPhotoId ? [photo.sourceEvaluationPhotoId] : []);
    const sourcePhotos = sourcePhotoIds.length ? await prisma.evaluationPhoto.findMany({ where: { id: { in: sourcePhotoIds }, evaluationId: current.evaluationId }, select: { id: true, name: true, imageUrl: true, width: true, height: true, category: true } }) : [];
    const resolvedPhotos = savedPhotos.flatMap((photo) => {
      const source = sourcePhotos.find((item) => item.id === photo.sourceEvaluationPhotoId);
      return photo.sourceEvaluationPhotoId ? source ? [{ ...photo, name: source.name, imageUrl: source.imageUrl, width: source.width, height: source.height, category: source.category }] : [] : [photo];
    });
    return NextResponse.json({ ...updated, session: updated.session ? { ...updated.session, materials: parseJson<unknown[]>(updated.session.materials, []), photos: resolvedPhotos, auditLog: parseJson<unknown[]>(updated.session.auditLog, []) } : null });
  } catch (error) {
    if (error instanceof AttendanceMaterialsError) return NextResponse.json({ message: error.message }, { status: 409 });
    throw error;
  }
}

async function createMaterialSnapshot(clinicId: string, items: Material[], products: Array<{ id: string; name: string; unit: string; lots: Array<{ id: string; code: string; expiresOn: Date }> }>) {
  const lotIds = products.flatMap((product) => product.lots.map((lot) => lot.id));
  const balances = await lotBalances(clinicId, { lotId: { in: lotIds } });
  return JSON.stringify(items.map((item) => {
    const product = products.find((row) => row.id === item.productId)!;
    return { productId: product.id, name: product.name, unit: product.unit, quantity: item.quantity, allocations: (item.allocations ?? []).map((allocation) => {
      const lot = product.lots.find((row) => row.id === allocation.lotId)!;
      return { lotId: lot.id, code: lot.code, expiresOn: dateOnly(lot.expiresOn), quantity: allocation.quantity, availableAtSave: balances.get(lot.id) ?? null };
    }) };
  }));
}

function parseJson<T>(value: string, fallback: T): T { try { return JSON.parse(value) as T; } catch { return fallback; } }
