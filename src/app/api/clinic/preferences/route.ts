import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { currentStagesFor } from "@/lib/patient-list-server";

const preferenceKeys = [
  "appointmentNotificationsEnabled",
  "stockNotificationsEnabled",
  "requireCancellationReason",
  "autoMarkMissedAppointmentsEnabled",
  "autoCompleteAppointmentsEnabled",
  "autoAdvancePatientJourneyEnabled",
  "allowAppointmentsOutsideHours",
] as const;

export async function PATCH(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "settings:manage")) return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const key = body?.key;
  const enabled = body?.enabled;
  if (!preferenceKeys.some((item) => item === key) || typeof enabled !== "boolean") {
    return NextResponse.json({ message: "Preferência inválida." }, { status: 400 });
  }

  // When automation is turned off, capture each patient's current step so it stays put.
  if (key === "autoAdvancePatientJourneyEnabled" && enabled === false) {
    const pageSize = 200;
    let skip = 0;
    while (true) {
      const patients = await prisma.patient.findMany({ where: { clinicId: user.clinicId }, orderBy: { id: "asc" }, skip, take: pageSize, select: { id: true, procedureRecords: { orderBy: { performedAt: "desc" }, take: 1, select: { id: true } } } });
      if (!patients.length) break;
      const stages = await currentStagesFor(user.clinicId, patients);
      await Promise.all(["lead", "evaluation", "quote", "procedure", "return"].map((stage) => prisma.patient.updateMany({ where: { clinicId: user.clinicId, id: { in: patients.filter((patient) => (stages.get(patient.id) ?? "evaluation") === stage).map((patient) => patient.id) } }, data: { manualJourneyStage: stage } })));
      skip += patients.length;
      if (patients.length < pageSize) break;
    }
  }

  const settings = await prisma.clinic.update({
    where: { id: user.clinicId },
    data: { [key as (typeof preferenceKeys)[number]]: enabled },
    select: { [key as (typeof preferenceKeys)[number]]: true },
  });
  return NextResponse.json({ settings });
}
