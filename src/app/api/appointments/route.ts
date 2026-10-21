import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { appointmentInstant, appointmentSlotError, clinicNow, parseAppointmentDay } from "@/lib/clinic-time";
import { prisma } from "@/lib/prisma";
import { ensurePatientJourney } from "@/lib/patient-journey";
import { DUPLICATE_PROCEDURE_APPOINTMENT_MESSAGE, procedureAppointmentVariants } from "@/lib/procedure-session-rules";

export async function POST(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null) as {
    patientId?: string;
    journeyId?: string;
    procedure?: string;
    professional?: string;
    time?: string;
    date?: string;
    notes?: string;
  } | null;
  const textFields = body ? [body.patientId, body.journeyId, body.procedure, body.professional, body.time, body.date, body.notes] : [];
  if (!body || textFields.some((value) => value !== undefined && typeof value !== "string")) {
    return NextResponse.json({ message: "Dados do agendamento inválidos." }, { status: 400 });
  }
  if (!body?.patientId || !body.procedure || !body.professional || !body.time) {
    return NextResponse.json({ message: "Selecione um paciente, procedimento, profissional e horário." }, { status: 400 });
  }

  const patient = await prisma.patient.findFirst({ where: { id: body.patientId, clinicId: user.clinicId } });
  if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  if (body.journeyId && !await prisma.patientJourney.findFirst({ where: { id: body.journeyId, patientId: patient.id, clinicId: user.clinicId, archivedAt: null }, select: { id: true } })) {
    return NextResponse.json({ message: "Tratamento não encontrado." }, { status: 404 });
  }

  const now = clinicNow();
  const day = body.date ? parseAppointmentDay(body.date) : now.date;
  if (!day) return NextResponse.json({ message: "Data inválida." }, { status: 400 });

  const [clinic, procedure] = await Promise.all([
    prisma.clinic.findUnique({ where: { id: user.clinicId }, select: { openingTime: true, closingTime: true } }),
    prisma.procedure.findFirst({ where: { clinicId: user.clinicId, name: body.procedure }, select: { durationMinutes: true } }),
  ]);
  const openingTime = clinic?.openingTime ?? "08:00";
  const closingTime = clinic?.closingTime ?? "19:00";
  const durationMinutes = procedure?.durationMinutes ?? 60;
  const slotError = appointmentSlotError(day, body.time, openingTime, closingTime, now, durationMinutes);
  if (slotError) return NextResponse.json({ message: slotError }, { status: 400 });

  if ((body.notes?.length ?? 0) > 500) return NextResponse.json({ message: "A observação deve ter até 500 caracteres." }, { status: 400 });

  const journey = await ensurePatientJourney(patient.id, user.clinicId, body.journeyId);
  const variants = procedureAppointmentVariants(body.procedure);
  const procedureName = body.procedure;
  // Evita marcar o mesmo procedimento (nome puro ou "Procedimento - X") duas vezes na jornada; a trava serializa cliques simultâneos.
  const appointment = await prisma.$transaction(async (tx) => {
    if (variants) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${journey.id}))`;
      const duplicate = await tx.appointment.findFirst({ where: { clinicId: user.clinicId, patientId: patient.id, journeyId: journey.id, procedure: { in: variants }, status: { in: ["Agendado", "Em atendimento"] } }, select: { id: true } });
      if (duplicate) return null;
    }
    return tx.appointment.create({
      data: {
        date: appointmentInstant(day),
        time: body.time!,
        patientId: patient.id,
        journeyId: journey.id,
        procedure: procedureName,
        professional: body.professional!,
        notes: body.notes?.trim() ?? "",
        status: "Agendado",
        clinicId: user.clinicId,
      },
      include: { patient: { select: { name: true } } },
    });
  });
  if (!appointment) return NextResponse.json({ message: DUPLICATE_PROCEDURE_APPOINTMENT_MESSAGE }, { status: 409 });
  return NextResponse.json({ appointment }, { status: 201 });
}
