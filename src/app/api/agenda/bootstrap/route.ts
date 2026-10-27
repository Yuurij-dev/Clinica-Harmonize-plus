import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { procedureImageSelect, withImage } from "@/lib/procedure-server";
import { canForUser } from "@/lib/permissions";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "agenda:access")) return NextResponse.json({ message: "Seu cargo não tem acesso à agenda." }, { status: 403 });

  // Só dados estáticos e leves da agenda. Os agendamentos vêm de GET /api/agenda?from&to (período visível) e a busca de
  // pacientes do formulário, de GET /api/patients/lookup.
  const [procedures, members, clinic] = await Promise.all([
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
      select: { appointmentToleranceMinutes: true, openingTime: true, closingTime: true, requireCancellationReason: true, autoMarkMissedAppointmentsEnabled: true, autoCompleteAppointmentsEnabled: true, allowAppointmentsOutsideHours: true },
    }),
  ]);

  return NextResponse.json({ procedures: procedures.map(withImage), members, settings: clinic ?? { appointmentToleranceMinutes: 15, openingTime: "08:00", closingTime: "19:00", requireCancellationReason: false, autoMarkMissedAppointmentsEnabled: true, autoCompleteAppointmentsEnabled: true, allowAppointmentsOutsideHours: false } });
}
