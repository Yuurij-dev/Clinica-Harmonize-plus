import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { denyUnless } from "@/lib/api-guards";
import { clinicToday, parseDateOnly } from "@/lib/clinic-time";
import { maxPaymentReais, serializePayment, toCents } from "@/lib/finance";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user, "payments:delete");
  if (denied) return denied;
  const { id } = await params;
  const result = await prisma.payment.deleteMany({ where: { id, clinicId: user.clinicId } });
  if (!result.count) return NextResponse.json({ message: "Pagamento não encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// O dia do recebimento é guardado como meio-dia em São Paulo (mesmo dia em UTC e no fuso da clínica).
const dayInstant = (day: string) => new Date(`${day}T12:00:00-03:00`);

// { action: "receive", receivedOn? }: Pendente/Parcial -> Pago na data informada (padrão hoje).
// Sem action: edita value (reais), method e/ou date (AAAA-MM-DD). Não muda paciente nem tratamento;
// o status do orçamento é decidido pela tela do paciente, não derivado destes pagamentos.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user, "payments:manage");
  if (denied) return denied;
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ message: "Dados inválidos." }, { status: 400 });
  const payment = await prisma.payment.findFirst({ where: { id, clinicId: user.clinicId }, select: { id: true, status: true } });
  if (!payment) return NextResponse.json({ message: "Pagamento não encontrado." }, { status: 404 });

  const data: { status?: string; date?: Date; valueCents?: number; method?: string } = {};
  if (body.action === "receive") {
    if (payment.status === "Pago") return NextResponse.json({ message: "Este pagamento já foi recebido." }, { status: 409 });
    const receivedOn = body.receivedOn === undefined || body.receivedOn === null ? clinicToday() : typeof body.receivedOn === "string" && parseDateOnly(body.receivedOn) ? body.receivedOn : null;
    if (!receivedOn) return NextResponse.json({ message: "Informe a data do recebimento." }, { status: 400 });
    if (receivedOn > clinicToday()) return NextResponse.json({ message: "A data do recebimento não pode ser futura." }, { status: 400 });
    data.status = "Pago";
    data.date = dayInstant(receivedOn);
  } else if (body.action !== undefined) {
    return NextResponse.json({ message: "Ação inválida." }, { status: 400 });
  } else {
    if (body.value !== undefined) {
      const value = Number(body.value);
      if (typeof body.value === "boolean" || body.value === null || body.value === "" || !Number.isFinite(value) || value < 0) return NextResponse.json({ message: "Informe um valor válido." }, { status: 400 });
      if (value > maxPaymentReais) return NextResponse.json({ message: "O valor máximo é R$ 21.474.836,47." }, { status: 400 });
      data.valueCents = toCents(value);
    }
    if (body.method !== undefined) {
      if (typeof body.method !== "string" || !body.method.trim()) return NextResponse.json({ message: "Informe a forma de pagamento." }, { status: 400 });
      data.method = body.method.trim();
    }
    if (body.date !== undefined) {
      if (typeof body.date !== "string" || !parseDateOnly(body.date)) return NextResponse.json({ message: "Informe uma data válida." }, { status: 400 });
      data.date = dayInstant(body.date);
    }
    if (!Object.keys(data).length) return NextResponse.json({ message: "Nada para atualizar." }, { status: 400 });
  }
  // Só grava se o status ainda for o lido acima: dois cliques simultâneos em "receber" dão 200 e 409.
  try {
    const updated = await prisma.payment.update({ where: { id: payment.id, clinicId: user.clinicId, status: payment.status }, data, select: { id: true, clinicId: true, patientId: true, journeyId: true, valueCents: true, method: true, date: true, status: true, installments: true, createdAt: true, updatedAt: true, patient: { select: { name: true } } } });
    return NextResponse.json({ payment: serializePayment(updated) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return NextResponse.json({ message: "Este pagamento acabou de ser alterado. Atualize a tela." }, { status: 409 });
    throw error;
  }
}
