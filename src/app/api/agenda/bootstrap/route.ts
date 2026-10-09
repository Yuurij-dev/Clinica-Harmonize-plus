import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const [appointments, patients, procedures, members] = await Promise.all([
    prisma.appointment.findMany({
      where: { clinicId: user.clinicId },
      orderBy: [{ date: "asc" }, { time: "asc" }],
      select: { id: true, patientId: true, date: true, time: true, procedure: true, professional: true, status: true, patient: { select: { name: true } } },
    }),
    prisma.patient.findMany({
      where: { clinicId: user.clinicId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, cpf: true, phone: true, age: true, status: true, lastVisit: true, nextReturn: true, totalValue: true },
    }),
    prisma.procedure.findMany({
      where: { clinicId: user.clinicId },
      orderBy: { name: "asc" },
      select: { name: true, category: true, durationMinutes: true },
    }),
    prisma.clinicMembership.findMany({
      where: { clinicId: user.clinicId, role: { in: ["ADMIN", "PROFESSIONAL"] } },
      orderBy: { user: { name: "asc" } },
      select: { role: true, user: { select: { name: true } } },
    }),
  ]);

  // Keep the agenda usable while an older database is waiting for the tolerance migration.
  let appointmentToleranceMinutes = 15;
  let openingTime = "08:00";
  let closingTime = "19:00";
  try {
    const clinic = await prisma.clinic.findUnique({
      where: { id: user.clinicId },
      select: { appointmentToleranceMinutes: true, openingTime: true, closingTime: true },
    });
    appointmentToleranceMinutes = clinic?.appointmentToleranceMinutes ?? 15;
    openingTime = clinic?.openingTime ?? openingTime;
    closingTime = clinic?.closingTime ?? closingTime;
  } catch {
    // The default keeps existing clinics working until the new column is applied.
  }

  return NextResponse.json({ appointments, patients, procedures, members, settings: { appointmentToleranceMinutes, openingTime, closingTime } });
}
