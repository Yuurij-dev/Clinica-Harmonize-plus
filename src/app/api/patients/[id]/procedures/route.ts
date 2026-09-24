import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientId = (await params).id;
  const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId: user.clinicId }, select: { id: true } });
  if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const procedures = await prisma.patientProcedure.findMany({ where: { patientId, clinicId: user.clinicId }, orderBy: { performedAt: "desc" } });
  return NextResponse.json({ procedures });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientId = (await params).id;
  const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId: user.clinicId }, select: { id: true } });
  if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });

  const body = await request.json().catch(() => null) as { name?: string; professional?: string; performedAt?: string; notes?: string; beforePhoto?: string; afterPhoto?: string } | null;
  const name = body?.name?.trim() ?? "";
  const professional = body?.professional?.trim() ?? "";
  const performedAt = body?.performedAt ? new Date(`${body.performedAt}T12:00:00`) : new Date();
  if (!name || !professional || Number.isNaN(performedAt.getTime())) return NextResponse.json({ message: "Informe o procedimento, profissional e data." }, { status: 400 });

  const procedure = await prisma.patientProcedure.create({
    data: { clinicId: user.clinicId, patientId, name, professional, performedAt, notes: body?.notes?.trim() ?? "", beforePhoto: body?.beforePhoto || null, afterPhoto: body?.afterPhoto || null },
  });
  return NextResponse.json({ procedure }, { status: 201 });
}
