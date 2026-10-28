import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyUnless } from "@/lib/api-guards";
import { appointmentDay, clinicToday } from "@/lib/clinic-time";
import { prisma } from "@/lib/prisma";
import { parseJson } from "@/lib/procedure-session-rules";

type FollowUpPhotoInput = { id: string; name: string; category: string; imageUrl: string; width: number; height: number; phase?: "Antes" | "Depois" | "Evolução" };

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
  const denied = denyUnless(user, "clinical:write");
  if (denied) return denied;
  const { id: patientId, sessionId } = await params;
  const body = await request.json().catch(() => null) as { action?: string; appointmentId?: string } | null;
  if (body?.action !== "start-return" || !body.appointmentId) return NextResponse.json({ message: "Retorno inválido." }, { status: 400 });
  const session = await prisma.patientProcedureSession.findFirst({ where: { id: sessionId, patientId, clinicId: user.clinicId, status: "Concluída" }, select: { journeyId: true, procedureName: true } });
  if (!session) return NextResponse.json({ message: "Sessão concluída não encontrada." }, { status: 404 });
  const appointment = await prisma.appointment.findFirst({ where: { id: body.appointmentId, patientId, clinicId: user.clinicId, journeyId: session.journeyId, procedure: `Retorno - ${session.procedureName}` }, select: { id: true, date: true, status: true } });
  if (!appointment) return NextResponse.json({ message: "Retorno não encontrado para este procedimento." }, { status: 404 });
  if (appointment.status !== "Agendado") return NextResponse.json({ message: "Este retorno não está aguardando início." }, { status: 409 });
  if (appointmentDay(appointment.date) !== clinicToday()) return NextResponse.json({ message: "O atendimento só pode começar na data agendada para o retorno." }, { status: 409 });
  if (await prisma.patientProcedureFollowUp.findUnique({ where: { appointmentId: appointment.id }, select: { id: true } })) return NextResponse.json({ message: "Este retorno já possui registro clínico." }, { status: 409 });
  const updated = await prisma.appointment.updateMany({ where: { id: appointment.id, clinicId: user.clinicId, status: "Agendado" }, data: { status: "Em atendimento" } });
  if (!updated.count) return NextResponse.json({ message: "O status do retorno mudou. Atualize a página." }, { status: 409 });
  return NextResponse.json({ appointment: await prisma.appointment.findFirst({ where: { id: appointment.id, clinicId: user.clinicId }, select: { id: true, date: true, time: true, procedure: true, professional: true, status: true, notes: true } }) });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
  const denied = denyUnless(user, "clinical:read");
  if (denied) return denied;
  const { id: patientId, sessionId } = await params;
  const requestedJourneyId = new URL(_request.url).searchParams.get("journeyId");
  const session = await prisma.patientProcedureSession.findFirst({
    where: { id: sessionId, patientId, clinicId: user.clinicId },
    select: {
      id: true, journeyId: true, procedureName: true, professional: true, performedAt: true, status: true,
      technique: true, treatedAreas: true, anesthesia: true, complications: true, observations: true, startedAt: true, endedAt: true,
      journey: { select: { name: true, status: true, appointments: { where: { clinicId: user.clinicId }, orderBy: [{ date: "asc" }, { time: "asc" }], select: { id: true, date: true, time: true, procedure: true, professional: true, status: true, notes: true } } } },
    },
  });
  if (!session) return NextResponse.json({ message: "Sessão não encontrada." }, { status: 404 });
  if (session.status !== "Concluída") return NextResponse.json({ message: "O acompanhamento fica disponível após a conclusão da sessão." }, { status: 409 });
  if (requestedJourneyId && requestedJourneyId !== session.journeyId) return NextResponse.json({ message: "A sessão não pertence a este tratamento." }, { status: 404 });
  const draft = await prisma.patientProcedureFollowUpDraft.findUnique({ where: { sessionId }, select: { complaints: true, guidanceText: true, guidanceConfirmed: true, observations: true, complications: true, photos: true, removedPhotoIds: true, appointmentId: true, updatedAt: true } });
  const sessions = await prisma.patientProcedureSession.findMany({
    where: { patientId, clinicId: user.clinicId, journeyId: session.journeyId, status: "Concluída" },
    orderBy: [{ performedAt: "asc" }, { createdAt: "asc" }],
    select: { id: true, procedureName: true, professional: true, performedAt: true, photos: true, evaluation: { select: { photos: { select: { id: true, name: true, imageUrl: true, width: true, height: true, category: true, createdAt: true } } } }, followUps: { orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }], include: { appointment: { select: { id: true, date: true, time: true, procedure: true, professional: true, status: true, notes: true } } } } },
  });
  const photos: Array<Record<string, unknown> & { id: string; category: string; phase: string }> = [];
  const allFollowUps = sessions.flatMap((historySession) => historySession.followUps);
  for (const historySession of sessions) {
    const storedSessionPhotos = parseJson<Array<FollowUpPhotoInput & { phase: string; sourceEvaluationPhotoId?: string }>>(historySession.photos, []);
    const selectedSourceIds = new Set(storedSessionPhotos.flatMap((photo) => photo.sourceEvaluationPhotoId ? [photo.sourceEvaluationPhotoId] : []));
    for (const photo of historySession.evaluation.photos.filter((item) => !selectedSourceIds.has(item.id))) {
      photos.push({ id: photo.id, name: photo.name, category: photo.category, phase: "Antes", imageUrl: photo.imageUrl, width: photo.width, height: photo.height, capturedAt: photo.createdAt, source: "Avaliação", sessionId: historySession.id });
    }
    for (const photo of storedSessionPhotos) {
      const source = photo.sourceEvaluationPhotoId ? historySession.evaluation.photos.find((item) => item.id === photo.sourceEvaluationPhotoId) : null;
      const imageUrl = source?.imageUrl ?? photo.imageUrl;
      if (!imageUrl) continue;
      photos.push({ id: photo.id, name: source?.name ?? photo.name, category: source?.category ?? photo.category, phase: photo.phase, imageUrl, width: source?.width ?? photo.width, height: source?.height ?? photo.height, capturedAt: source?.createdAt ?? historySession.performedAt, source: photo.phase === "Antes" ? "Avaliação" : "Sessão", sessionId: historySession.id });
    }
    for (const record of historySession.followUps) {
      for (const photo of parseJson<FollowUpPhotoInput[]>(record.photos, [])) photos.push({ ...photo, phase: photo.phase === "Antes" || photo.phase === "Depois" ? photo.phase : "Evolução", capturedAt: record.occurredAt, source: "Retorno", sessionId: historySession.id });
    }
  }
  const removedPhotoIds = new Set([
    ...sessions.flatMap((historySession) => historySession.followUps.flatMap((record) => parseJson<string[]>(record.removedPhotoIds, []))),
    ...parseJson<string[]>(draft?.removedPhotoIds ?? "[]", []),
  ]);
  const visiblePhotos = photos.filter((photo) => !removedPhotoIds.has(photo.id));
  return NextResponse.json({
    session: { id: session.id, journeyId: session.journeyId, procedureName: session.procedureName, professional: session.professional, performedAt: session.performedAt, status: session.status, technique: session.technique, treatedAreas: session.treatedAreas, anesthesia: session.anesthesia, complications: session.complications, observations: session.observations, startedAt: session.startedAt, endedAt: session.endedAt },
    journey: session.journey,
    photos: visiblePhotos,
    sessions: sessions.map(({ id, procedureName, professional, performedAt }) => ({ id, procedureName, professional, performedAt })),
    followUps: allFollowUps.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()).map(({ photos: storedPhotos, removedPhotoIds: storedRemovedPhotoIds, ...record }) => ({ ...record, photos: parseJson<FollowUpPhotoInput[]>(storedPhotos, []), removedPhotoIds: parseJson<string[]>(storedRemovedPhotoIds, []) })),
    draft: draft ? { ...draft, photos: parseJson<FollowUpPhotoInput[]>(draft.photos, []), removedPhotoIds: parseJson<string[]>(draft.removedPhotoIds, []) } : null,
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
  const denied = denyUnless(user, "clinical:write");
  if (denied) return denied;
  const { id: patientId, sessionId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const session = await prisma.patientProcedureSession.findFirst({ where: { id: sessionId, patientId, clinicId: user.clinicId, status: "Concluída" }, select: { id: true, journeyId: true } });
  if (!session) return NextResponse.json({ message: "Sessão concluída não encontrada." }, { status: 404 });
  const guidanceText = typeof body?.guidanceText === "string" ? body.guidanceText : "";
  const complaints = typeof body?.complaints === "string" ? body.complaints : "";
  const observations = typeof body?.observations === "string" ? body.observations : "";
  const complications = typeof body?.complications === "string" ? body.complications : "";
  const appointmentId = typeof body?.appointmentId === "string" && body.appointmentId ? body.appointmentId : null;
  const photos = Array.isArray(body?.photos) ? body.photos as FollowUpPhotoInput[] : [];
  const removedPhotoIds = parseRemovedPhotoIds(body?.removedPhotoIds);
  if (!removedPhotoIds || complaints.length > 5000 || guidanceText.length > 5000 || observations.length > 5000 || complications.length > 5000 || photos.length > 12 || photos.some((photo) => !isValidPhoto(photo)) || new Set(photos.map((photo) => photo.id)).size !== photos.length || photos.reduce((total, photo) => total + photo.imageUrl.length, 0) > 24_000_000) {
    return NextResponse.json({ message: "Revise os textos e fotografias do rascunho." }, { status: 400 });
  }
  const existingBeforePhotoIds = await getBeforePhotoIds(patientId, user.clinicId, session.journeyId);
  if ([...existingBeforePhotoIds].filter((photoId) => !removedPhotoIds.includes(photoId)).length + photos.filter((photo) => photo.phase === "Antes").length < 1) {
    return NextResponse.json({ message: "Mantenha pelo menos uma foto de antes no tratamento." }, { status: 400 });
  }
  if (appointmentId) {
    const appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, clinicId: user.clinicId, patientId, journeyId: session.journeyId, procedure: { contains: "Retorno", mode: "insensitive" }, status: { in: ["Em atendimento", "Atendido", "Finalizado"] } }, select: { id: true } });
    if (!appointment) return NextResponse.json({ message: "Selecione um retorno atendido deste tratamento." }, { status: 400 });
  }
  const draft = await prisma.patientProcedureFollowUpDraft.upsert({
    where: { sessionId },
    create: { sessionId, complaints, guidanceText, guidanceConfirmed: body?.guidanceConfirmed === true, observations, complications, photos: JSON.stringify(photos), removedPhotoIds: JSON.stringify(removedPhotoIds), appointmentId },
    update: { complaints, guidanceText, guidanceConfirmed: body?.guidanceConfirmed === true, observations, complications, photos: JSON.stringify(photos), removedPhotoIds: JSON.stringify(removedPhotoIds), appointmentId },
    select: { updatedAt: true },
  });
  return NextResponse.json({ draft });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
  const denied = denyUnless(user, "clinical:write");
  if (denied) return denied;
  const { id: patientId, sessionId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const professional = user.name;
  const guidanceText = typeof body?.guidanceText === "string" ? body.guidanceText.trim() : "";
  const complaints = typeof body?.complaints === "string" ? body.complaints.trim() : "";
  const observations = typeof body?.observations === "string" ? body.observations.trim() : "";
  const complications = typeof body?.complications === "string" ? body.complications.trim() : "";
  const appointmentId = typeof body?.appointmentId === "string" ? body.appointmentId : null;
  const guidanceSent = body?.guidanceSent === true;
  const photos = Array.isArray(body?.photos) ? body.photos as FollowUpPhotoInput[] : [];
  const removedPhotoIds = parseRemovedPhotoIds(body?.removedPhotoIds);
  const occurredAt = new Date();
  if (!professional || professional.length > 160 || complaints.length > 5000 || guidanceText.length > 5000 || observations.length > 5000 || complications.length > 5000 || !removedPhotoIds) {
    return NextResponse.json({ message: "Revise os dados do acompanhamento." }, { status: 400 });
  }
  if (guidanceSent && !guidanceText) return NextResponse.json({ message: "Registre o texto das orientações que foram enviadas." }, { status: 400 });
  if (complaints && !appointmentId) return NextResponse.json({ message: "Inicie o retorno agendado antes de registrar as queixas." }, { status: 400 });
  if (photos.length > 12 || photos.some((photo) => !isValidPhoto(photo))) return NextResponse.json({ message: "Revise as imagens. São aceitas até 12 fotos válidas por registro." }, { status: 400 });
  if (new Set(photos.map((photo) => photo.id)).size !== photos.length) return NextResponse.json({ message: "Cada fotografia precisa ter um identificador único." }, { status: 400 });
  if (photos.reduce((total, photo) => total + photo.imageUrl.length, 0) > 24_000_000) return NextResponse.json({ message: "Salve em mais de um registro para anexar esse volume de imagens." }, { status: 413 });
  if (!complaints && !guidanceText && !observations && !complications && photos.length === 0 && !appointmentId) return NextResponse.json({ message: "Adicione uma queixa, orientação, observação, intercorrência, foto ou retorno." }, { status: 400 });
  const session = await prisma.patientProcedureSession.findFirst({ where: { id: sessionId, patientId, clinicId: user.clinicId }, select: { id: true, journeyId: true, status: true, professional: true, procedureName: true } });
  if (!session) return NextResponse.json({ message: "Sessão não encontrada." }, { status: 404 });
  if (session.status !== "Concluída") return NextResponse.json({ message: "Conclua a sessão antes de registrar o pós-procedimento." }, { status: 409 });
  const existingBeforePhotoIds = await getBeforePhotoIds(patientId, user.clinicId, session.journeyId);
  if ([...existingBeforePhotoIds].filter((photoId) => !removedPhotoIds.includes(photoId)).length + photos.filter((photo) => photo.phase === "Antes").length < 1) {
    return NextResponse.json({ message: "Mantenha pelo menos uma foto de antes no tratamento." }, { status: 400 });
  }
  if (appointmentId) {
    const appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, clinicId: user.clinicId, patientId, journeyId: session.journeyId, procedure: complaints ? `Retorno - ${session.procedureName}` : { contains: "Retorno", mode: "insensitive" }, status: { in: ["Em atendimento", "Atendido", "Finalizado"] } }, select: { id: true, date: true } });
    if (!appointment) return NextResponse.json({ message: "Selecione um retorno atendido deste paciente e tratamento." }, { status: 400 });
    if (complaints && appointmentDay(appointment.date) > clinicToday()) return NextResponse.json({ message: "O retorno ainda não chegou à data agendada." }, { status: 409 });
    const alreadyRecorded = await prisma.patientProcedureFollowUp.findUnique({ where: { appointmentId }, select: { id: true } });
    if (alreadyRecorded) return NextResponse.json({ message: "Este retorno já possui registro clínico." }, { status: 409 });
  }
  const at = new Date().toISOString();
  let record;
  try {
    record = await prisma.$transaction(async (tx) => {
      if (appointmentId) await tx.appointment.updateMany({ where: { id: appointmentId, clinicId: user.clinicId, status: "Em atendimento" }, data: { status: "Atendido", materialsCheck: "pending" } });
      const created = await tx.patientProcedureFollowUp.create({
    data: {
      clinicId: user.clinicId, patientId, journeyId: session.journeyId, sessionId,
      appointmentId, occurredAt, professional,
      complaints, guidanceText, guidanceSentAt: guidanceSent ? new Date() : null,
      observations, complications, photos: JSON.stringify(photos), removedPhotoIds: JSON.stringify(removedPhotoIds),
      createdBy: user.name, updatedBy: user.name,
      auditLog: JSON.stringify([{ at, actor: user.name, action: "Acompanhamento registrado", fields: [complaints ? "queixas" : "", guidanceText ? "orientações" : "", observations ? "observações" : "", complications ? "intercorrências" : "", photos.length ? "fotografias" : "", appointmentId ? "retorno" : ""].filter(Boolean) }]),
    },
    include: { appointment: { select: { id: true, date: true, time: true, procedure: true, professional: true, status: true, notes: true } } },
      });
      await tx.patientProcedureFollowUpDraft.deleteMany({ where: { sessionId } });
      return created;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) return NextResponse.json({ message: "Este retorno já possui registro clínico." }, { status: 409 });
    throw error;
  }
  return NextResponse.json({ followUp: { ...record, photos } }, { status: 201 });
}

