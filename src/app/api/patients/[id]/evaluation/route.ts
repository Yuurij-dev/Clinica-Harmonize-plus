import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensurePatientJourney } from "@/lib/patient-journey";

type EvaluationPhotoPayload = {
  id?: string;
  name?: string;
  imageUrl?: string;
  width?: number;
  height?: number;
  annotations?: unknown[];
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const patientId = (await params).id;
  const searchParams = new URL(request.url).searchParams;
  const evaluationId = searchParams.get("evaluationId");
  const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId: user.clinicId }, select: { id: true } });
  if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });

  if (searchParams.get("list")) {
    const evaluations = await prisma.evaluation.findMany({
      where: { patientId, clinicId: user.clinicId },
      orderBy: { createdAt: "desc" },
      select: { id: true, professional: true, createdAt: true, updatedAt: true, _count: { select: { photos: true } } },
    });
    return NextResponse.json({ evaluations: evaluations.map(({ _count, ...evaluation }) => ({ ...evaluation, photoCount: _count.photos })) });
  }

  // Sem avaliação informada, retorna a mais recente do paciente.
  const evaluation = await prisma.evaluation.findFirst({
    where: { patientId, clinicId: user.clinicId, ...(evaluationId ? { id: evaluationId } : {}) },
    orderBy: { updatedAt: "desc" },
    include: { photos: { orderBy: { createdAt: "asc" } } },
  });

  return NextResponse.json({
    evaluation: evaluation ? {
      id: evaluation.id,
      professional: evaluation.professional,
      createdAt: evaluation.createdAt,
      photos: evaluation.photos.map((photo) => ({
        id: photo.id,
        name: photo.name,
        imageUrl: photo.imageUrl,
        width: photo.width,
        height: photo.height,
        annotations: parseAnnotations(photo.annotations),
      })),
    } : null,
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const patientId = (await params).id;
  const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId: user.clinicId }, select: { id: true } });
  if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });

  const body = await request.json().catch(() => null) as { evaluationId?: string; photos?: EvaluationPhotoPayload[] } | null;
  const photos = body?.photos;
  if (!Array.isArray(photos)) return NextResponse.json({ message: "Envie as fotos da avaliação." }, { status: 400 });
  if (body?.evaluationId && !await prisma.evaluation.findFirst({ where: { id: body.evaluationId, patientId, clinicId: user.clinicId }, select: { id: true } })) {
    return NextResponse.json({ message: "Avaliação não encontrada." }, { status: 404 });
  }
  const journey = body?.evaluationId ? null : await ensurePatientJourney(patientId, user.clinicId);

  const validPhotos = photos.filter((photo) => (
    photo && typeof photo.name === "string" && typeof photo.imageUrl === "string" &&
    /^data:image\/(jpeg|png|webp);base64,/i.test(photo.imageUrl) &&
    Number.isInteger(photo.width) && Number.isInteger(photo.height)
  ));

  const savedEvaluation = await prisma.$transaction(async (transaction) => {
    // Sem evaluationId, cria uma nova avaliação em nome do usuário logado.
    const evaluation = body?.evaluationId
      ? await transaction.evaluation.update({ where: { id: body.evaluationId }, data: {} })
      : await transaction.evaluation.create({ data: { patientId, clinicId: user.clinicId, journeyId: journey?.id, professional: user.name } });

    await transaction.evaluationPhoto.deleteMany({ where: { evaluationId: evaluation.id } });
    if (validPhotos.length) {
      await transaction.evaluationPhoto.createMany({
        data: validPhotos.map((photo) => ({
          id: typeof photo.id === "string" && photo.id ? photo.id : undefined,
          evaluationId: evaluation.id,
          name: photo.name as string,
          imageUrl: photo.imageUrl as string,
          width: photo.width as number,
          height: photo.height as number,
          annotations: JSON.stringify(Array.isArray(photo.annotations) ? photo.annotations : []),
        })),
      });
    }
    return evaluation;
  });

  return NextResponse.json({ evaluation: { id: savedEvaluation.id, professional: savedEvaluation.professional, createdAt: savedEvaluation.createdAt, updatedAt: savedEvaluation.updatedAt, photoCount: validPhotos.length } });
}

function parseAnnotations(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
