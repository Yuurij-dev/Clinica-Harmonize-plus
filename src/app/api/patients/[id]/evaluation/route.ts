import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { denyUnless } from "@/lib/api-guards";
import { can } from "@/lib/permissions";
import { ensurePatientJourney } from "@/lib/patient-journey";

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
type AssessmentPayload = Partial<Record<AssessmentField, string>>;
const photoCategories = new Set(["Frontal", "Perfil direito", "Perfil esquerdo", "Sorriso", "Outra"]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const patientId = (await params).id;
  const searchParams = new URL(request.url).searchParams;
  const evaluationId = searchParams.get("evaluationId");
  const journeyId = searchParams.get("journeyId");
  const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId: user.clinicId }, select: { id: true } });
  if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const clinical = can(user.role, "clinical:read");

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
      select: { id: true, journeyId: true, professional: true, status: true, createdAt: true, updatedAt: true, chiefComplaint: true, patientGoal: true, medicalHistory: true, allergies: true, pregnancyStatus: true, anticoagulantUse: true, autoimmuneDiseases: true, contraindications: true, previousProcedures: true, clinicalNotes: true },
    });
    return NextResponse.json({ evaluation });
  }

  // Sem avaliação informada, retorna a mais recente do paciente.
  const evaluation = await prisma.evaluation.findFirst({
    where: { patientId, clinicId: user.clinicId, ...(evaluationId ? { id: evaluationId } : {}), ...(journeyId ? { journeyId } : {}) },
    orderBy: { updatedAt: "desc" },
    include: { photos: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
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
  const denied = denyUnless(user.role, "clinical:write");
  if (denied) return denied;

  const patientId = (await params).id;
  const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId: user.clinicId }, select: { id: true } });
  if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });

  const body = await request.json().catch(() => null) as ({ evaluationId?: string; journeyId?: string; photos?: EvaluationPhotoPayload[]; assessment?: AssessmentPayload; status?: string } | null);
  const photos = body?.photos;
  if (!Array.isArray(photos)) return NextResponse.json({ message: "Envie as fotos da avaliação." }, { status: 400 });
  const existingEvaluation = body?.evaluationId ? await prisma.evaluation.findFirst({ where: { id: body.evaluationId, patientId, clinicId: user.clinicId }, select: { id: true, journeyId: true, chiefComplaint: true } }) : null;
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
  if (body?.status !== undefined && !["Rascunho", "Concluída"].includes(body.status)) {
    return NextResponse.json({ message: "Status de avaliação inválido." }, { status: 400 });
  }
  const assessment: Partial<Record<AssessmentField, string>> = {};
  if (body?.assessment) {
    for (const field of assessmentFields) {
      const value = body.assessment[field];
      if (value !== undefined && (typeof value !== "string" || value.length > 5000)) {
        return NextResponse.json({ message: "Um dos campos clínicos excede o limite permitido." }, { status: 400 });
      }
      if (value !== undefined) assessment[field] = value.trim();
    }
  }
  if (body?.status === "Concluída" && !(assessment.chiefComplaint ?? existingEvaluation?.chiefComplaint ?? "").trim()) {
    return NextResponse.json({ message: "Informe a queixa principal para concluir a avaliação." }, { status: 400 });
  }
  const journey = existingEvaluation ? null : await ensurePatientJourney(patientId, user.clinicId, body?.journeyId);

  const validPhotos = photos;

  const savedEvaluation = await prisma.$transaction(async (transaction) => {
    // Sem evaluationId, cria uma nova avaliação em nome do usuário logado.
    const evaluation = body?.evaluationId
      ? await transaction.evaluation.update({ where: { id: body.evaluationId }, data: { ...assessment, ...(body?.status ? { status: body.status } : {}) } })
      : await transaction.evaluation.create({ data: { patientId, clinicId: user.clinicId, journeyId: journey?.id, professional: journey?.professional?.trim() || user.name, ...assessment, status: body?.status ?? "Rascunho" } });

    await transaction.evaluationPhoto.deleteMany({ where: { evaluationId: evaluation.id } });
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
    return evaluation;
  });

  return NextResponse.json({ evaluation: { id: savedEvaluation.id, professional: savedEvaluation.professional, status: savedEvaluation.status, createdAt: savedEvaluation.createdAt, updatedAt: savedEvaluation.updatedAt, photoCount: validPhotos.length } });
}

function parseAnnotations(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