async function getBeforePhotoIds(patientId: string, clinicId: string, journeyId: string) {
  const sessions = await prisma.patientProcedureSession.findMany({
    where: { patientId, clinicId, journeyId, status: "Concluída" },
    select: { photos: true, evaluation: { select: { photos: { select: { id: true } } } }, followUps: { select: { photos: true } } },
  });
  const ids = new Set<string>();
  for (const session of sessions) {
    const storedPhotos = parseJson<Array<FollowUpPhotoInput & { sourceEvaluationPhotoId?: string }>>(session.photos, []);
    const selectedSourceIds = new Set(storedPhotos.flatMap((photo) => photo.sourceEvaluationPhotoId ? [photo.sourceEvaluationPhotoId] : []));
    session.evaluation.photos.filter((photo) => !selectedSourceIds.has(photo.id)).forEach((photo) => ids.add(photo.id));
    storedPhotos.filter((photo) => photo.phase === "Antes").forEach((photo) => ids.add(photo.id));
    session.followUps.flatMap((record) => parseJson<FollowUpPhotoInput[]>(record.photos, [])).filter((photo) => photo.phase === "Antes").forEach((photo) => ids.add(photo.id));
  }
  return ids;
}
function parseRemovedPhotoIds(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100 || value.some((id) => typeof id !== "string" || id.length > 100)) return null;
  return [...new Set(value)];
}
function isUniqueConstraintError(error: unknown): error is { code: "P2002" } { return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002"); }
function isValidPhoto(value: unknown): value is FollowUpPhotoInput {
  const photo = value as Partial<FollowUpPhotoInput> | null;
  return Boolean(photo && (photo.phase === undefined || ["Antes", "Depois", "Evolução"].includes(photo.phase)) && typeof photo.id === "string" && photo.id.length <= 100 && typeof photo.name === "string" && photo.name.length <= 180 && typeof photo.category === "string" && ["Frontal", "Perfil direito", "Perfil esquerdo", "Sorriso", "Outra"].includes(photo.category) && typeof photo.imageUrl === "string" && /^data:image\/(jpeg|png|webp);base64,/i.test(photo.imageUrl) && photo.imageUrl.length <= 8_500_000 && Number.isInteger(photo.width) && Number(photo.width) > 0 && Number(photo.width) <= 8000 && Number.isInteger(photo.height) && Number(photo.height) > 0 && Number(photo.height) <= 8000 && Number(photo.width) * Number(photo.height) <= 25_000_000);
}
