import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canForUser } from "@/lib/permissions";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "agenda:access")) return NextResponse.json({ message: "Seu cargo não tem acesso à agenda." }, { status: 403 });

  const now = Date.now();
  const [appointments, settings] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        clinicId: user.clinicId,
        date: { gte: new Date(now - 2 * 86_400_000), lte: new Date(now + 2 * 86_400_000) },
        status: { notIn: ["Atendido", "Faltou", "Cancelado"] },
      },
      select: { id: true, date: true, time: true, status: true, patient: { select: { name: true } } },
    }),
    prisma.clinic.findUnique({
      where: { id: user.clinicId },
      select: { appointmentNotificationsEnabled: true, appointmentNotificationSoundEnabled: true, stockNotificationsEnabled: true },
    }),
  ]);

  return NextResponse.json({
    appointments: settings?.appointmentNotificationsEnabled === false ? [] : appointments,
    settings: {
      appointmentNotificationsEnabled: settings?.appointmentNotificationsEnabled ?? true,
      appointmentNotificationSoundEnabled: settings?.appointmentNotificationSoundEnabled ?? true,
      stockNotificationsEnabled: settings?.stockNotificationsEnabled ?? true,
    },
  });
}
