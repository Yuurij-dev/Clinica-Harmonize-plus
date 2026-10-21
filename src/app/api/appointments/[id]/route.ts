import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { appointmentDay, appointmentHasPassed, appointmentInstant, clinicNow, parseAppointmentDay, parseClockMinutes } from "@/lib/clinic-time";
import { prisma } from "@/lib/prisma";
import { DUPLICATE_PROCEDURE_APPOINTMENT_MESSAGE, procedureAppointmentVariants } from "@/lib/procedure-session-rules";
import { appointmentDeleteAllowed, appointmentStatusChangeAllowed, can, runningAppointmentStatuses } from "@/lib/permissions";

const appointmentStatuses = ["Agendado", "Em atendimento", "Atendido", "Finalizado", "Faltou", "Cancelado"];

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null) as { status?: string; date?: string; time?: string; procedure?: string; professional?: string; notes?: string } | null;
  if (!body || [body.status, body.date, body.time, body.procedure, body.professional, body.notes].some((value) => value !== undefined && typeof value !== "string")) {
    return NextResponse.json({ message: "Dados do agendamento inválidos." }, { status: 400 });
  }
  if (!body?.status && !body?.date && !body?.time && !body?.procedure && !body?.professional && body?.notes === undefined) return NextResponse.json({ message: "Informe uma alteração para o agendamento." }, { status: 400 });
  if (body.status && !appointmentStatuses.includes(body.status)) return NextResponse.json({ message: "Status inválido." }, { status: 400 });
  if (body.time && parseClockMinutes(body.time) === null) return NextResponse.json({ message: "Horário inválido." }, { status: 400 });
  const day = body.date ? parseAppointmentDay(body.date) : null;
  if (body.date && !day) return NextResponse.json({ message: "Data inválida." }, { status: 400 });
  const id = (await params).id;
  const current = await prisma.appointment.findFirst({ where: { id, clinicId: user.clinicId }, select: { status: true, date: true, time: true, patientId: true, journeyId: true, procedure: true } });
  if (!current) return NextResponse.json({ message: "Agendamento não encontrado." }, { status: 404 });
  if (body.notes !== undefined && body.notes.length > 500) return NextResponse.json({ message: "A observação deve ter até 500 caracteres." }, { status: 400 });
  if (!appointmentStatusChangeAllowed(user.role, current.status, body.status)) {
    return NextResponse.json({ message: "O atendimento é conduzido pela equipe clínica." }, { status: 403 });
  }
  if ((day || body.time) && appointmentHasPassed({ date: appointmentInstant(day ?? appointmentDay(current.date)), time: body.time ?? current.time }, clinicNow())) {
    return NextResponse.json({ message: "Não é possível alterar para uma data ou horário que já passou." }, { status: 400 });
  }
  // Status resultante ativo + procedimento (renomeado ou reaberto) não pode duplicar outro agendamento ativo da jornada.
  const activeStatuses = ["Agendado", "Em atendimento"];
  const nextStatus = body.status ?? current.status;
  const nextProcedure = body.procedure?.trim() || current.procedure;
  const becomesActive = activeStatuses.includes(nextStatus) && (!activeStatuses.includes(current.status) || nextProcedure !== current.procedure);
  const variants = becomesActive && current.journeyId ? procedureAppointmentVariants(nextProcedure) : null;
  const journeyId = current.journeyId;
  const result = await prisma.$transaction(async (tx) => {
    if (variants && journeyId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${journeyId}))`;
      const duplicate = await tx.appointment.findFirst({ where: { clinicId: user.clinicId, patientId: current.patientId, journeyId, id: { not: id }, procedure: { in: variants }, status: { in: activeStatuses } }, select: { id: true } });
      if (duplicate) return "duplicate" as const;
    }
    return tx.appointment.updateMany({ where: { id, clinicId: user.clinicId, ...(can(user.role, "appointment:run") ? {} : { status: { notIn: [...runningAppointmentStatuses] } }) }, data: {
      ...(body.status ? { status: body.status } : {}),
      ...(day ? { date: appointmentInstant(day) } : {}),
      ...(body.time ? { time: body.time } : {}),
      ...(body.procedure?.trim() ? { procedure: body.procedure.trim() } : {}),
      ...(body.professional?.trim() ? { professional: body.professional.trim() } : {}),
      ...(body.notes !== undefined ? { notes: body.notes.trim() } : {}),
    } });
  });
  if (result === "duplicate") return NextResponse.json({ message: DUPLICATE_PROCEDURE_APPOINTMENT_MESSAGE }, { status: 409 });
  if (result.count === 0) return NextResponse.json({ message: "O atendimento já foi iniciado." }, { status: 409 });
  // Todo atendimento finalizado (na tela ou automaticamente pela agenda) fica com a conferência de materiais pendente.
  if (body.status === "Atendido") await prisma.appointment.updateMany({ where: { id, clinicId: user.clinicId, materialsCheck: null }, data: { materialsCheck: "pending" } });
  const appointment = await prisma.appointment.findFirst({ where: { id, clinicId: user.clinicId }, include: { patient: { select: { name: true } } } });
  return NextResponse.json({ appointment });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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
}
