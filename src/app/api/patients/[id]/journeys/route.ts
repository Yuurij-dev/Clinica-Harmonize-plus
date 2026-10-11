import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ensurePatientJourney } from "@/lib/patient-journey";
import { prisma } from "@/lib/prisma";

async function getPatient(patientId: string, clinicId: string) {
  return prisma.patient.findFirst({ where: { id: patientId, clinicId }, select: { id: true, clinicId: true } });
}

const journeyProgressSelect = {
  id: true,
  name: true,
  createdAt: true,
  evaluations: { where: { photos: { some: {} } }, take: 1, select: { id: true } },
  quotes: { where: { status: { in: ["Pago", "Aprovado"] } }, take: 1, select: { id: true } },
  _count: { select: { procedures: true } },
} satisfies Prisma.PatientJourneySelect;

type JourneyRow = { id: string; name: string; createdAt: Date; evaluations: Array<{ id: string }>; quotes: Array<{ id: string }>; _count: { procedures: number } };

// As fotos são base64 grandes: só os ids das jornadas que têm foto saem do banco.
async function serializeJourneys(patientId: string, clinicId: string, journeys: JourneyRow[]) {
  const [withBefore, withAfter] = await Promise.all([
    prisma.patientProcedure.groupBy({ by: ["journeyId"], where: { patientId, clinicId, AND: [{ beforePhoto: { not: null } }, { beforePhoto: { not: "" } }] } }),
    prisma.patientProcedure.groupBy({ by: ["journeyId"], where: { patientId, clinicId, AND: [{ afterPhoto: { not: null } }, { afterPhoto: { not: "" } }] } }),
  ]);
  const beforeIds = new Set(withBefore.map((group) => group.journeyId));
  const afterIds = new Set(withAfter.map((group) => group.journeyId));
  return journeys.map((journey) => ({
    id: journey.id,
    name: journey.name,
    createdAt: journey.createdAt,
    hasEvaluation: journey.evaluations.length > 0,
    hasPaidQuote: journey.quotes.length > 0,
    hasProcedure: journey._count.procedures > 0,
    hasBeforePhoto: beforeIds.has(journey.id),
    hasAfterPhoto: afterIds.has(journey.id),
  }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientId = (await params).id;
  if (!await getPatient(patientId, user.clinicId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  await ensurePatientJourney(patientId, user.clinicId);
  const journeys = await prisma.patientJourney.findMany({ where: { patientId, clinicId: user.clinicId, archivedAt: null }, orderBy: { createdAt: "asc" }, select: journeyProgressSelect });
  return NextResponse.json({ journeys: await serializeJourneys(patientId, user.clinicId, journeys) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientId = (await params).id;
  if (!await getPatient(patientId, user.clinicId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const body = await request.json().catch(() => null) as { name?: string } | null;
  const count = await prisma.patientJourney.count({ where: { patientId, clinicId: user.clinicId } });
  const journey = await prisma.patientJourney.create({ data: { patientId, clinicId: user.clinicId, name: body?.name?.trim() || `Jornada ${count + 1}` }, select: journeyProgressSelect });
  const [serialized] = await serializeJourneys(patientId, user.clinicId, [journey]);
  return NextResponse.json({ journey: serialized }, { status: 201 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientId = (await params).id;
  if (!await getPatient(patientId, user.clinicId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const body = await request.json().catch(() => null) as { journeyId?: string; name?: string } | null;
  const name = body?.name?.trim();
  if (!body?.journeyId || !name) return NextResponse.json({ message: "Informe um nome para a jornada." }, { status: 400 });
  const result = await prisma.patientJourney.updateMany({ where: { id: body.journeyId, patientId, clinicId: user.clinicId }, data: { name } });
  if (!result.count) return NextResponse.json({ message: "Jornada não encontrada." }, { status: 404 });
  const journey = await prisma.patientJourney.findFirst({ where: { id: body.journeyId, patientId, clinicId: user.clinicId }, select: journeyProgressSelect });
  return NextResponse.json({ journey: journey ? (await serializeJourneys(patientId, user.clinicId, [journey]))[0] : null });
}
