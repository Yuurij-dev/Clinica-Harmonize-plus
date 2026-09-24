import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null) as { status?: string } | null;
  if (!body?.status) return NextResponse.json({ message: "Status obrigatório." }, { status: 400 });
  const id = (await params).id;
  const result = await prisma.appointment.updateMany({ where: { id, clinicId: user.clinicId }, data: { status: body.status } });
  if (result.count === 0) return NextResponse.json({ message: "Agendamento não encontrado." }, { status: 404 });
  const appointment = await prisma.appointment.findFirst({ where: { id, clinicId: user.clinicId }, include: { patient: { select: { name: true } } } });
  return NextResponse.json({ appointment });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const id = (await params).id;
  const result = await prisma.appointment.deleteMany({ where: { id, clinicId: user.clinicId } });
  if (result.count === 0) return NextResponse.json({ message: "Agendamento não encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
