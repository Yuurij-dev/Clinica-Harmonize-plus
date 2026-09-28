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
  const journeyId = new URL(request.url).searchParams.get("journeyId");
  const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId: user.clinicId }, select: { id: true } });
  if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const journey = await ensurePatientJourney(patientId, user.clinicId, journeyId);

  const evaluation = await prisma.evaluation.findFirst({
    where: { patientId, clinicId: user.clinicId, journeyId: journey.id },
    orderBy: { updatedAt: "desc" },
    include: { photos: { orderBy: { createdAt: "asc" } } },
  });

  return NextResponse.json({
    evaluation: evaluation ? {
      id: evaluation.id,
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
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const patientId = (await params).id;
  const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId: user.clinicId }, select: { id: true } });
  if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });

  const body = await request.json().catch(() => null) as { journeyId?: string; photos?: EvaluationPhotoPayload[] } | null;
  const photos = body?.photos;
  if (!Array.isArray(photos)) return NextResponse.json({ message: "Envie as fotos da avaliação." }, { status: 400 });
  const journey = await ensurePatientJourney(patientId, user.clinicId, body?.journeyId);

  const validPhotos = photos.filter((photo) => (
    photo && typeof photo.name === "string" && typeof photo.imageUrl === "string" &&
    /^data:image\/(jpeg|png|webp);base64,/i.test(photo.imageUrl) &&
    Number.isInteger(photo.width) && Number.isInteger(photo.height)
  ));

  const savedEvaluation = await prisma.$transaction(async (transaction) => {
    const current = await transaction.evaluation.findFirst({ where: { patientId, clinicId: user.clinicId, journeyId: journey.id }, select: { id: true } });
    const evaluation = current
      ? await transaction.evaluation.update({ where: { id: current.id }, data: {} })
      : await transaction.evaluation.create({ data: { patientId, clinicId: user.clinicId, journeyId: journey.id } });

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

  return NextResponse.json({ evaluation: { id: savedEvaluation.id, photoCount: validPhotos.length } });
}

function parseAnnotations(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
