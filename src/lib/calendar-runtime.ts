// Cola com o runtime (Prisma real + env + next/server `after`) para as rotas de agendamento e o cron.
// Tudo aqui é best-effort: nunca lança e nunca registra segredos. Ver docs/google-calendar.md.
import { after } from "next/server";
import { enqueueBackfill, captureDeleteSnapshots, clinicHasActiveConnection, requeueAuthFailedJobs } from "./calendar-sync-queue";
import { processCalendarSyncJobs, type ProcessSummary } from "./calendar-sync-job-processor";
import { enqueueAppointmentChange, notifyAppointmentChange, type AppointmentChange } from "./calendar-appointment-hooks";
import type { JobSnapshot } from "./calendar-sync-rules";
import { createCalendarClient, getCalendarConfig } from "./google-calendar-config";
import { appointmentLink } from "./google-calendar-rules";
import { prisma } from "./prisma";

export const AFTER_DRAIN_LIMIT = 5;
export const CRON_LIMIT = 25;

/** Processa jobs da fila (da clínica, ou todos quando clinicId é omitido). Sem a integração configurada, não faz nada. */
export async function drainCalendarJobs(input: { clinicId?: string; limit?: number; budgetMs?: number } = {}): Promise<ProcessSummary | null> {
  try {
    const config = getCalendarConfig();
    if (!config) return null;
    return await processCalendarSyncJobs({
      limit: input.limit ?? AFTER_DRAIN_LIMIT,
      clinicId: input.clinicId,
      deps: { db: prisma, client: createCalendarClient(config), env: process.env, appOrigin: config.appOrigin, budgetMs: input.budgetMs ?? 8_000 },
    });
  } catch {
    console.warn("[calendar-sync]", "drain_failed");
    return null;
  }
}

/** Lê os vínculos Google dos agendamentos ANTES de excluí-los (o delete em cascata os apaga). Nunca lança. */
export async function snapshotsBeforeDelete(clinicId: string, appointmentIds: string[]): Promise<Map<string, JobSnapshot>> {
  try {
    return await captureDeleteSnapshots(prisma, clinicId, appointmentIds);
  } catch {
    console.warn("[calendar-sync]", "snapshot_failed");
    return new Map();
  }
}

/**
 * Chamado pelas rotas DEPOIS de gravar o agendamento. Enfileira o job (curto, try/catch) e agenda, com `after()`, os e-mails
 * ao profissional e uma drenagem best-effort da fila da clínica: a resposta não espera por Google nem por Resend.
 * Cascatas sem rota (excluir paciente/clínica) não passam por aqui: eventos órfãos ficam no Google (ver docs).
 */
export async function calendarAppointmentChanged(change: AppointmentChange): Promise<void> {
  let enqueued = false;
  try {
    enqueued = await enqueueAppointmentChange(prisma, change);
  } catch {
    console.warn("[calendar-sync]", "enqueue_failed");
  }
  try {
    after(async () => {
      try {
        await notifyAppointmentChange(prisma, change, { appLink: appointmentLink(getCalendarConfig()?.appOrigin ?? null) ?? undefined });
        if (enqueued) await drainCalendarJobs({ clinicId: change.clinicId });
      } catch {
        // best-effort
      }
    });
  } catch {
    // fora de um contexto de requisição: o cron recupera o job
  }
}

/** Mesma garantia para vários agendamentos (exclusão em lote da jornada). */
export async function calendarAppointmentsDeleted(input: { clinicId: string; patientId: string; actorUserId?: string | null; rows: Array<{ appointmentId: string; row: AppointmentChange["prev"] }>; snapshots: Map<string, JobSnapshot> }) {
  for (const item of input.rows) {
    await calendarAppointmentChanged({ clinicId: input.clinicId, appointmentId: item.appointmentId, patientId: input.patientId, actorUserId: input.actorUserId, prev: item.row, next: null, snapshot: input.snapshots.get(item.appointmentId) ?? null });
  }
}

/** Backfill + drenagem (conexão nova, "Sincronizar agora"). `userId` limita aos agendamentos do profissional. */
export async function backfillCalendar(input: { clinicId: string; userId?: string }) {
  try {
    if (!(await clinicHasActiveConnection(prisma, input.clinicId))) return { enqueued: 0 };
    return await enqueueBackfill(prisma, input);
  } catch {
    console.warn("[calendar-sync]", "backfill_failed");
    return { enqueued: 0 };
  }
}

/** Conexão (re)estabelecida: recoloca na fila os jobs que falharam por autenticação e enfileira o backfill. */
export async function afterCalendarConnected(input: { clinicId: string; userId?: string }) {
  try {
    await requeueAuthFailedJobs(prisma, input.clinicId);
  } catch {
    console.warn("[calendar-sync]", "requeue_failed");
  }
  return backfillCalendar(input);
}
