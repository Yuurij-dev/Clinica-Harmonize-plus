import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const payments = await prisma.payment.findMany({ where: { clinicId: user.clinicId }, orderBy: { date: "desc" }, include: { patient: { select: { name: true } } } });
  return NextResponse.json({ payments });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const body = await request.json().catch(() => null) as { patient?: string; patientId?: string; value?: number; method?: string; status?: string; installments?: string } | null;
  const patient = body?.patientId ? await prisma.patient.findFirst({ where: { id: body.patientId, clinicId: user.clinicId } }) : body?.patient ? await prisma.patient.findFirst({ where: { name: body.patient, clinicId: user.clinicId } }) : null;
  const value = Number(body?.value);
  if (!patient || !Number.isFinite(value) || !body?.method || !body.installments) return NextResponse.json({ message: "Selecione um paciente e preencha o pagamento." }, { status: 400 });
  const payment = await prisma.payment.create({ data: { clinicId: user.clinicId, patientId: patient.id, value: Math.max(0, Math.round(value)), method: body.method, status: body.status || "Pago", installments: body.installments }, include: { patient: { select: { name: true } } } });
  return NextResponse.json({ payment }, { status: 201 });
}
