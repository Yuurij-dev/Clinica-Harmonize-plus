// Ganchos de agendamento -> Google Agenda e e-mails ao profissional (banco injetado, sem Next). Chamados pelas rotas de agendamento
// dentro de try/catch: nada aqui pode falhar nem atrasar a requisição. Sem segredos em log.
import type { PrismaClient } from "@prisma/client";
import { appointmentDurations } from "./appointment-conflict.ts";
import { appointmentDay } from "./clinic-time.ts";
import { clinicHasActiveConnection, enqueueCalendarSync } from "./calendar-sync-queue.ts";
import { resolveProfessionalMember, type JobOperation, type JobSnapshot } from "./calendar-sync-rules.ts";
import { loadProfessionalMembers } from "./calendar-sync-service.ts";
import { planNotifications } from "./calendar-notification-rules.ts";
import { sendCalendarNotifications, type NotificationDeps, type NotificationSummary } from "./calendar-notification-service.ts";
import { changeAffectsCalendar, diffAppointmentState, type CalendarAppointmentState } from "./google-calendar-rules.ts";

/** Campos do agendamento que importam para o Google/e-mail (date é o instante gravado; o dia da clínica é recuperado). */
export type AppointmentRow = { status: string; date: Date | string; time: string; procedure: string; professional: string };

export type AppointmentChange = {
  clinicId: string;
  appointmentId: string;
  patientId: string;
  /** Quem fez a alteração (não recebe e-mail da própria ação). */
  actorUserId?: string | null;
  /** null = criação. */
  prev: AppointmentRow | null;
  /** null = exclusão. */
  next: AppointmentRow | null;
  /** Vínculos lidos ANTES da exclusão (necessário para o job DELETE). */
  snapshot?: JobSnapshot | null;
};

const DECISION_DURATION = 60;

const stateOf = (row: AppointmentRow, durationMinutes = DECISION_DURATION): CalendarAppointmentState => ({
  status: row.status,
  day: appointmentDay(row.date),
  time: row.time,
  procedure: row.procedure,
  professional: row.professional,
  durationMinutes,
});

/** Operação de sincronização que a mudança exige (null = não sincroniza: ex. só Atendido/Faltou/Em atendimento ou notas). */
export function operationForChange(change: Pick<AppointmentChange, "prev" | "next" | "snapshot">): JobOperation | null {
  if (!change.next) return change.snapshot ? "DELETE" : null;
  if (!change.prev) return "CREATE";
  const before = stateOf(change.prev);
  const after = stateOf(change.next);
  return changeAffectsCalendar(diffAppointmentState(before, after), before, after) ? "UPDATE" : null;
}

/** Enfileira o job (outbox). false = nada a sincronizar ou clínica sem conexão ativa. Pode lançar: o chamador usa try/catch. */
export async function enqueueAppointmentChange(db: PrismaClient, change: AppointmentChange): Promise<boolean> {
  const operation = operationForChange(change);
  if (!operation) return false;
  if (!(await clinicHasActiveConnection(db, change.clinicId))) return false;
  const result = await enqueueCalendarSync(db, { clinicId: change.clinicId, appointmentId: change.appointmentId, operation, snapshot: operation === "DELETE" ? change.snapshot : null });
  return result.enqueued;
}

/** E-mails ao profissional conforme `planNotifications`. Nunca lança. */
export async function notifyAppointmentChange(db: PrismaClient, change: AppointmentChange, deps: Omit<NotificationDeps, "db"> = {}): Promise<NotificationSummary> {
  const empty: NotificationSummary = { sent: 0, failed: 0, skipped: 0 };
  try {
    if (!change.prev && !change.next) return empty;
    // Sem consultas quando nada que afete calendário/notificação mudou (só status Atendido/Faltou/Em atendimento ou notas).
    if (change.prev && change.next && operationForChange({ prev: change.prev, next: change.next }) === null) return empty;
    const names = [change.prev?.procedure, change.next?.procedure].filter((name): name is string => Boolean(name));
    const [durationOf, members, patient] = await Promise.all([
      appointmentDurations(db, change.clinicId, names),
      loadProfessionalMembers(db, change.clinicId),
      db.patient.findFirst({ where: { id: change.patientId, clinicId: change.clinicId }, select: { name: true } }),
    ]);
    const build = (row: AppointmentRow | null) => (row ? stateOf(row, durationOf(row.procedure)) : null);
    const resolve = (row: AppointmentRow | null) => {
      const resolved = row ? resolveProfessionalMember(row.professional, members) : null;
      return resolved?.ok ? { userId: resolved.professional.userId } : null;
    };
    const planned = planNotifications({ prev: build(change.prev), next: build(change.next), prevProfessional: resolve(change.prev), nextProfessional: resolve(change.next) });
    if (!planned.length) return empty;
    return await sendCalendarNotifications({ db, ...deps }, { clinicId: change.clinicId, appointmentId: change.appointmentId, patientName: patient?.name ?? "", planned, actorUserId: change.actorUserId });
  } catch {
    console.warn("[calendar-notification]", "plan_failed");
    return empty;
  }
}
