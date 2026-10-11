import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { serializeQuote, toCents } from "@/lib/finance";
import { prisma } from "@/lib/prisma";
import { can, quoteChangeAllowed, quoteProfessional } from "@/lib/permissions";
import { withSaveErrors } from "@/lib/save-errors";

export const PATCH = withSaveErrors("atualizar o orçamento", async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const body = await request.json().catch(() => null) as { status?: string; items?: string; total?: number; paymentMethod?: string } | null;
  const id = (await params).id;
  const existing = await prisma.quote.findFirst({ where: { id, clinicId: user.clinicId }, select: { status: true, items: true, totalCents: true, paymentMethod: true } });
  if (!existing) return NextResponse.json({ message: "Orçamento não encontrado." }, { status: 404 });
  const editsContent = Boolean(body?.items?.trim() && body.items.trim() !== existing.items)
    || Boolean(typeof body?.total === "number" && Number.isFinite(body.total) && toCents(body.total) !== existing.totalCents)
    || Boolean(body?.paymentMethod && body.paymentMethod !== existing.paymentMethod);
  if (!quoteChangeAllowed(user.role, { current: existing.status, next: body?.status, editsContent })) {
    return NextResponse.json({ message: "Orçamento já fechado: só administrador ou profissional pode alterar." }, { status: 403 });
  }
  const updateData = {
    ...(body?.items?.trim() ? { items: body.items.trim() } : {}),
    ...(typeof body?.total === "number" && Number.isFinite(body.total) ? { totalCents: toCents(body.total) } : {}),
    ...(body?.paymentMethod && ["Cartão de crédito", "Cartão de débito", "Pix"].includes(body.paymentMethod) ? { paymentMethod: body.paymentMethod } : {}),
    ...(body?.status ? { status: body.status } : {}),
  };
  const result = await prisma.quote.updateMany({ where: { id, clinicId: user.clinicId, ...(can(user.role, "quote:edit-closed") ? {} : { status: existing.status }) }, data: updateData });
  if (!result.count) return NextResponse.json({ message: "O orçamento foi alterado; recarregue a página." }, { status: 409 });
  const quote = await prisma.quote.findFirst({ where: { id, clinicId: user.clinicId }, include: { patient: { select: { name: true } } } });
  if (quote && ["Aprovado", "Pago"].includes(quote.status) && quote.patientId) {
    // quoteId é único: dois PATCH simultâneos não criam dois procedimentos.
    await prisma.patientProcedure.upsert({
      where: { quoteId: quote.id },
      update: { name: quote.items, ...(can(user.role, "clinical:write") ? { professional: user.name } : {}), journeyId: quote.journeyId },
      create: { clinicId: user.clinicId, patientId: quote.patientId, journeyId: quote.journeyId, quoteId: quote.id, name: quote.items, professional: quoteProfessional(user.role, user.name), performedAt: new Date() },
    });
  } else if (quote && body?.status && quote.patientId) {
    // Pagamento desfeito: remove o procedimento gerado pelo orçamento, desde que ainda não tenha fotos.
    await prisma.patientProcedure.deleteMany({ where: { clinicId: user.clinicId, quoteId: quote.id, beforePhoto: null, afterPhoto: null, photoSessions: { none: {} } } });
  }
  return NextResponse.json({ quote: quote ? serializeQuote(quote) : null });
});
