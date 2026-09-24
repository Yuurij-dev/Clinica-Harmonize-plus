import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const body = await request.json().catch(() => null) as { status?: string } | null;
  const id = (await params).id;
  const result = await prisma.quote.updateMany({ where: { id, clinicId: user.clinicId }, data: { status: body?.status || "Enviado" } });
  if (!result.count) return NextResponse.json({ message: "Orçamento não encontrado." }, { status: 404 });
  const quote = await prisma.quote.findFirst({ where: { id, clinicId: user.clinicId }, include: { patient: { select: { name: true } } } });
  if (quote && ["Aprovado", "Pago"].includes(quote.status) && quote.patientId) {
    const quoteMarker = `__quote:${quote.id}`;
    const existingRecord = await prisma.patientProcedure.findFirst({ where: { clinicId: user.clinicId, patientId: quote.patientId, notes: quoteMarker }, select: { id: true } });
    if (existingRecord) {
      await prisma.patientProcedure.update({ where: { id: existingRecord.id }, data: { name: quote.items, professional: user.name } });
    } else {
      await prisma.patientProcedure.create({ data: { clinicId: user.clinicId, patientId: quote.patientId, name: quote.items, professional: user.name, performedAt: new Date(), notes: quoteMarker } });
    }
  }
  return NextResponse.json({ quote });
}
