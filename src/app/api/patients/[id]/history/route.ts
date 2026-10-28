import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyUnless } from "@/lib/api-guards";
import { appointmentHasPassed, clinicNow, dateOnly } from "@/lib/clinic-time";
import { serializePayment } from "@/lib/finance";
import { can, observationKindsFor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
  const requestedTab = new URL(request.url).searchParams.get("tab");
  const requestedJourneyId = new URL(request.url).searchParams.get("journeyId");
  const patientId = (await params).id;
  const clinical = can(user.role, "clinical:read", user.rolePermissions);
  const journeyId = requestedJourneyId || undefined;
  const includeAppointments = ["Procedimentos", "Agendamentos", "Histórico"].includes(requestedTab ?? "");
  const includePayments = ["Pagamentos", "Histórico"].includes(requestedTab ?? "");
  const includeQuotes = ["Procedimentos", "Agendamentos", "Histórico"].includes(requestedTab ?? "");
  const includeProcedureRecords = ["Procedimentos", "Histórico"].includes(requestedTab ?? "");
  const includeAppointmentProcedureNames = ["Procedimentos", "Agendamentos"].includes(requestedTab ?? "") && new URL(request.url).searchParams.get("includeProcedureNames") === "1";
  const includeObservations = requestedTab === "Histórico";
  const includeProcedurePhotos = clinical && (requestedTab === "Procedimentos" || requestedTab === "Histórico");
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: user.clinicId },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  if (journeyId && !await prisma.patientJourney.findFirst({ where: { id: journeyId, patientId, clinicId: user.clinicId }, select: { id: true } })) {
    return NextResponse.json({ message: "Jornada não encontrada." }, { status: 404 });
  }

  const [appointments, payments, quotes, procedureRecords, clinic, materialMovements, pendingMaterials, observations, appointmentProcedureNames] = await Promise.all([
    includeAppointments ? prisma.appointment.findMany({ where: { patientId, clinicId: user.clinicId, ...(journeyId ? { journeyId } : {}) }, orderBy: [{ date: "desc" }, { time: "desc" }] }) : Promise.resolve([]),
    includePayments ? prisma.payment.findMany({ where: { patientId, clinicId: user.clinicId, ...(journeyId ? { journeyId } : {}) }, orderBy: { date: "desc" } }) : Promise.resolve([]),
    includeQuotes ? prisma.quote.findMany({ where: { patientId, clinicId: user.clinicId, ...(journeyId ? { journeyId } : {}) }, orderBy: { createdAt: "desc" }, select: { id: true, items: true, status: true, createdAt: true } }) : Promise.resolve([]),
    includeProcedureRecords ? prisma.patientProcedure.findMany({ where: { patientId, clinicId: user.clinicId, ...(journeyId ? { journeyId } : {}) }, orderBy: { performedAt: "desc" }, select: { id: true, quoteId: true, name: true, professional: true, performedAt: true, ...(clinical ? { notes: true, sessions: { orderBy: { performedAt: "desc" as const }, select: { id: true, evaluationId: true, procedureName: true, professional: true, performedAt: true, status: true, technique: true, treatedAreas: true, durationMinutes: true, photos: true } } } : {}), beforePhoto: true, afterPhoto: true, photoSessions: { orderBy: { createdAt: "asc" }, select: { id: true, name: true, beforePhoto: true, afterPhoto: true, createdAt: true } } } }) : Promise.resolve([]),
    prisma.clinic.findUnique({ where: { id: user.clinicId }, select: { appointmentToleranceMinutes: true, autoMarkMissedAppointmentsEnabled: true } }),
    // Materiais usados no paciente (rastreio): saídas de atendimento, sem custo.
    includeProcedureRecords && clinical ? prisma.stockMovement.findMany({ where: { clinicId: user.clinicId, patientId, type: "attendance" }, orderBy: { attendanceDate: "desc" }, select: { id: true, appointmentId: true, procedureSessionId: true, quantity: true, attendanceKind: true, attendanceName: true, attendanceDate: true, product: { select: { name: true, kind: true, unit: true } }, lot: { select: { code: true, expiresOn: true } }, reversedBy: { select: { id: true } } } }) : Promise.resolve([]),
    includeProcedureRecords && clinical ? prisma.pendingStockOutput.findMany({ where: { clinicId: user.clinicId, patientId, status: "pending" }, select: { id: true, appointmentId: true, procedureSessionId: true, quantity: true, attendanceKind: true, attendanceName: true, attendanceDate: true, product: { select: { name: true, kind: true, unit: true } } } }) : Promise.resolve([]),
    includeObservations ? prisma.patientObservation.findMany({ where: { patientId, clinicId: user.clinicId, kind: { in: observationKindsFor(user.role, user.rolePermissions) } }, orderBy: { createdAt: "desc" }, select: { id: true, text: true, authorName: true, kind: true, createdAt: true } }) : Promise.resolve([]),
    includeAppointmentProcedureNames ? prisma.procedure.findMany({ where: { clinicId: user.clinicId }, select: { name: true } }) : Promise.resolve([]),
  ]);
  const sessionEvaluationIds = clinical ? [...new Set(procedureRecords.flatMap((procedure) => "sessions" in procedure ? procedure.sessions.map((session) => session.evaluationId) : []))] : [];
  const sessionEvaluationPhotos = sessionEvaluationIds.length && includeProcedurePhotos ? await prisma.evaluationPhoto.findMany({ where: { evaluationId: { in: sessionEvaluationIds } }, select: { evaluationId: true, id: true, name: true, imageUrl: true, width: true, height: true, category: true } }) : [];
  const photosByEvaluation = new Map<string, typeof sessionEvaluationPhotos>();
  for (const photo of sessionEvaluationPhotos) photosByEvaluation.set(photo.evaluationId, [...(photosByEvaluation.get(photo.evaluationId) ?? []), photo]);
  const now = clinicNow();
  const toleranceMinutes = clinic?.appointmentToleranceMinutes ?? 15;
  const overdue = clinic?.autoMarkMissedAppointmentsEnabled === false ? [] : appointments.filter((appointment) => appointment.status === "Agendado" && appointmentHasPassed(appointment, now, toleranceMinutes));
  if (overdue.length) {
    await prisma.appointment.updateMany({ where: { clinicId: user.clinicId, id: { in: overdue.map((appointment) => appointment.id) }, ...(journeyId ? { journeyId } : {}) }, data: { status: "Faltou" } });
  }
  const updatedAppointments = appointments.map((appointment) => overdue.some((item) => item.id === appointment.id) ? { ...appointment, status: "Faltou" } : appointment);

  const responseProcedureRecords = procedureRecords.map((procedure) => ({
    ...procedure,
    notes: clinical ? procedure.notes : "",
    beforePhoto: includeProcedurePhotos ? procedure.beforePhoto : procedure.beforePhoto ? "__photo__" : null,
    afterPhoto: includeProcedurePhotos ? procedure.afterPhoto : procedure.afterPhoto ? "__photo__" : null,
    photoSessions: procedure.photoSessions.map((session) => ({
      ...session,
      beforePhoto: includeProcedurePhotos ? session.beforePhoto : session.beforePhoto ? "__photo__" : null,
      afterPhoto: includeProcedurePhotos ? session.afterPhoto : session.afterPhoto ? "__photo__" : null,
    })),
    ...(clinical && "sessions" in procedure ? { sessions: procedure.sessions.map((session) => ({ ...session, photos: includeProcedurePhotos ? parseSessionPhotos(session.photos, photosByEvaluation.get(session.evaluationId) ?? []) : [] })) } : {}),
  }));

  const materialsUsed = [
    ...materialMovements.map((movement) => ({ id: movement.id, appointmentId: movement.appointmentId, procedureSessionId: movement.procedureSessionId, name: movement.product.name, productKind: movement.product.kind, unit: movement.product.unit, quantity: -movement.quantity, lotCode: movement.lot.code, lotExpiresOn: dateOnly(movement.lot.expiresOn), kind: movement.attendanceKind, attendanceName: movement.attendanceName, date: movement.attendanceDate, status: movement.reversedBy ? "reversed" : "used" })),
    ...pendingMaterials.map((item) => ({ id: item.id, appointmentId: item.appointmentId, procedureSessionId: item.procedureSessionId, name: item.product.name, productKind: item.product.kind, unit: item.product.unit, quantity: item.quantity, lotCode: null, lotExpiresOn: null, kind: item.attendanceKind, attendanceName: item.attendanceName, date: item.attendanceDate, status: "pending" })),
  ];

  return NextResponse.json({ patient: { id: patient.id, appointments: updatedAppointments, payments: payments.map(serializePayment), quotes, procedureRecords: responseProcedureRecords, materialsUsed, observations, appointmentToleranceMinutes: toleranceMinutes, ...(includeAppointmentProcedureNames ? { appointmentProcedureNames } : {}) } });
}

function parseSessionPhotos(value: string, evaluationPhotos: Array<{ id: string; name: string; imageUrl: string; width: number; height: number; category: string }>) {
  let parsed: Array<Record<string, unknown>>;
  try { parsed = JSON.parse(value) as Array<Record<string, unknown>>; } catch { return []; }
  return parsed.flatMap((photo) => {
    const source = typeof photo.sourceEvaluationPhotoId === "string" ? evaluationPhotos.find((item) => item.id === photo.sourceEvaluationPhotoId) : null;
    if (photo.sourceEvaluationPhotoId && !source) return [];
    return [{ ...photo, ...(source ? { name: source.name, imageUrl: source.imageUrl, width: source.width, height: source.height, category: source.category } : {}) }];
  });
}

