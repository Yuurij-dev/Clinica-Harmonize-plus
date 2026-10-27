import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { denyUnless } from "@/lib/api-guards";
import { serializePayment, toCents } from "@/lib/finance";
import { ensurePatientJourney } from "@/lib/patient-journey";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user.role, "payments:access");
  if (denied) return denied;
  // shortcut: a tela de Pagamentos filtra no navegador só os 200 mais recentes; paginar no servidor se clínicas passarem disso.
  const payments = await prisma.payment.findMany({
    where: { clinicId: user.clinicId },
    orderBy: { date: "desc" },
    take: 200,
    select: { id: true, valueCents: true, method: true, date: true, status: true, installments: true, patientId: true, patient: { select: { name: true } } },
  });
  return NextResponse.json({ payments: payments.map(serializePayment) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user.role, "payments:access");
  if (denied) return denied;
  const body = await request.json().catch(() => null) as { patientId?: string; journeyId?: string; value?: number; method?: string; status?: string; installments?: string } | null;
  const patient = body?.patientId ? await prisma.patient.findFirst({ where: { id: body.patientId, clinicId: user.clinicId } }) : null;
  const value = Number(body?.value);
  if (!patient || !Number.isFinite(value) || !body?.method || !body.installments) return NextResponse.json({ message: "Selecione um paciente e preencha o pagamento." }, { status: 400 });
  if (body.journeyId && !await prisma.patientJourney.findFirst({ where: { id: body.journeyId, patientId: patient.id, clinicId: user.clinicId, archivedAt: null }, select: { id: true } })) {
    return NextResponse.json({ message: "Tratamento não encontrado." }, { status: 404 });
  }
  const journey = await ensurePatientJourney(patient.id, user.clinicId, body.journeyId);
  const payment = await prisma.payment.create({ data: { clinicId: user.clinicId, patientId: patient.id, journeyId: journey.id, valueCents: toCents(value), method: body.method, status: body.status || "Pago", installments: body.installments }, include: { patient: { select: { name: true } } } });
  return NextResponse.json({ payment: serializePayment(payment) }, { status: 201 });
}
