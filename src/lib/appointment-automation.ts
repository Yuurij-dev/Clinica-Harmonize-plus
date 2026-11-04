import { addDays } from "@/lib/agenda-period-rules";
import { Prisma } from "@prisma/client";
import { appointmentsForAutomaticTransitions, optimisticUpdatedAt } from "@/lib/appointment-automation-rules";
import { appointmentHasPassed, clinicNow } from "@/lib/clinic-time";
import { prisma } from "@/lib/prisma";

const candidateLimit = 400;

export type MissedAppointment = { id: string; patientId: string; date: Date };

// Única rotina de faltas automáticas. Sempre escopada pela clínica da sessão (e, se informado, paciente/jornada).
// Escrita otimista e idempotente: só altera linhas ainda "Agendado" com o mesmo updatedAt lido, então uma
// edição humana ou o início do atendimento entre a leitura e a escrita nunca é sobrescrito. Devolve só o que mudou.
export async function markMissedAppointments(clinicId: string, scope: { patientId?: string; journeyId?: string } = {}): Promise<MissedAppointment[]> {
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { appointmentToleranceMinutes: true, autoMarkMissedAppointmentsEnabled: true } });
  if (!clinic?.autoMarkMissedAppointmentsEnabled) return [];
  const now = clinicNow();
  const dateCutoff = new Date(`${addDays(now.date, 1)}T00:00:00Z`);
  // O filtro do prazo (início + tolerância, no fuso da clínica) e da correção humana (updatedAt <= prazo) vai
  // para o banco: linhas travadas por edição humana nunca ocupam a janela de ${candidateLimit} candidatos.
  // Equivale a missedDeadline: dia em America/Sao_Paulo + "HH:MM" interpretado nesse fuso (-03:00, sem horário de verão)
  // + tolerância; a regra pura em JS roda depois como segunda checagem. clinicId e demais filtros sempre como parâmetros.
  const ids = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "Appointment"
    WHERE "clinicId" = ${clinicId} AND "status" = 'Agendado' AND "date" < ${dateCutoff}
      ${scope.patientId ? Prisma.sql`AND "patientId" = ${scope.patientId}` : Prisma.empty}
      ${scope.journeyId ? Prisma.sql`AND "journeyId" = ${scope.journeyId}` : Prisma.empty}
      AND "updatedAt" <= CASE WHEN "time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        THEN (((("date" AT TIME ZONE 'America/Sao_Paulo')::date + "time"::time) AT TIME ZONE 'America/Sao_Paulo') + make_interval(mins => ${clinic.appointmentToleranceMinutes}::int))
      END
    ORDER BY "date" ASC, "time" ASC, "id" ASC
    LIMIT ${candidateLimit}`);
  if (!ids.length) return [];
  const found = await prisma.appointment.findMany({
    where: { clinicId, id: { in: ids.map((row) => row.id) }, status: "Agendado" },
    orderBy: [{ date: "asc" }, { time: "asc" }, { id: "asc" }],
    select: { id: true, patientId: true, date: true, time: true, status: true, updatedAt: true },
  });
  const { missed } = appointmentsForAutomaticTransitions(found, clinic, now, appointmentHasPassed);
  if (!missed.length) return [];
  return prisma.appointment.updateManyAndReturn({
    where: { clinicId, status: "Agendado", OR: missed.map((item) => ({ id: item.id, ...optimisticUpdatedAt(item.updatedAt) })) },
    data: { status: "Faltou" },
    select: { id: true, patientId: true, date: true },
  });
}
