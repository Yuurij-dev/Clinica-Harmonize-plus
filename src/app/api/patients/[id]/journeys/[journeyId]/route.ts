import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyUnless } from "@/lib/api-guards";
import { prisma } from "@/lib/prisma";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; journeyId: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user.role, "clinical:write");
  if (denied) return denied;
  const { id: patientId, journeyId } = await params;
  const journey = await prisma.patientJourney.findFirst({ where: { id: journeyId, patientId, clinicId: user.clinicId, archivedAt: null }, select: { id: true, name: true, quotes: { select: { status: true } } } });
  if (!journey) return NextResponse.json({ message: "Jornada não encontrada." }, { status: 404 });
  if (journey.quotes.some((quote) => ["Pago", "Aprovado"].includes(quote.status))) return NextResponse.json({ message: "Não é possível excluir uma jornada com orçamento pago." }, { status: 409 });
  const activeCount = await prisma.patientJourney.count({ where: { patientId, clinicId: user.clinicId, archivedAt: null } });
  if (activeCount <= 1) return NextResponse.json({ message: "Mantenha pelo menos uma jornada para o cliente." }, { status: 409 });
  await prisma.patientJourney.update({ where: { id: journeyId }, data: { status: "Cancelado", archivedAt: new Date() } });
  return NextResponse.json({ journey: { id: journey.id, name: journey.name } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; journeyId: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const { id: patientId, journeyId } = await params;
  const body = await request.json().catch(() => ({})) as { status?: string };
  const denied = denyUnless(user.role, "clinical:write");
  if (denied) return denied;
  if (body.status !== "Concluído") {
    const restored = await prisma.patientJourney.updateMany({ where: { id: journeyId, patientId, clinicId: user.clinicId, archivedAt: { not: null } }, data: { status: "Em andamento", archivedAt: null } });
    if (restored.count) return NextResponse.json({ restored: true });
    return NextResponse.json({ message: "Ação de jornada inválida." }, { status: 400 });
  }
  const journey = await prisma.patientJourney.findFirst({ where: { id: journeyId, patientId, clinicId: user.clinicId, archivedAt: null }, select: { id: true, status: true, procedures: { select: { id: true } }, procedureSessions: { select: { status: true } } } });
  if (!journey) return NextResponse.json({ message: "Jornada não encontrada." }, { status: 404 });
  if (!journey.procedures.length && !journey.procedureSessions.some((session) => session.status === "Concluída")) return NextResponse.json({ message: "Registre ao menos uma sessão ou procedimento antes de concluir o tratamento." }, { status: 409 });
  if (journey.procedureSessions.some((session) => session.status !== "Concluída")) return NextResponse.json({ message: "Finalize as sessões em aberto antes de concluir o tratamento." }, { status: 409 });
  const completed = await prisma.patientJourney.updateMany({ where: { id: journeyId, patientId, clinicId: user.clinicId, archivedAt: null, status: "Em andamento" }, data: { status: "Concluído" } });
  if (!completed.count && journey.status !== "Concluído") return NextResponse.json({ message: "Não foi possível concluir o tratamento. Atualize a página e tente novamente." }, { status: 409 });
  return NextResponse.json({ status: "Concluído" });
}
