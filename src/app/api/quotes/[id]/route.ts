import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { serializeQuote, toCents } from "@/lib/finance";
import { prisma } from "@/lib/prisma";
import { can, quoteChangeAllowed, quoteProfessional } from "@/lib/permissions";
import { calculateQuote, type QuoteLineInput } from "@/lib/quote-rules";
import { quoteCostSnapshot } from "@/lib/quote-cost-snapshot";
import { denyUnless } from "@/lib/api-guards";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user, "quotes:manage");
  if (denied) return denied;
  const body = await request.json().catch(() => null) as { status?: string; items?: string; details?: QuoteLineInput[]; total?: number; paymentMethod?: string; installments?: number; notes?: string; evaluationId?: string } | null;
  const id = (await params).id;
  const existing = await prisma.quote.findFirst({ where: { id, clinicId: user.clinicId }, select: { patientId: true, journeyId: true, evaluationId: true, status: true, items: true, totalCents: true, paymentMethod: true, details: true } });
  if (!existing) return NextResponse.json({ message: "Orçamento não encontrado." }, { status: 404 });
  const requestedEvaluationId = body?.evaluationId?.trim();
  const existingPatientId = existing.patientId;
  const existingJourneyId = existing.journeyId;
  if (requestedEvaluationId && existing.evaluationId && existing.evaluationId !== requestedEvaluationId) {
    return NextResponse.json({ message: "Este orçamento já está vinculado a outra avaliação." }, { status: 409 });
  }
  if (requestedEvaluationId && !existingPatientId) {
    return NextResponse.json({ message: "Este orçamento ainda não está vinculado a um paciente." }, { status: 400 });
  }
  if (requestedEvaluationId && !existingJourneyId) {
    return NextResponse.json({ message: "Este orçamento ainda não está vinculado a uma jornada." }, { status: 400 });
  }
  if (requestedEvaluationId && existingPatientId && existingJourneyId) {
    const evaluation = await prisma.evaluation.findFirst({
      where: { id: requestedEvaluationId, patientId: existingPatientId, journeyId: existingJourneyId, clinicId: user.clinicId },
      select: { id: true },
    });
    if (!evaluation) return NextResponse.json({ message: "A avaliação não pertence ao mesmo paciente, clínica e jornada deste orçamento." }, { status: 400 });
  }
  const details = body?.details === undefined ? undefined : await quoteDetails(body.details, user.clinicId, user.id, user.role);
  if (body?.details !== undefined && !details) return NextResponse.json({ message: "Revise os procedimentos, quantidades e descontos do orçamento." }, { status: 400 });
  if (body?.notes !== undefined && (typeof body.notes !== "string" || body.notes.length > 2000)) return NextResponse.json({ message: "As observações devem ter até 2.000 caracteres." }, { status: 400 });
  if (body?.installments !== undefined && (!Number.isInteger(body.installments) || body.installments < 1 || body.installments > 12)) return NextResponse.json({ message: "O número de parcelas deve ficar entre 1 e 12." }, { status: 400 });
  if (body?.status !== undefined && !["Rascunho", "Pendente", "Enviado", "Aprovado", "Recusado", "Cancelado", "Pago"].includes(body.status)) return NextResponse.json({ message: "Status de orçamento inválido." }, { status: 400 });
  const nextItems = details ? details.items.map((item) => `${item.name} (${item.quantity}x)`).join(", ") : body?.items?.trim();
  const nextTotalCents = details?.totalCents ?? (typeof body?.total === "number" && Number.isFinite(body.total) ? toCents(body.total) : undefined);
  const editsContent = Boolean(nextItems && nextItems !== existing.items)
    || Boolean(nextTotalCents !== undefined && nextTotalCents !== existing.totalCents)
    || Boolean(body?.paymentMethod && body.paymentMethod !== existing.paymentMethod)
    || Boolean(body?.details !== undefined && JSON.stringify(details) !== existing.details)
    || Boolean(requestedEvaluationId && requestedEvaluationId !== existing.evaluationId)
    || body?.notes !== undefined
    || body?.installments !== undefined;
  if (!quoteChangeAllowed(user.role, { current: existing.status, next: body?.status, editsContent }, user.rolePermissions)) {
    return NextResponse.json({ message: "Orçamento já fechado: só administrador ou profissional pode alterar." }, { status: 403 });
  }
  const updateData = {
    ...(nextItems ? { items: nextItems } : {}),
    ...(nextTotalCents !== undefined ? { totalCents: nextTotalCents } : {}),
    ...(details ? { details: JSON.stringify(details) } : {}),
    ...(body?.notes !== undefined ? { notes: body.notes.trim() } : {}),
    ...(body?.installments !== undefined ? { installments: body.installments } : {}),
    ...(requestedEvaluationId ? { evaluationId: requestedEvaluationId } : {}),
    ...(body?.paymentMethod && ["Cartão de crédito", "Cartão de débito", "Pix", "Dinheiro", "Boleto", "Transferência"].includes(body.paymentMethod) ? { paymentMethod: body.paymentMethod } : {}),
    ...(body?.status ? { status: body.status } : {}),
    updatedBy: user.name,
    ...(body?.status === "Enviado" && existing.status !== "Enviado" ? { sentAt: new Date(), sentBy: user.name } : {}),
    ...(body?.status === "Aprovado" && existing.status !== "Aprovado" ? { approvedAt: new Date(), approvedBy: user.name } : {}),
    ...(body?.status === "Recusado" && existing.status !== "Recusado" ? { refusedAt: new Date(), refusedBy: user.name } : {}),
    ...(body?.status === "Cancelado" && existing.status !== "Cancelado" ? { cancelledAt: new Date(), cancelledBy: user.name } : {}),
  };
  const result = await prisma.quote.updateMany({ where: { id, clinicId: user.clinicId, ...(can(user.role, "quote:edit-closed", user.rolePermissions) ? {} : { status: existing.status }) }, data: updateData });
  if (!result.count) return NextResponse.json({ message: "O orçamento foi alterado; recarregue a página." }, { status: 409 });
  const quote = await prisma.quote.findFirst({ where: { id, clinicId: user.clinicId }, include: { patient: { select: { name: true } } } });
  if (quote && ["Aprovado", "Pago"].includes(quote.status) && quote.patientId && !quote.evaluationId) {
    // quoteId é único: dois PATCH simultâneos não criam dois procedimentos.
    await prisma.patientProcedure.upsert({
      where: { quoteId: quote.id },
      update: { name: quote.items, ...(can(user.role, "clinical:write", user.rolePermissions) ? { professional: user.name } : {}), journeyId: quote.journeyId },
      create: { clinicId: user.clinicId, patientId: quote.patientId, journeyId: quote.journeyId, quoteId: quote.id, name: quote.items, professional: quoteProfessional(user.role, user.name, user.rolePermissions), performedAt: new Date() },
    });
  } else if (quote && body?.status && quote.patientId) {
    // Pagamento desfeito: remove o procedimento gerado pelo orçamento, desde que ainda não tenha fotos.
    await prisma.patientProcedure.deleteMany({ where: { clinicId: user.clinicId, quoteId: quote.id, beforePhoto: null, afterPhoto: null, photoSessions: { none: {} } } });
  }
  return NextResponse.json({ quote: quote ? serializeQuote(quote) : null });
}

async function quoteDetails(lines: QuoteLineInput[], clinicId: string, userId: string, role: string) {
  const [procedures, costSnapshot] = await Promise.all([
    prisma.procedure.findMany({ where: { clinicId }, select: { id: true, name: true, price: true } }),
    quoteCostSnapshot(clinicId, userId, role),
  ]);
  const calculated = calculateQuote(lines, procedures.map((procedure) => ({ id: procedure.id, name: procedure.name, priceCents: toCents(procedure.price) })), costSnapshot);
  return calculated ? { ...calculated, costs: costSnapshot } : null;
}
