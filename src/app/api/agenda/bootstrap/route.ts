import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { procedureImageSelect, withImage } from "@/lib/procedure-server";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const [appointments, patients, procedures, members, clinic] = await Promise.all([
    // shortcut: traz todos os agendamentos da clínica (a agenda navega e marca faltas no cliente); filtrar por período e buscar ao navegar quando passar de ~10 mil linhas.
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
      select: { name: true, category: true, durationMinutes: true, ...procedureImageSelect },
    }),
    prisma.clinicMembership.findMany({
      where: { clinicId: user.clinicId, role: { in: ["ADMIN", "PROFESSIONAL"] } },
      orderBy: { user: { name: "asc" } },
      select: { role: true, user: { select: { name: true } } },
    }),
    prisma.clinic.findUnique({
      where: { id: user.clinicId },
      select: { appointmentToleranceMinutes: true, openingTime: true, closingTime: true },
    }),
  ]);

  return NextResponse.json({ appointments, patients, procedures: procedures.map(withImage), members, settings: clinic ?? { appointmentToleranceMinutes: 15, openingTime: "08:00", closingTime: "19:00" } });
}
