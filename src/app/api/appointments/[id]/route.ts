import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { appointmentDay, appointmentHasPassed, appointmentInstant, clinicNow, parseAppointmentDay, parseClockMinutes } from "@/lib/clinic-time";
import { prisma } from "@/lib/prisma";
import { appointmentDeleteAllowed, appointmentStatusChangeAllowed, can, runningAppointmentStatuses } from "@/lib/permissions";
import { withSaveErrors } from "@/lib/save-errors";

const appointmentStatuses = ["Agendado", "Em atendimento", "Atendido", "Finalizado", "Faltou", "Cancelado"];

export const PATCH = withSaveErrors("atualizar o agendamento", async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null) as { status?: string; date?: string; time?: string; procedure?: string; professional?: string; notes?: string } | null;
  if (!body?.status && !body?.date && !body?.time && !body?.procedure && !body?.professional && body?.notes === undefined) return NextResponse.json({ message: "Informe uma alteração para o agendamento." }, { status: 400 });
  if (body.status && !appointmentStatuses.includes(body.status)) return NextResponse.json({ message: "Status inválido." }, { status: 400 });
  if (body.time && parseClockMinutes(body.time) === null) return NextResponse.json({ message: "Horário inválido." }, { status: 400 });
  const day = body.date ? parseAppointmentDay(body.date) : null;
  if (body.date && !day) return NextResponse.json({ message: "Data inválida." }, { status: 400 });
  const id = (await params).id;
  const current = await prisma.appointment.findFirst({ where: { id, clinicId: user.clinicId }, select: { status: true, date: true, time: true } });
  if (!current) return NextResponse.json({ message: "Agendamento não encontrado." }, { status: 404 });
  if (!appointmentStatusChangeAllowed(user.role, current.status, body.status)) {
    return NextResponse.json({ message: "O atendimento é conduzido pela equipe clínica." }, { status: 403 });
  }
  if ((day || body.time) && appointmentHasPassed({ date: appointmentInstant(day ?? appointmentDay(current.date)), time: body.time ?? current.time }, clinicNow())) {
    return NextResponse.json({ message: "Não é possível alterar para uma data ou horário que já passou." }, { status: 400 });
  }
  const result = await prisma.appointment.updateMany({ where: { id, clinicId: user.clinicId, ...(can(user.role, "appointment:run") ? {} : { status: { notIn: [...runningAppointmentStatuses] } }) }, data: {
    ...(body.status ? { status: body.status } : {}),
    ...(day ? { date: appointmentInstant(day) } : {}),
    ...(body.time ? { time: body.time } : {}),
    ...(body.procedure?.trim() ? { procedure: body.procedure.trim() } : {}),
    ...(body.professional?.trim() ? { professional: body.professional.trim() } : {}),
    ...(body.notes !== undefined ? { notes: body.notes.trim() } : {}),
  } });
  if (result.count === 0) return NextResponse.json({ message: "O atendimento já foi iniciado." }, { status: 409 });
  // Todo atendimento finalizado (na tela ou automaticamente pela agenda) fica com a conferência de materiais pendente.
  if (body.status === "Atendido") await prisma.appointment.updateMany({ where: { id, clinicId: user.clinicId, materialsCheck: null }, data: { materialsCheck: "pending" } });
  const appointment = await prisma.appointment.findFirst({ where: { id, clinicId: user.clinicId }, include: { patient: { select: { name: true } } } });
  return NextResponse.json({ appointment });
});

export const DELETE = withSaveErrors("excluir o agendamento", async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const id = (await params).id;
  const current = await prisma.appointment.findFirst({ where: { id, clinicId: user.clinicId }, select: { status: true } });
  if (!current) return NextResponse.json({ message: "Agendamento não encontrado." }, { status: 404 });
  if (!appointmentDeleteAllowed(user.role, current.status)) {
    return NextResponse.json({ message: "O atendimento é conduzido pela equipe clínica." }, { status: 403 });
  }
  const result = await prisma.appointment.deleteMany({ where: { id, clinicId: user.clinicId, ...(can(user.role, "appointment:run") ? {} : { status: { notIn: [...runningAppointmentStatuses] } }) } });
  if (result.count === 0) return NextResponse.json({ message: "O atendimento já foi iniciado." }, { status: 409 });
  return NextResponse.json({ ok: true });
});
