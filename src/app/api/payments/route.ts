import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { denyUnless } from "@/lib/api-guards";
import { listLimit, listPeriodFilter, serializePayment, toCents } from "@/lib/finance";
import { ensurePatientJourney } from "@/lib/patient-journey";

// Os mesmos status do formulário de Pagamentos; o resumo financeiro só conta "Pago" como recebido.
const paymentStatuses = ["Pago", "Parcial", "Pendente"];

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user.role, "payments:access");
  if (denied) return denied;
  const date = listPeriodFilter(new URL(request.url).searchParams);
  if (!date) return NextResponse.json({ message: "Período inválido." }, { status: 400 });
  const payments = await prisma.payment.findMany({
    where: { clinicId: user.clinicId, date },
    orderBy: [{ date: "desc" }, { id: "asc" }],
    take: listLimit + 1,
    select: { id: true, valueCents: true, method: true, date: true, status: true, installments: true, patientId: true, patient: { select: { name: true } } },
  });
  return NextResponse.json({ payments: payments.slice(0, listLimit).map(serializePayment), hasMore: payments.length > listLimit });
}

export async function POST(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user.role, "payments:access");
  if (denied) return denied;
  const body = await request.json().catch(() => null) as { patientId?: string; journeyId?: string; value?: number; method?: string; status?: string; installments?: string } | null;
  const patient = body?.patientId ? await prisma.patient.findFirst({ where: { id: body.patientId, clinicId: user.clinicId } }) : null;
  const value = Number(body?.value);
  const status = body?.status || "Pago";
  // Zero vale: orçamento de cortesia (desconto total) também registra o recebimento ao ser confirmado.
  if (!patient || !Number.isFinite(value) || value < 0 || !paymentStatuses.includes(status) || !body?.method || !body.installments) return NextResponse.json({ message: "Selecione um paciente e preencha o pagamento." }, { status: 400 });
  if (body.journeyId && !await prisma.patientJourney.findFirst({ where: { id: body.journeyId, patientId: patient.id, clinicId: user.clinicId, archivedAt: null }, select: { id: true } })) {
    return NextResponse.json({ message: "Tratamento não encontrado." }, { status: 404 });
  }
  const journey = await ensurePatientJourney(patient.id, user.clinicId, body.journeyId);
  const payment = await prisma.payment.create({ data: { clinicId: user.clinicId, patientId: patient.id, journeyId: journey.id, valueCents: toCents(value), method: body.method, status, installments: body.installments }, include: { patient: { select: { name: true } } } });
  return NextResponse.json({ payment: serializePayment(payment) }, { status: 201 });
}
