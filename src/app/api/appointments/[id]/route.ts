import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null) as { status?: string; date?: string; time?: string; procedure?: string; professional?: string; notes?: string } | null;
  if (!body?.status && !body?.date && !body?.time && !body?.procedure && !body?.professional && body?.notes === undefined) return NextResponse.json({ message: "Informe uma alteração para o agendamento." }, { status: 400 });
  const id = (await params).id;
  const date = body?.date ? new Date(body.date) : null;
  if (date && Number.isNaN(date.getTime())) return NextResponse.json({ message: "Data inválida." }, { status: 400 });
  if (date && body?.time && appointmentDateHasPassed(body.date as string, body.time)) return NextResponse.json({ message: "Não é possível alterar para uma data ou horário que já passou." }, { status: 400 });
  const result = await prisma.appointment.updateMany({ where: { id, clinicId: user.clinicId }, data: {
    ...(body?.status ? { status: body.status } : {}),
    ...(date ? { date } : {}),
    ...(body?.time ? { time: body.time } : {}),
    ...(body?.procedure?.trim() ? { procedure: body.procedure.trim() } : {}),
    ...(body?.professional?.trim() ? { professional: body.professional.trim() } : {}),
    ...(body?.notes !== undefined ? { notes: body.notes.trim() } : {}),
  } });
  if (result.count === 0) return NextResponse.json({ message: "Agendamento não encontrado." }, { status: 404 });
  const appointment = await prisma.appointment.findFirst({ where: { id, clinicId: user.clinicId }, include: { patient: { select: { name: true } } } });
  return NextResponse.json({ appointment });
}

function appointmentDateHasPassed(dateValue: string, time: string) {
  const nowParts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const nowValues = Object.fromEntries(nowParts.map((part) => [part.type, part.value]));
  const today = `${nowValues.year}-${nowValues.month}-${nowValues.day}`;
  const requestedDate = dateValue.slice(0, 10);
  if (requestedDate < today) return true;
  if (requestedDate > today) return false;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes <= Number(nowValues.hour) * 60 + Number(nowValues.minute);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const id = (await params).id;
  const result = await prisma.appointment.deleteMany({ where: { id, clinicId: user.clinicId } });
  if (result.count === 0) return NextResponse.json({ message: "Agendamento não encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
