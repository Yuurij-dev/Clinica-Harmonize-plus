import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function getPatient(patientId: string, clinicId: string) {
  return prisma.patient.findFirst({ where: { id: patientId, clinicId }, select: { id: true, clinicId: true } });
}

async function ensureDefaultJourney(patientId: string, clinicId: string) {
  const existing = await prisma.patientJourney.findFirst({ where: { patientId, clinicId, archivedAt: null }, orderBy: { createdAt: "asc" } });
  if (existing) return existing;

  return prisma.$transaction(async (transaction) => {
    const journey = await transaction.patientJourney.create({ data: { patientId, clinicId, name: "Jornada 1" } });
    await Promise.all([
      transaction.appointment.updateMany({ where: { patientId, clinicId, journeyId: null }, data: { journeyId: journey.id } }),
      transaction.patientProcedure.updateMany({ where: { patientId, clinicId, journeyId: null }, data: { journeyId: journey.id } }),
      transaction.evaluation.updateMany({ where: { patientId, clinicId, journeyId: null }, data: { journeyId: journey.id } }),
      transaction.quote.updateMany({ where: { patientId, clinicId, journeyId: null }, data: { journeyId: journey.id } }),
      transaction.payment.updateMany({ where: { patientId, clinicId, journeyId: null }, data: { journeyId: journey.id } }),
    ]);
    return journey;
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientId = (await params).id;
  if (!await getPatient(patientId, user.clinicId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  await ensureDefaultJourney(patientId, user.clinicId);
  const journeys = await prisma.patientJourney.findMany({ where: { patientId, clinicId: user.clinicId, archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, createdAt: true, quotes: { select: { status: true } } } });
  return NextResponse.json({ journeys: journeys.map(({ quotes, ...journey }) => ({ ...journey, hasPaidQuote: quotes.some((quote) => ["Pago", "Aprovado"].includes(quote.status)) })) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientId = (await params).id;
  if (!await getPatient(patientId, user.clinicId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const body = await request.json().catch(() => null) as { name?: string } | null;
  const count = await prisma.patientJourney.count({ where: { patientId, clinicId: user.clinicId } });
  const journey = await prisma.patientJourney.create({ data: { patientId, clinicId: user.clinicId, name: body?.name?.trim() || `Jornada ${count + 1}` }, select: { id: true, name: true, createdAt: true } });
  return NextResponse.json({ journey: { ...journey, hasPaidQuote: false } }, { status: 201 });
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
  const journey = await prisma.patientJourney.findFirst({ where: { id: body.journeyId, patientId, clinicId: user.clinicId }, select: { id: true, name: true, createdAt: true, quotes: { select: { status: true } } } });
  return NextResponse.json({ journey: journey ? { id: journey.id, name: journey.name, createdAt: journey.createdAt, hasPaidQuote: journey.quotes.some((quote) => ["Pago", "Aprovado"].includes(quote.status)) } : null });
}
