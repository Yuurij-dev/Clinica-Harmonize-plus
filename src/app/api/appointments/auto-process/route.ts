import { NextResponse } from "next/server";
import { addDays } from "@/lib/agenda-period-rules";
import { appointmentDurations } from "@/lib/appointment-conflict";
import { appointmentsForAutomaticTransitions } from "@/lib/appointment-automation-rules";
import { getCurrentUser } from "@/lib/auth";
import { appointmentHasPassed, clinicNow } from "@/lib/clinic-time";
import { prisma } from "@/lib/prisma";
import { canForUser } from "@/lib/permissions";

const candidateLimit = 400;

export async function POST() {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "agenda:access")) return NextResponse.json({ message: "Seu cargo não tem acesso à agenda." }, { status: 403 });

  const clinic = await prisma.clinic.findUnique({ where: { id: user.clinicId }, select: { appointmentToleranceMinutes: true, autoMarkMissedAppointmentsEnabled: true, autoCompleteAppointmentsEnabled: true } });
  if (!clinic) return NextResponse.json({ message: "Clínica não encontrada." }, { status: 404 });
  if (!clinic.autoMarkMissedAppointmentsEnabled && !clinic.autoCompleteAppointmentsEnabled) return NextResponse.json({ updated: [] });

  const now = clinicNow();
  const dateCutoff = new Date(`${addDays(now.date, 1)}T00:00:00Z`);
  const [missedCandidates, activeCandidates] = await Promise.all([
    clinic.autoMarkMissedAppointmentsEnabled ? prisma.appointment.findMany({
      where: { clinicId: user.clinicId, status: "Agendado", date: { lt: dateCutoff } },
      orderBy: [{ date: "asc" }, { time: "asc" }, { id: "asc" }], take: candidateLimit,
      select: { id: true, patientId: true, date: true, time: true, procedure: true, status: true },
    }) : Promise.resolve([]),
    clinic.autoCompleteAppointmentsEnabled ? prisma.appointment.findMany({
      where: { clinicId: user.clinicId, status: "Em atendimento", date: { lt: dateCutoff } },
      orderBy: [{ date: "asc" }, { time: "asc" }, { id: "asc" }], take: candidateLimit,
      select: { id: true, patientId: true, date: true, time: true, procedure: true, status: true },
    }) : Promise.resolve([]),
  ]);

  const candidates = [...missedCandidates, ...activeCandidates];
  const durationOf = await appointmentDurations(prisma, user.clinicId, [...new Set(candidates.map((item) => item.procedure))]);
  const byId = new Map(candidates.map((item) => [item.id, item]));
  const transitions = appointmentsForAutomaticTransitions(candidates.map((item) => ({ ...item, durationMinutes: durationOf(item.procedure) })), clinic, now, appointmentHasPassed);
  const missedIds = transitions.missed.map((item) => item.id);
  const completedIds = transitions.completed.map((item) => item.id);

  const [missedResult, completedResult] = await Promise.all([
    missedIds.length ? prisma.appointment.updateMany({ where: { clinicId: user.clinicId, id: { in: missedIds }, status: "Agendado" }, data: { status: "Faltou" } }) : { count: 0 },
    completedIds.length ? prisma.appointment.updateMany({ where: { clinicId: user.clinicId, id: { in: completedIds }, status: "Em atendimento" }, data: { status: "Atendido" } }) : { count: 0 },
  ]);
  if (completedResult.count) {
    await prisma.appointment.updateMany({ where: { clinicId: user.clinicId, id: { in: completedIds }, status: "Atendido", materialsCheck: null }, data: { materialsCheck: "pending" } });
  }

  const updated = [
    ...(missedResult.count ? transitions.missed.map((item) => ({ id: item.id, patientId: byId.get(item.id)!.patientId, date: byId.get(item.id)!.date, status: "Faltou" })) : []),
    ...(completedResult.count ? transitions.completed.map((item) => ({ id: item.id, patientId: byId.get(item.id)!.patientId, date: byId.get(item.id)!.date, status: "Atendido" })) : []),
  ];
  return NextResponse.json({ updated });
}
