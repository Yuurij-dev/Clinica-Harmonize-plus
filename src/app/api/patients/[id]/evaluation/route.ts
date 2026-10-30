import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { denyUnless } from "@/lib/api-guards";
import { can } from "@/lib/permissions";
import { ensurePatientJourney } from "@/lib/patient-journey";
import { assessmentCompletionError, parseFacialNotes } from "@/lib/evaluation-rules";
import { annotationsHaveInvalidLabel } from "@/lib/photo-annotation-rules";
import { parseKnownPhotoIds, photosOverLimit, unknownStoredPhotos } from "@/lib/session-after-photo-rules";

type EvaluationPhotoPayload = {
  id?: string;
  name?: string;
  imageUrl?: string;
  width?: number;
  height?: number;
  category?: string;
  sortOrder?: number;
  annotations?: unknown[];
};

const assessmentFields = ["chiefComplaint", "patientGoal", "medicalHistory", "allergies", "pregnancyStatus", "anticoagulantUse", "autoimmuneDiseases", "contraindications", "previousProcedures", "clinicalNotes"] as const;
type AssessmentField = typeof assessmentFields[number];
type AssessmentPayload = Partial<Record<AssessmentField, string>> & { facialNotes?: unknown };
const photoCategories = new Set(["Frontal", "Perfil direito", "Perfil esquerdo", "Sorriso", "Outra"]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;

  const patientId = (await params).id;
  const searchParams = new URL(request.url).searchParams;
  const evaluationId = searchParams.get("evaluationId");
  const journeyId = searchParams.get("journeyId");
  const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId: user.clinicId }, select: { id: true } });
  if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const clinical = can(user.role, "clinical:read", user.rolePermissions);

  if (searchParams.get("list")) {
    const evaluations = await prisma.evaluation.findMany({
      where: { patientId, clinicId: user.clinicId, ...(journeyId ? { journeyId } : {}) },
      orderBy: { createdAt: "desc" },
      select: { id: true, professional: true, status: true, createdAt: true, updatedAt: true, _count: { select: { photos: true } } },
    });
    return NextResponse.json({ evaluations: evaluations.map(({ _count, ...evaluation }) => clinical ? { ...evaluation, photoCount: _count.photos } : { id: evaluation.id, professional: evaluation.professional, createdAt: evaluation.createdAt }) });
  }
  if (!clinical) return NextResponse.json({ message: "Acesso restrito à equipe clínica." }, { status: 403 });

  if (searchParams.get("summary") === "1") {
    const evaluation = await prisma.evaluation.findFirst({
      where: { patientId, clinicId: user.clinicId, ...(evaluationId ? { id: evaluationId } : {}), ...(journeyId ? { journeyId } : {}) },
      orderBy: { updatedAt: "desc" },
      select: { id: true, journeyId: true, professional: true, status: true, createdAt: true, updatedAt: true, chiefComplaint: true, patientGoal: true, medicalHistory: true, allergies: true, pregnancyStatus: true, anticoagulantUse: true, autoimmuneDiseases: true, contraindications: true, previousProcedures: true, clinicalNotes: true, facialNotes: true },
    });
    return NextResponse.json({ evaluation: evaluation ? { ...evaluation, facialNotes: evaluation.facialNotes ?? "" } : evaluation });
  }

  // Checagem barata do editor (fotos enviadas pelo app): só os ids da avaliação pedida, sem base64.
  if (searchParams.get("photoIds") === "1" && evaluationId) {
    const found = await prisma.evaluation.findFirst({ where: { id: evaluationId, patientId, clinicId: user.clinicId }, select: { status: true, photos: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true } } } });
    return NextResponse.json({ evaluation: found ? { status: found.status, photoIds: found.photos.map((photo) => photo.id) } : null });
  }
  // `only=id1,id2` devolve a avaliação com apenas essas fotos (busca das novas, sem reenviar as já conhecidas).
  const only = (searchParams.get("only") ?? "").split(",").filter(Boolean).slice(0, 20);

  // Sem avaliação informada, retorna a mais recente do paciente.
  const evaluation = await prisma.evaluation.findFirst({
    where: { patientId, clinicId: user.clinicId, ...(evaluationId ? { id: evaluationId } : {}), ...(journeyId ? { journeyId } : {}) },
    orderBy: { updatedAt: "desc" },
    include: { photos: { ...(only.length ? { where: { id: { in: only } } } : {}), orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  });

  return NextResponse.json({
    evaluation: evaluation ? {
      id: evaluation.id,
      professional: evaluation.professional,
      createdAt: evaluation.createdAt,
      status: evaluation.status,
      chiefComplaint: evaluation.chiefComplaint,
      patientGoal: evaluation.patientGoal,
      medicalHistory: evaluation.medicalHistory,
      allergies: evaluation.allergies,
      pregnancyStatus: evaluation.pregnancyStatus,
      anticoagulantUse: evaluation.anticoagulantUse,
      autoimmuneDiseases: evaluation.autoimmuneDiseases,
      contraindications: evaluation.contraindications,
      previousProcedures: evaluation.previousProcedures,
      clinicalNotes: evaluation.clinicalNotes,
      facialNotes: evaluation.facialNotes ?? "",
      photos: evaluation.photos.map((photo) => ({
        id: photo.id,
        name: photo.name,
        imageUrl: photo.imageUrl,
        width: photo.width,
        height: photo.height,
        category: photo.category,
        sortOrder: photo.sortOrder,
        annotations: parseAnnotations(photo.annotations),
      })),
    } : null,
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
  const denied = denyUnless(user, "clinical:write");
  if (denied) return denied;

  const patientId = (await params).id;
  const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId: user.clinicId }, select: { id: true } });
  if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });

  const body = await request.json().catch(() => null) as ({ evaluationId?: string; journeyId?: string; photos?: EvaluationPhotoPayload[]; knownPhotoIds?: unknown; assessment?: AssessmentPayload; status?: string } | null);
  const photos = body?.photos;
  if (!Array.isArray(photos)) return NextResponse.json({ message: "Envie as fotos da avaliação." }, { status: 400 });
  const existingEvaluation = body?.evaluationId ? await prisma.evaluation.findFirst({ where: { id: body.evaluationId, patientId, clinicId: user.clinicId }, select: { id: true, journeyId: true, status: true, chiefComplaint: true, patientGoal: true, medicalHistory: true, contraindications: true, allergies: true, pregnancyStatus: true, anticoagulantUse: true, autoimmuneDiseases: true, previousProcedures: true, clinicalNotes: true } }) : null;
  if (body?.evaluationId && !existingEvaluation) {
    return NextResponse.json({ message: "Avaliação não encontrada." }, { status: 404 });
  }
  if (body?.journeyId && !await prisma.patientJourney.findFirst({ where: { id: body.journeyId, patientId, clinicId: user.clinicId, archivedAt: null }, select: { id: true } })) {
    return NextResponse.json({ message: "Tratamento não encontrado." }, { status: 404 });
  }
  if (existingEvaluation && body?.journeyId && existingEvaluation.journeyId !== body.journeyId) {
    return NextResponse.json({ message: "A avaliação pertence a outro tratamento." }, { status: 400 });
  }
  if (photos.length > 20 || photos.some((photo) => !photo || typeof photo.name !== "string" || photo.name.length > 180 || typeof photo.imageUrl !== "string" || !/^data:image\/(jpeg|png|webp);base64,/i.test(photo.imageUrl) || photo.imageUrl.length > 8_500_000 || !Number.isInteger(photo.width) || !Number.isInteger(photo.height) || (photo.width ?? 0) < 1 || (photo.height ?? 0) < 1 || (photo.width ?? 0) > 8000 || (photo.height ?? 0) > 8000 || (photo.width ?? 0) * (photo.height ?? 0) > 25_000_000 || (photo.category !== undefined && !photoCategories.has(photo.category)) || (photo.sortOrder !== undefined && !Number.isInteger(photo.sortOrder)) || (photo.annotations !== undefined && (!Array.isArray(photo.annotations) || photo.annotations.length > 1000)))) {
    return NextResponse.json({ message: "Revise as fotos enviadas. Cada avaliação aceita até 20 imagens válidas." }, { status: 400 });
  }
  if (photos.some((photo) => Array.isArray(photo.annotations) && annotationsHaveInvalidLabel(photo.annotations))) {
    return NextResponse.json({ message: "Uma legenda de marcação é inválida. Use texto de até 60 caracteres." }, { status: 400 });
  }
  if (body?.status !== undefined && !["Rascunho", "Concluída"].includes(body.status)) {
    return NextResponse.json({ message: "Status de avaliação inválido." }, { status: 400 });
  }
  const assessment: Partial<Record<AssessmentField, string>> = {};
  // Opcional e aditivo: quem não envia (app mobile) não altera o valor gravado.
  let facialNotes: string | undefined;
  if (body?.assessment) {
    if (body.assessment.facialNotes !== undefined) {
      const parsed = parseFacialNotes(body.assessment.facialNotes);
      if (!parsed.ok) return NextResponse.json({ message: parsed.message }, { status: 400 });
      facialNotes = parsed.value;
    }
    for (const field of assessmentFields) {
      const value = body.assessment[field];
      if (value !== undefined && (typeof value !== "string" || value.length > 5000)) {
        return NextResponse.json({ message: "Um dos campos clínicos excede o limite permitido." }, { status: 400 });
      }
      if (value !== undefined) assessment[field] = value.trim();
    }
  }
  if (body?.status === "Concluída") {
    // Avaliação já concluída (possivelmente antiga): só exige o que estava preenchido e foi esvaziado.
    const incomplete = assessmentCompletionError({ ...existingEvaluation, ...assessment }, existingEvaluation?.status === "Concluída" ? existingEvaluation : null);
    if (incomplete) return NextResponse.json({ message: incomplete }, { status: 400 });
  }
  const journey = existingEvaluation ? null : await ensurePatientJourney(patientId, user.clinicId, body?.journeyId);

  const validPhotos = photos;
  const known = parseKnownPhotoIds(body?.knownPhotoIds);
  if (!known.ok) return NextResponse.json({ message: known.message }, { status: 400 });
  const knownPhotoIds = known.ids;

  const result = await prisma.$transaction(async (transaction) => {
    // Ordem de travas: advisory lock (mesma chave do POST de evaluation/photos) PRIMEIRO, linhas depois; o inverso causaria deadlock.
    // O PUT não cruza com uma foto sendo anexada. Com knownPhotoIds, foto gravada que o editor não conhecia e que não veio na lista
    // (enviada pelo app depois do carregamento) é mantida; o que o editor conhecia e omitiu foi removido por ele.
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`evaluation-photo:${patientId}`}, 0))`;
    const keep = knownPhotoIds && body?.evaluationId ? unknownStoredPhotos(await transaction.evaluationPhoto.findMany({ where: { evaluationId: body.evaluationId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true } }), validPhotos.map((photo) => photo.id ?? ""), knownPhotoIds).map((photo) => photo.id) : [];
    if (photosOverLimit(validPhotos.length, keep.length, 20)) return { error: NextResponse.json({ message: "A avaliação já tem o máximo de 20 fotos." }, { status: 409 }) };

    // Sem evaluationId, cria uma nova avaliação em nome do usuário logado.
    const evaluation = body?.evaluationId
      ? await transaction.evaluation.update({ where: { id: body.evaluationId }, data: { ...assessment, ...(facialNotes !== undefined ? { facialNotes } : {}), ...(body?.status ? { status: body.status } : {}) } })
      : await transaction.evaluation.create({ data: { patientId, clinicId: user.clinicId, journeyId: journey?.id, professional: journey?.professional?.trim() || user.name, ...assessment, ...(facialNotes !== undefined ? { facialNotes } : {}), status: body?.status ?? "Rascunho" } });

    await transaction.evaluationPhoto.deleteMany({ where: { evaluationId: evaluation.id, ...(keep.length ? { id: { notIn: keep } } : {}) } });
    if (validPhotos.length) {
      await transaction.evaluationPhoto.createMany({
        data: validPhotos.map((photo, index) => ({
          id: typeof photo.id === "string" && photo.id ? photo.id : undefined,
          evaluationId: evaluation.id,
          name: photo.name as string,
          imageUrl: photo.imageUrl as string,
          width: photo.width as number,
          height: photo.height as number,
          category: photo.category ?? "Outra",
          sortOrder: photo.sortOrder ?? index,
          annotations: JSON.stringify(Array.isArray(photo.annotations) ? photo.annotations : []),
        })),
      });
    }
    // Fotos mantidas vão depois das enviadas, renumeradas para não repetir sortOrder (ordem de gravação preservada entre elas).
    const nextOrder = validPhotos.reduce((max, photo, index) => Math.max(max, (photo.sortOrder ?? index) + 1), 0);
    for (const [index, id] of keep.entries()) await transaction.evaluationPhoto.update({ where: { id }, data: { sortOrder: nextOrder + index }, select: { id: true } });
    return { evaluation, kept: keep.length };
  });

  if ("error" in result) return result.error;
  const savedEvaluation = result.evaluation;
  return NextResponse.json({ evaluation: { id: savedEvaluation.id, professional: savedEvaluation.professional, status: savedEvaluation.status, createdAt: savedEvaluation.createdAt, updatedAt: savedEvaluation.updatedAt, photoCount: validPhotos.length + result.kept } });
}

function parseAnnotations(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
