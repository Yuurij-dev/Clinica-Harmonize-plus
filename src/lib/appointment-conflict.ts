import type { Prisma } from "@prisma/client";
import { appointmentDay } from "./clinic-time";
import {
  appointmentDurationMinutes, conflictSearchWindow, findScheduleConflict, occupyingAppointmentStatuses, professionalKey, scheduleConflictMessage,
  type ScheduleCandidate,
} from "./appointment-conflict-rules";
import { appointmentDurationLookupNames, appointmentProcedureDuration } from "./procedure-session-rules";

type Tx = Prisma.TransactionClient;
type ProcedureDb = Pick<Tx, "procedure">;

// Opções das transações de agendamento (travas podem esperar outras requisições na fila).
export const appointmentTransactionOptions = { timeout: 15_000, maxWait: 10_000 } as const;

// Duração (min) de cada nome de agendamento, resolvida em UMA consulta: nome exato, sem prefixo
// ("Procedimento - X", "Retorno - X") ou partes de nome combinado; senão 60. Mesma regra para expediente e conflito.
export async function appointmentDurations(db: ProcedureDb, clinicId: string, names: string[]) {
  const lookup = [...new Set(names.flatMap(appointmentDurationLookupNames))];
  const procedures = await db.procedure.findMany({ where: { clinicId, name: { in: lookup } }, select: { name: true, durationMinutes: true } });
  return (name: string) => appointmentDurationMinutes(appointmentProcedureDuration(procedures, name));
}

// Ordem global das travas de agendamento (sempre nesta ordem, para nunca haver deadlock):
//   1. jornada (hashtext(journeyId))      2. profissional (clínica + nome normalizado)      3. paciente (clínica + patientId)
// Todas são pg_advisory_xact_lock: soltam no fim da transação, depois do commit do agendamento.
export async function lockAppointmentSlots(tx: Tx, clinicId: string, professional: string, patientId: string | null) {
  const key = professionalKey(professional);
  if (key) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`appt-prof:${clinicId}:${key}`}))`;
  if (patientId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`appt-pat:${clinicId}:${patientId}`}))`;
}

// Chamar só depois de lockAppointmentSlots, dentro da mesma transação. Devolve a mensagem do conflito ou null.
export async function scheduleConflictError(tx: Tx, clinicId: string, candidate: Omit<ScheduleCandidate, "durationMinutes"> & { procedure: string }) {
  const window = conflictSearchWindow(candidate.day);
  const key = professionalKey(candidate.professional);
  if (!key && !candidate.patientId) return null;
  // O filtro do banco só reduz o volume: mesmo paciente OU nome do profissional contendo o primeiro trecho ASCII do nome
  // (funciona com acento/espaços/caixa diferentes). A comparação normalizada final é em memória.
  const token = key.match(/[a-z0-9]{2,}/)?.[0];
  const who = key && !token ? undefined : [...(candidate.patientId ? [{ patientId: candidate.patientId }] : []), ...(token ? [{ professional: { contains: token, mode: "insensitive" as const } }] : [])];
  const rows = await tx.appointment.findMany({
    where: { clinicId, status: { in: [...occupyingAppointmentStatuses] }, date: { gte: window.from, lt: window.to }, ...(who ? { OR: who } : {}), ...(candidate.excludeId ? { id: { not: candidate.excludeId } } : {}) },
    select: { id: true, date: true, time: true, procedure: true, professional: true, patientId: true, status: true },
  });
  if (!rows.length) return null;
  const duration = await appointmentDurations(tx, clinicId, [candidate.procedure, ...rows.map((row) => row.procedure)]);
  const conflict = findScheduleConflict(
    { ...candidate, durationMinutes: duration(candidate.procedure) },
    rows.map((row) => ({ ...row, day: appointmentDay(row.date), durationMinutes: duration(row.procedure) })),
  );
  return conflict ? scheduleConflictMessage(conflict, candidate.professional) : null;
}
