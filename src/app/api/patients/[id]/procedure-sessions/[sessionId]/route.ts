import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyUnless } from "@/lib/api-guards";
import { appointmentInstant, clinicNow, dateOnly } from "@/lib/clinic-time";
import { registerAttendanceOutputs, AttendanceMaterialsError } from "@/lib/attendance-materials";
import { appointmentStartNow, approvedProcedureNames, combinedProcedureName, isMovableStartAppointment, PROCEDURE_APPOINTMENT_PREFIX, procedureAppointmentName, scheduledAppointmentOrder } from "@/lib/procedure-session-rules";
import { consentGate, consentRequiredCode } from "@/lib/consent-rules";
import { consentCounts } from "@/lib/clinical-files-server";
import { prisma } from "@/lib/prisma";
import { lockLots, lotBalances } from "@/lib/stock";
import { validateQuantity } from "@/lib/stock-rules";
import { parseKnownPhotoIds, unknownStoredPhotos } from "@/lib/session-after-photo-rules";
import { sessionUnchanged } from "@/lib/evaluation-photo-sync-rules";
import { validateSessionPayload } from "../route";

class ConsentRequiredError extends Error {}
type Material = { productId: string; quantity: number; allocations?: Array<{ lotId: string; quantity: number }> };
type Photo = { id: string; phase: string; sourceEvaluationPhotoId?: string; imageUrl?: string; name?: string; category?: string; width?: number; height?: number };

