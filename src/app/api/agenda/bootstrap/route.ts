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
      include: { patient: { select: { name: true } } },
    }),
    prisma.patient.findMany({
      where: { clinicId: user.clinicId },
      orderBy: { name: "asc" },
      include: { _count: { select: { appointments: true, evaluations: true } } },
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

  return NextResponse.json({ appointments, patients, procedures, members });
}
