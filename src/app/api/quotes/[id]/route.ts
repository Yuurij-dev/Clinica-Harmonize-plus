import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const body = await request.json().catch(() => null) as { status?: string; items?: string; total?: number; paymentMethod?: string } | null;
  const id = (await params).id;
  const updateData = {
    ...(body?.items?.trim() ? { items: body.items.trim() } : {}),
    ...(typeof body?.total === "number" && Number.isFinite(body.total) ? { total: Math.max(0, Math.round(body.total)) } : {}),
    ...(body?.paymentMethod && ["Cartão de crédito", "Cartão de débito", "Pix"].includes(body.paymentMethod) ? { paymentMethod: body.paymentMethod } : {}),
    ...(body?.status ? { status: body.status } : {}),
  };
  const result = await prisma.quote.updateMany({ where: { id, clinicId: user.clinicId }, data: updateData });
  if (!result.count) return NextResponse.json({ message: "Orçamento não encontrado." }, { status: 404 });
  const quote = await prisma.quote.findFirst({ where: { id, clinicId: user.clinicId }, include: { patient: { select: { name: true } } } });
  if (quote && ["Aprovado", "Pago"].includes(quote.status) && quote.patientId) {
    const quoteMarker = `__quote:${quote.id}`;
    const existingRecord = await prisma.patientProcedure.findFirst({ where: { clinicId: user.clinicId, patientId: quote.patientId, notes: quoteMarker }, select: { id: true } });
    if (existingRecord) {
      await prisma.patientProcedure.update({ where: { id: existingRecord.id }, data: { name: quote.items, professional: user.name, journeyId: quote.journeyId } });
    } else {
      await prisma.patientProcedure.create({ data: { clinicId: user.clinicId, patientId: quote.patientId, journeyId: quote.journeyId, name: quote.items, professional: user.name, performedAt: new Date(), notes: quoteMarker } });
    }
  } else if (quote && body?.status && quote.patientId) {
    // Pagamento desfeito: remove o procedimento gerado pelo orçamento, desde que ainda não tenha fotos.
    await prisma.patientProcedure.deleteMany({ where: { clinicId: user.clinicId, patientId: quote.patientId, notes: `__quote:${quote.id}`, beforePhoto: null, afterPhoto: null, photoSessions: { none: {} } } });
  }
  return NextResponse.json({ quote });
}
