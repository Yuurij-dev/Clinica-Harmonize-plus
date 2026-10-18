import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyUnless } from "@/lib/api-guards";
import { prisma } from "@/lib/prisma";

type FollowUpPhotoInput = { id: string; name: string; category: string; imageUrl: string; width: number; height: number };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user.role, "clinical:read");
  if (denied) return denied;
  const { id: patientId, sessionId } = await params;
  const requestedJourneyId = new URL(_request.url).searchParams.get("journeyId");
  const session = await prisma.patientProcedureSession.findFirst({
    where: { id: sessionId, patientId, clinicId: user.clinicId },
    select: {
      id: true, journeyId: true, procedureName: true, professional: true, performedAt: true, status: true,
      journey: { select: { name: true, status: true, appointments: { where: { clinicId: user.clinicId }, orderBy: [{ date: "asc" }, { time: "asc" }], select: { id: true, date: true, time: true, procedure: true, professional: true, status: true, notes: true } } } },
    },
  });
  if (!session) return NextResponse.json({ message: "Sessão não encontrada." }, { status: 404 });
  if (session.status !== "Concluída") return NextResponse.json({ message: "O acompanhamento fica disponível após a conclusão da sessão." }, { status: 409 });
  if (requestedJourneyId && requestedJourneyId !== session.journeyId) return NextResponse.json({ message: "A sessão não pertence a este tratamento." }, { status: 404 });
  const draft = await prisma.patientProcedureFollowUpDraft.findUnique({ where: { sessionId }, select: { guidanceText: true, guidanceConfirmed: true, observations: true, complications: true, photos: true, appointmentId: true, updatedAt: true } });
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
      for (const photo of parseJson<FollowUpPhotoInput[]>(record.photos, [])) photos.push({ ...photo, phase: "Evolução", capturedAt: record.occurredAt, source: "Retorno", sessionId: historySession.id });
    }
  }
  return NextResponse.json({
    session: { id: session.id, journeyId: session.journeyId, procedureName: session.procedureName, professional: session.professional, performedAt: session.performedAt, status: session.status },
    journey: session.journey,
    photos,
    sessions: sessions.map(({ id, procedureName, professional, performedAt }) => ({ id, procedureName, professional, performedAt })),
    followUps: allFollowUps.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()).map(({ photos: storedPhotos, ...record }) => ({ ...record, photos: parseJson<FollowUpPhotoInput[]>(storedPhotos, []) })),
    draft: draft ? { ...draft, photos: parseJson<FollowUpPhotoInput[]>(draft.photos, []) } : null,
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user.role, "clinical:write");
  if (denied) return denied;
  const { id: patientId, sessionId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const session = await prisma.patientProcedureSession.findFirst({ where: { id: sessionId, patientId, clinicId: user.clinicId, status: "Concluída" }, select: { id: true, journeyId: true } });
  if (!session) return NextResponse.json({ message: "Sessão concluída não encontrada." }, { status: 404 });
  const guidanceText = typeof body?.guidanceText === "string" ? body.guidanceText : "";
  const observations = typeof body?.observations === "string" ? body.observations : "";
  const complications = typeof body?.complications === "string" ? body.complications : "";
  const appointmentId = typeof body?.appointmentId === "string" && body.appointmentId ? body.appointmentId : null;
  const photos = Array.isArray(body?.photos) ? body.photos as FollowUpPhotoInput[] : [];
  if (guidanceText.length > 5000 || observations.length > 5000 || complications.length > 5000 || photos.length > 12 || photos.some((photo) => !isValidPhoto(photo)) || new Set(photos.map((photo) => photo.id)).size !== photos.length || photos.reduce((total, photo) => total + photo.imageUrl.length, 0) > 24_000_000) {
    return NextResponse.json({ message: "Revise os textos e fotografias do rascunho." }, { status: 400 });
  }
  if (appointmentId) {
    const appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, clinicId: user.clinicId, patientId, journeyId: session.journeyId, procedure: { contains: "Retorno", mode: "insensitive" }, status: { in: ["Atendido", "Finalizado"] } }, select: { id: true } });
    if (!appointment) return NextResponse.json({ message: "Selecione um retorno atendido deste tratamento." }, { status: 400 });
  }
  const draft = await prisma.patientProcedureFollowUpDraft.upsert({
    where: { sessionId },
    create: { sessionId, guidanceText, guidanceConfirmed: body?.guidanceConfirmed === true, observations, complications, photos: JSON.stringify(photos), appointmentId },
    update: { guidanceText, guidanceConfirmed: body?.guidanceConfirmed === true, observations, complications, photos: JSON.stringify(photos), appointmentId },
    select: { updatedAt: true },
  });
  return NextResponse.json({ draft });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user.role, "clinical:write");
  if (denied) return denied;
  const { id: patientId, sessionId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const professional = user.name;
  const guidanceText = typeof body?.guidanceText === "string" ? body.guidanceText.trim() : "";
  const observations = typeof body?.observations === "string" ? body.observations.trim() : "";
  const complications = typeof body?.complications === "string" ? body.complications.trim() : "";
  const appointmentId = typeof body?.appointmentId === "string" ? body.appointmentId : null;
  const guidanceSent = body?.guidanceSent === true;
  const photos = Array.isArray(body?.photos) ? body.photos as FollowUpPhotoInput[] : [];
  const occurredAt = new Date();
  if (!professional || professional.length > 160 || guidanceText.length > 5000 || observations.length > 5000 || complications.length > 5000) {
    return NextResponse.json({ message: "Revise os dados do acompanhamento." }, { status: 400 });
  }
  if (guidanceSent && !guidanceText) return NextResponse.json({ message: "Registre o texto das orientações que foram enviadas." }, { status: 400 });
  if (photos.length > 12 || photos.some((photo) => !isValidPhoto(photo))) return NextResponse.json({ message: "Revise as imagens. São aceitas até 12 fotos válidas por registro." }, { status: 400 });
  if (new Set(photos.map((photo) => photo.id)).size !== photos.length) return NextResponse.json({ message: "Cada fotografia precisa ter um identificador único." }, { status: 400 });
  if (photos.reduce((total, photo) => total + photo.imageUrl.length, 0) > 24_000_000) return NextResponse.json({ message: "Salve em mais de um registro para anexar esse volume de imagens." }, { status: 413 });
  if (!guidanceText && !observations && !complications && photos.length === 0 && !appointmentId) return NextResponse.json({ message: "Adicione uma orientação, observação, intercorrência, foto ou retorno." }, { status: 400 });
  const session = await prisma.patientProcedureSession.findFirst({ where: { id: sessionId, patientId, clinicId: user.clinicId }, select: { id: true, journeyId: true, status: true, professional: true } });
  if (!session) return NextResponse.json({ message: "Sessão não encontrada." }, { status: 404 });
  if (session.status !== "Concluída") return NextResponse.json({ message: "Conclua a sessão antes de registrar o pós-procedimento." }, { status: 409 });
  if (appointmentId) {
    const appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, clinicId: user.clinicId, patientId, journeyId: session.journeyId, procedure: { contains: "Retorno", mode: "insensitive" }, status: { in: ["Atendido", "Finalizado"] } }, select: { id: true } });
    if (!appointment) return NextResponse.json({ message: "Selecione um retorno atendido deste paciente e tratamento." }, { status: 400 });
    const alreadyRecorded = await prisma.patientProcedureFollowUp.findUnique({ where: { appointmentId }, select: { id: true } });
    if (alreadyRecorded) return NextResponse.json({ message: "Este retorno já possui registro clínico." }, { status: 409 });
  }
  const at = new Date().toISOString();
  let record;
  try {
    record = await prisma.$transaction(async (tx) => {
      const created = await tx.patientProcedureFollowUp.create({
    data: {
      clinicId: user.clinicId, patientId, journeyId: session.journeyId, sessionId,
      appointmentId, occurredAt, professional,
      guidanceText, guidanceSentAt: guidanceSent ? new Date() : null,
      observations, complications, photos: JSON.stringify(photos),
      createdBy: user.name, updatedBy: user.name,
      auditLog: JSON.stringify([{ at, actor: user.name, action: "Acompanhamento registrado", fields: [guidanceText ? "orientações" : "", observations ? "observações" : "", complications ? "intercorrências" : "", photos.length ? "fotografias" : "", appointmentId ? "retorno" : ""].filter(Boolean) }]),
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

function parseJson<T>(value: string, fallback: T): T { try { return JSON.parse(value) as T; } catch { return fallback; } }
function isUniqueConstraintError(error: unknown): error is { code: "P2002" } { return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002"); }
function isValidPhoto(value: unknown): value is FollowUpPhotoInput {
  const photo = value as Partial<FollowUpPhotoInput> | null;
  return Boolean(photo && typeof photo.id === "string" && photo.id.length <= 100 && typeof photo.name === "string" && photo.name.length <= 180 && typeof photo.category === "string" && ["Frontal", "Perfil direito", "Perfil esquerdo", "Sorriso", "Outra"].includes(photo.category) && typeof photo.imageUrl === "string" && /^data:image\/(jpeg|png|webp);base64,/i.test(photo.imageUrl) && photo.imageUrl.length <= 8_500_000 && Number.isInteger(photo.width) && Number(photo.width) > 0 && Number(photo.width) <= 8000 && Number.isInteger(photo.height) && Number(photo.height) > 0 && Number(photo.height) <= 8000 && Number(photo.width) * Number(photo.height) <= 25_000_000);
}
