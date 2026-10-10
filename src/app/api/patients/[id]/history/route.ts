import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { dateOnly } from "@/lib/clinic-time";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const requestedTab = new URL(request.url).searchParams.get("tab");
  const requestedJourneyId = new URL(request.url).searchParams.get("journeyId");
  const patientId = (await params).id;
  const journeyId = requestedTab === "Histórico" ? undefined : requestedJourneyId || undefined;
  const includeAppointments = ["Procedimentos", "Agendamentos", "Histórico"].includes(requestedTab ?? "");
  const includePayments = ["Pagamentos", "Histórico"].includes(requestedTab ?? "");
  const includeQuotes = ["Procedimentos", "Agendamentos", "Histórico"].includes(requestedTab ?? "");
  const includeProcedureRecords = ["Procedimentos", "Histórico"].includes(requestedTab ?? "");
  const includeObservations = requestedTab === "Histórico";
  const includeProcedurePhotos = requestedTab === "Procedimentos" || requestedTab === "Histórico";
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: user.clinicId },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  if (journeyId && !await prisma.patientJourney.findFirst({ where: { id: journeyId, patientId, clinicId: user.clinicId }, select: { id: true } })) {
    return NextResponse.json({ message: "Jornada não encontrada." }, { status: 404 });
  }

  const [appointments, payments, quotes, procedureRecords, clinic, materialMovements, pendingMaterials, observations] = await Promise.all([
    includeAppointments ? prisma.appointment.findMany({ where: { patientId, clinicId: user.clinicId, ...(journeyId ? { journeyId } : {}) }, orderBy: [{ date: "desc" }, { time: "desc" }] }) : Promise.resolve([]),
    includePayments ? prisma.payment.findMany({ where: { patientId, clinicId: user.clinicId, ...(journeyId ? { journeyId } : {}) }, orderBy: { date: "desc" } }) : Promise.resolve([]),
    includeQuotes ? prisma.quote.findMany({ where: { patientId, clinicId: user.clinicId, ...(journeyId ? { journeyId } : {}) }, orderBy: { createdAt: "desc" }, select: { id: true, items: true, status: true, createdAt: true } }) : Promise.resolve([]),
    includeProcedureRecords ? prisma.patientProcedure.findMany({ where: { patientId, clinicId: user.clinicId, ...(journeyId ? { journeyId } : {}) }, orderBy: { performedAt: "desc" }, select: { id: true, name: true, professional: true, performedAt: true, notes: true, beforePhoto: true, afterPhoto: true, photoSessions: { orderBy: { createdAt: "asc" }, select: { id: true, name: true, beforePhoto: true, afterPhoto: true, createdAt: true } } } }) : Promise.resolve([]),
    prisma.clinic.findUnique({ where: { id: user.clinicId }, select: { appointmentToleranceMinutes: true } }),
    // Materiais usados no paciente (rastreio): saídas de atendimento, sem custo.
    includeProcedureRecords ? prisma.stockMovement.findMany({ where: { clinicId: user.clinicId, patientId, type: "attendance" }, orderBy: { attendanceDate: "desc" }, select: { id: true, appointmentId: true, quantity: true, attendanceKind: true, attendanceName: true, attendanceDate: true, product: { select: { name: true, unit: true } }, lot: { select: { code: true, expiresOn: true } }, reversedBy: { select: { id: true } } } }) : Promise.resolve([]),
    includeProcedureRecords ? prisma.pendingStockOutput.findMany({ where: { clinicId: user.clinicId, patientId, status: "pending" }, select: { id: true, appointmentId: true, quantity: true, attendanceKind: true, attendanceName: true, attendanceDate: true, product: { select: { name: true, unit: true } } } }) : Promise.resolve([]),
    includeObservations ? prisma.patientObservation.findMany({ where: { patientId, clinicId: user.clinicId }, orderBy: { createdAt: "desc" }, select: { id: true, text: true, authorName: true, createdAt: true } }) : Promise.resolve([]),
  ]);
  const now = clinicNow();
  const toleranceMinutes = clinic?.appointmentToleranceMinutes ?? 15;
  const overdue = appointments.filter((appointment) => appointment.status === "Agendado" && appointmentHasPassed(appointment.date, appointment.time, now, toleranceMinutes));
  if (overdue.length) {
    await prisma.appointment.updateMany({ where: { clinicId: user.clinicId, id: { in: overdue.map((appointment) => appointment.id) }, ...(journeyId ? { journeyId } : {}) }, data: { status: "Faltou" } });
  }
  const updatedAppointments = appointments.map((appointment) => overdue.some((item) => item.id === appointment.id) ? { ...appointment, status: "Faltou" } : appointment);

  const responseProcedureRecords = procedureRecords.map((procedure) => ({
    ...procedure,
    beforePhoto: includeProcedurePhotos ? procedure.beforePhoto : procedure.beforePhoto ? "__photo__" : null,
    afterPhoto: includeProcedurePhotos ? procedure.afterPhoto : procedure.afterPhoto ? "__photo__" : null,
    photoSessions: procedure.photoSessions.map((session) => ({
      ...session,
      beforePhoto: includeProcedurePhotos ? session.beforePhoto : session.beforePhoto ? "__photo__" : null,
      afterPhoto: includeProcedurePhotos ? session.afterPhoto : session.afterPhoto ? "__photo__" : null,
    })),
  }));

  const materialsUsed = [
    ...materialMovements.map((movement) => ({ id: movement.id, appointmentId: movement.appointmentId, name: movement.product.name, unit: movement.product.unit, quantity: -movement.quantity, lotCode: movement.lot.code, lotExpiresOn: dateOnly(movement.lot.expiresOn), kind: movement.attendanceKind, attendanceName: movement.attendanceName, date: movement.attendanceDate, status: movement.reversedBy ? "reversed" : "used" })),
    ...pendingMaterials.map((item) => ({ id: item.id, appointmentId: item.appointmentId, name: item.product.name, unit: item.product.unit, quantity: item.quantity, lotCode: null, lotExpiresOn: null, kind: item.attendanceKind, attendanceName: item.attendanceName, date: item.attendanceDate, status: "pending" })),
  ];

  return NextResponse.json({ patient: { id: patient.id, appointments: updatedAppointments, payments, quotes, procedureRecords: responseProcedureRecords, materialsUsed, observations, appointmentToleranceMinutes: toleranceMinutes } });
}

function clinicNow() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, minutes: Number(values.hour) * 60 + Number(values.minute) };
}

function appointmentHasPassed(date: Date, time: string, now: { date: string; minutes: number }, toleranceMinutes: number) {
  const appointmentDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  if (appointmentDate < now.date) return true;
  if (appointmentDate > now.date) return false;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes + toleranceMinutes <= now.minutes;
}
