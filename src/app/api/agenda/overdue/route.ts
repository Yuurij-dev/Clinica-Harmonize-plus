import { NextResponse } from "next/server";
import { addDays } from "@/lib/agenda-period-rules";
import { overdueCandidateLimit, selectOverdue } from "@/lib/agenda-overdue-rules";
import { appointmentDurations } from "@/lib/appointment-conflict";
import { getCurrentUser } from "@/lib/auth";
import { clinicNow } from "@/lib/clinic-time";
import { prisma } from "@/lib/prisma";
import { canForUser } from "@/lib/permissions";

// Agendamentos "Agendado" cujo fim (data + hora + duração real) já passou, dos mais antigos (máx. 200). Só leitura: a Agenda
// usa esta lista para marcar "Faltou" mesmo em períodos que não está exibindo. Nunca inclui "Em atendimento" nem "Atendido".
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "agenda:access")) return NextResponse.json({ message: "Seu cargo não tem acesso à agenda." }, { status: 403 });

  const now = clinicNow();
  const rows = await prisma.appointment.findMany({
    where: { clinicId: user.clinicId, status: "Agendado", date: { lt: new Date(`${addDays(now.date, 1)}T00:00:00Z`) } },
    orderBy: [{ date: "asc" }, { time: "asc" }, { id: "asc" }],
    take: overdueCandidateLimit,
    select: { id: true, patientId: true, date: true, time: true, procedure: true, professional: true, status: true, patient: { select: { name: true } } },
  });
  const durationOf = await appointmentDurations(prisma, user.clinicId, [...new Set(rows.map((row) => row.procedure))]);
  return NextResponse.json({ appointments: selectOverdue(rows, durationOf, now) });
}