// Leitura leve para o workspace (fotos enviadas pelo app): `?photoIds=1` devolve só os ids (extraídos no banco, sem base64) e `?only=a,b`
// devolve apenas essas fotos com imageUrl. Escopo clínica/paciente/sessão como o PATCH; não devolve nada fora dele.
export async function GET(request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user.role, "clinical:read");
  if (denied) return denied;
  const { id: patientId, sessionId } = await params;
  const search = new URL(request.url).searchParams;
  if (search.get("photoIds") === "1") {
    // Custo: 1) select só de status/updatedAt (sem a coluna de fotos); se o cliente já tem este updatedAt (`since`), responde changed:false e para.
    // 2) só quando mudou, extrai os ids no banco (lê o JSON uma vez, sem devolver base64). Todo envio do app e todo PATCH mudam o updatedAt.
    const head = await prisma.patientProcedureSession.findFirst({ where: { id: sessionId, patientId, clinicId: user.clinicId }, select: { status: true, updatedAt: true } });
    if (!head) return NextResponse.json({ message: "Sessão não encontrada." }, { status: 404 });
    if (sessionUnchanged(search.get("since"), head.updatedAt)) return NextResponse.json({ changed: false, status: head.status, updatedAt: head.updatedAt });
    const rows = await prisma.$queryRaw<Array<{ status: string; ids: unknown }>>(Prisma.sql`SELECT s."status", COALESCE((SELECT jsonb_agg(e.value->>'id' ORDER BY e.n) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s."photos"::jsonb) = 'array' THEN s."photos"::jsonb ELSE '[]'::jsonb END) WITH ORDINALITY AS e(value, n) WHERE jsonb_typeof(e.value) = 'object' AND e.value->>'id' IS NOT NULL), '[]'::jsonb) AS ids FROM "PatientProcedureSession" s WHERE s."id" = ${sessionId} AND s."patientId" = ${patientId} AND s."clinicId" = ${user.clinicId}`).catch(() => null);
    if (rows) {
      if (!rows[0]) return NextResponse.json({ message: "Sessão não encontrada." }, { status: 404 });
      return NextResponse.json({ changed: true, status: rows[0].status, updatedAt: head.updatedAt, photoIds: Array.isArray(rows[0].ids) ? rows[0].ids.filter((id): id is string => typeof id === "string") : [] });
    }
  }
  const only = (search.get("only") ?? "").split(",").filter(Boolean).slice(0, 20);
  if (search.get("photoIds") !== "1" && !only.length) return NextResponse.json({ message: "Consulta inválida." }, { status: 400 });
  const session = await prisma.patientProcedureSession.findFirst({ where: { id: sessionId, patientId, clinicId: user.clinicId }, select: { status: true, updatedAt: true, photos: true } });
  if (!session) return NextResponse.json({ message: "Sessão não encontrada." }, { status: 404 });
  const list = parseJson<Photo[]>(session.photos, []).filter((photo) => photo && typeof photo.id === "string");
  // Fallback do modo ids quando o JSON gravado não permitiu a extração no banco.
  if (search.get("photoIds") === "1") return NextResponse.json({ changed: true, status: session.status, updatedAt: session.updatedAt, photoIds: list.map((photo) => photo.id) });
  // Referências a fotos da avaliação não entram: o cliente as monta pela própria avaliação.
  return NextResponse.json({ status: session.status, photos: list.filter((photo) => only.includes(photo.id) && !photo.sourceEvaluationPhotoId).map((photo) => ({ id: photo.id, name: photo.name ?? "Foto", phase: photo.phase, category: photo.category ?? "Outra", imageUrl: photo.imageUrl ?? "", width: photo.width ?? 0, height: photo.height ?? 0 })) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user.role, "clinical:write");
  if (denied) return denied;
  const { id: patientId, sessionId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const invalid = validateSessionPayload(body);
  if (invalid) return NextResponse.json({ message: invalid }, { status: 400 });
  const current = await prisma.patientProcedureSession.findFirst({ where: { id: sessionId, patientId, clinicId: user.clinicId }, select: { id: true, journeyId: true, quoteId: true, evaluationId: true, procedureId: true, procedureName: true, professional: true, performedAt: true, startedAt: true, status: true, updatedAt: true, auditLog: true, photos: true, materialsSeededAt: true, journey: { select: { status: true } } } });
  if (!current) return NextResponse.json({ message: "Sessão não encontrada." }, { status: 404 });
  if (current.status === "Concluída") return NextResponse.json({ message: "Sessão concluída não pode ser alterada. Crie uma nova sessão para continuar o tratamento." }, { status: 409 });

  const procedureName = typeof body?.procedureName === "string" ? body.procedureName.trim() : undefined;
  if (procedureName !== undefined) {
    const quote = await prisma.quote.findFirst({ where: { id: current.quoteId, patientId, clinicId: user.clinicId }, select: { details: true } });
    const approvedItems = approvedProcedureNames(quote?.details ?? "");
    // Aceita o nome combinado da sessão única, um item aprovado (sessões antigas por item) ou o nome já gravado.
    const validName = procedureName === current.procedureName || approvedItems.includes(procedureName) || procedureName === combinedProcedureName(approvedItems);
    if (!procedureName || procedureName.length > 180 || !validName) return NextResponse.json({ message: "O procedimento precisa corresponder a um item do orçamento aprovado." }, { status: 400 });
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
  // Início do procedimento (só esta transição): exige termo de consentimento assinado na jornada. Sessões já iniciadas não são reavaliadas.
  const startingSession = nextStatus === "Em execução" && current.status === "Rascunho";
  if (startingSession) {
    const gate = consentGate(await consentCounts(user.clinicId, patientId, current.journeyId));
    if (!gate.ok) return NextResponse.json({ message: gate.reason, code: consentRequiredCode }, { status: 409 });
  }
  const technique = typeof body?.technique === "string" ? body.technique.trim() : undefined;
  const treatedAreas = typeof body?.treatedAreas === "string" ? body.treatedAreas.trim() : undefined;
  const professional = typeof body?.professional === "string" ? body.professional.trim() : current.professional;
  // Foto gravada que o cliente não conhecia (ex.: enviada pelo app depois que ele abriu a sessão) e não veio na lista é mantida; sem knownPhotoIds, a lista enviada manda.
  const known = parseKnownPhotoIds(body?.knownPhotoIds);
  if (!known.ok) return NextResponse.json({ message: known.message }, { status: 400 });
  const knownPhotoIds = known.ids;
  const preservedPhotos = photos ? unknownStoredPhotos(parseJson<Photo[]>(current.photos, []), photos.map((photo) => photo.id), knownPhotoIds) : [];
  const nextPhotos = photos ? [...photos, ...preservedPhotos] : undefined;
  if (nextPhotos && nextPhotos.length > 20) return NextResponse.json({ message: "A sessão recebeu novas fotos do aplicativo e passaria de 20. Recarregue a sessão e revise as fotos." }, { status: 409 });
  const materials = Array.isArray(body?.materials) ? body.materials as Material[] : undefined;
  if (nextStatus === "Em execução" && current.status === "Rascunho" && !nextPhotos?.some((photo) => photo.phase === "Antes")) return NextResponse.json({ message: "Registre uma foto de antes antes de iniciar o procedimento." }, { status: 400 });
  const startingWithBody = nextStatus === "Em execução" && current.status === "Rascunho";
  if (startingWithBody && (!technique || !treatedAreas || !professional)) return NextResponse.json({ message: "Informe a técnica, a região tratada e o profissional antes de iniciar o procedimento." }, { status: 400 });
  // Fotos de depois só entram com o procedimento iniciado; as que já estavam gravadas no rascunho (dado anterior à regra) são preservadas.
  const storedAfterIds = new Set(parseJson<Photo[]>(current.photos, []).filter((photo) => photo.phase === "Imediatamente após").map((photo) => photo.id));
  if (nextStatus === "Rascunho" && nextPhotos?.some((photo) => photo.phase === "Imediatamente após" && !storedAfterIds.has(photo.id))) return NextResponse.json({ message: "As fotos de depois só podem ser adicionadas depois de iniciar o procedimento." }, { status: 400 });
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
    // O profissional assumiu a lista do rascunho: a ficha técnica não é mais aplicada (nem se ele esvaziar tudo).
    ...(materials !== undefined && current.status === "Rascunho" && !current.materialsSeededAt ? { materialsSeededAt: new Date() } : {}),
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
        return { session: completed, pending, appointment: null as { id: string; date: string; time: string } | null };
      }
      // Relê o consentimento dentro da transação, logo antes de gravar o início (reduz a janela contra arquivamento/rebaixamento concorrente).
      if (startingSession) {
        const lateGate = consentGate(await consentCounts(user.clinicId, patientId, current.journeyId, tx));
        if (!lateGate.ok) throw new ConsentRequiredError(lateGate.reason);
      }
      const saved = await tx.patientProcedureSession.updateMany({ where: { id: sessionId, patientId, clinicId: user.clinicId, status: { in: ["Rascunho", "Em execução"] }, updatedAt: current.updatedAt }, data: updateData });
      if (!saved.count) throw new AttendanceMaterialsError("Esta sessão não está mais disponível para edição.");
      let appointment: { id: string; date: string; time: string } | null = null;
      if (startingSession) {
        // Início efetivo com o procedimento agendado: o horário do agendamento passa para agora (dia e HH:mm da clínica).
        // Decisão do profissional iniciando de fato, por isso não valida expediente nem horário livre. Só um agendamento
        // "Procedimento - …" em Agendado desta jornada é movido; retornos e demais agendamentos não são tocados.
        // O cliente envia o id do agendamento que o modal mostrou; sem id válido, só vale o agendamento cujo nome casa com o da sessão (nunca "o mais antigo").
        const scope = { clinicId: user.clinicId, patientId, journeyId: current.journeyId, status: "Agendado", procedure: { startsWith: PROCEDURE_APPOINTMENT_PREFIX } };
        const select = { id: true, procedure: true, status: true };
        const chosenId = typeof body?.scheduledAppointmentId === "string" ? body.scheduledAppointmentId : "";
        const byId = chosenId ? await tx.appointment.findFirst({ where: { ...scope, id: chosenId }, select }) : null;
        const scheduled = byId ?? await tx.appointment.findFirst({ where: { ...scope, procedure: procedureAppointmentName(current.procedureName) }, orderBy: scheduledAppointmentOrder(), select });
        if (scheduled && isMovableStartAppointment(scheduled)) {
          const startNow = appointmentStartNow(clinicNow());
          const moved = await tx.appointment.updateMany({ where: { id: scheduled.id, clinicId: user.clinicId, patientId, journeyId: current.journeyId, status: "Agendado" }, data: { date: appointmentInstant(startNow.day), time: startNow.time } });
          if (moved.count) {
            appointment = { id: scheduled.id, date: startNow.day, time: startNow.time };
            const log = [...parseJson<Array<{ at: string; actor: string; action: string; fields: string[] }>>(auditLog, []), { at: new Date().toISOString(), actor: user.name, action: `Agendamento alterado para o início (${startNow.day.split("-").reverse().join("/")} às ${startNow.time})`, fields: [] }].slice(-100);
            await tx.patientProcedureSession.updateMany({ where: { id: sessionId, patientId, clinicId: user.clinicId }, data: { auditLog: JSON.stringify(log) } });
          }
        }
        return { session: await tx.patientProcedureSession.findUnique({ where: { id: sessionId } }), pending: [], appointment };
      }
      return { session: await tx.patientProcedureSession.findUnique({ where: { id: sessionId } }), pending: [], appointment };
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
    if (error instanceof ConsentRequiredError) return NextResponse.json({ message: error.message || consentGate({ signed: 0, pending: 0 }).reason, code: consentRequiredCode }, { status: 409 });
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
