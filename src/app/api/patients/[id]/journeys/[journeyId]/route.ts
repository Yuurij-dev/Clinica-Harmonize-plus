import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; journeyId: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const { id: patientId, journeyId } = await params;
  const journey = await prisma.patientJourney.findFirst({ where: { id: journeyId, patientId, clinicId: user.clinicId, archivedAt: null }, select: { id: true, name: true, quotes: { select: { status: true } } } });
  if (!journey) return NextResponse.json({ message: "Jornada não encontrada." }, { status: 404 });
  if (journey.quotes.some((quote) => ["Pago", "Aprovado"].includes(quote.status))) return NextResponse.json({ message: "Não é possível excluir uma jornada com orçamento pago." }, { status: 409 });
  const activeCount = await prisma.patientJourney.count({ where: { patientId, clinicId: user.clinicId, archivedAt: null } });
  if (activeCount <= 1) return NextResponse.json({ message: "Mantenha pelo menos uma jornada para o cliente." }, { status: 409 });
  await prisma.patientJourney.update({ where: { id: journeyId }, data: { archivedAt: new Date() } });
  return NextResponse.json({ journey: { id: journey.id, name: journey.name } });
}

export async function PATCH(_request: Request, { params }: { params: Promise<{ id: string; journeyId: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const { id: patientId, journeyId } = await params;
  const journey = await prisma.patientJourney.updateMany({ where: { id: journeyId, patientId, clinicId: user.clinicId, archivedAt: { not: null } }, data: { archivedAt: null } });
  if (!journey.count) return NextResponse.json({ message: "Jornada não encontrada para desfazer." }, { status: 404 });
  return NextResponse.json({ restored: true });
}
