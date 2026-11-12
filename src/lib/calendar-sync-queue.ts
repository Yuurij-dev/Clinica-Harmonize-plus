// Fila (outbox) de sincronização com o Google Agenda: enfileirar CREATE/UPDATE/DELETE com dedupe, snapshot para DELETE e backfill.
// Toda consulta é escopada por clinicId. Nenhuma função aqui chama o Google.
import type { Prisma, PrismaClient } from "@prisma/client";
import { professionalKey } from "./appointment-conflict-rules.ts";
import { appointmentInstant, clinicToday } from "./clinic-time.ts";
import { AUTH_FAILURE_MESSAGE, buildJobSnapshot, decideEnqueue, jobDedupeKey, type JobOperation, type JobSnapshot, type LinkedEvent } from "./calendar-sync-rules.ts";

type Db = PrismaClient;

export const BACKFILL_PAGE_SIZE = 200;
export const BACKFILL_MAX_APPOINTMENTS = 2000;
export const BACKFILL_MAX_SCAN = 5000;

export const COMPLETED_JOB_RETENTION_DAYS = 7;

/** Limpeza de jobs COMPLETED antigos (a tabela é só uma fila; o histórico útil está em GoogleCalendarEvent). Devolve quantos apagou. */
export async function purgeOldJobs(db: Pick<Db, "calendarSyncJob">, now = new Date()) {
  const cutoff = new Date(now.getTime() - COMPLETED_JOB_RETENTION_DAYS * 86_400_000);
  return (await db.calendarSyncJob.deleteMany({ where: { status: "COMPLETED", updatedAt: { lt: cutoff } } })).count;
}

/**
 * Ao reconectar: jobs FAILED por falha de autenticação (qualquer operação: CREATE/UPDATE/DELETE) voltam a PENDING para a clínica,
 * com tentativas zeradas. Falhas de outro tipo continuam FAILED.
 */
export async function requeueAuthFailedJobs(db: Pick<Db, "calendarSyncJob">, clinicId: string, now = new Date()) {
  const result = await db.calendarSyncJob.updateMany({
    where: { clinicId, status: "FAILED", lastError: AUTH_FAILURE_MESSAGE },
    data: { status: "PENDING", attempts: 0, nextRetryAt: now, lockedAt: null, lockedBy: null, lastError: null },
  });
  return result.count;
}

/** Só há o que sincronizar se a clínica tem alguma conexão ativa (evita encher a fila de clínicas sem integração). */
export async function clinicHasActiveConnection(db: Pick<Db, "googleCalendarConnection">, clinicId: string) {
  return (await db.googleCalendarConnection.count({ where: { clinicId, status: "CONNECTED" } })) > 0;
}

/** Enfileira (ou coalesce) um job do agendamento. Serializado por agendamento com lock advisory transacional. */
export async function enqueueCalendarSync(db: Db, input: { clinicId: string; appointmentId: string; operation: JobOperation; snapshot?: JobSnapshot | null }) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`calsync:${input.appointmentId}`}))`;
    const pending = await tx.calendarSyncJob.findMany({ where: { clinicId: input.clinicId, appointmentId: input.appointmentId, status: "PENDING" }, select: { id: true, operation: true } });
    const decision = decideEnqueue(input.operation, pending.map((job) => ({ id: job.id, operation: job.operation as JobOperation })));
    if (decision.supersedeIds.length) {
      await tx.calendarSyncJob.updateMany({ where: { id: { in: decision.supersedeIds }, clinicId: input.clinicId, status: "PENDING" }, data: { status: "COMPLETED", lastError: "Substituído por exclusão do agendamento.", lockedAt: null, lockedBy: null } });
    }
    if (!decision.insert) return { enqueued: false };
    await tx.calendarSyncJob.create({
      data: {
        clinicId: input.clinicId,
        appointmentId: input.appointmentId,
        operation: input.operation,
        dedupeKey: jobDedupeKey(input.appointmentId, input.operation),
        ...(input.snapshot ? { snapshot: input.snapshot as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    return { enqueued: true };
  });
}

/** Vínculos atuais com o Google dos agendamentos (ler ANTES de excluí-los: o delete em cascata apaga os vínculos). Só devolve quem tem vínculo. */
export async function captureDeleteSnapshots(db: Pick<Db, "googleCalendarEvent">, clinicId: string, appointmentIds: string[]) {
  const snapshots = new Map<string, JobSnapshot>();
  if (!appointmentIds.length) return snapshots;
  const rows = await db.googleCalendarEvent.findMany({
    where: { clinicId, appointmentId: { in: appointmentIds } },
    select: { appointmentId: true, connectionId: true, role: true, googleEventId: true, attendeeEmail: true, syncStatus: true },
  });
  const byAppointment = new Map<string, LinkedEvent[]>();
  for (const row of rows) {
    const list = byAppointment.get(row.appointmentId) ?? [];
    list.push({ connectionId: row.connectionId, role: row.role as LinkedEvent["role"], googleEventId: row.googleEventId, attendeeEmail: row.attendeeEmail, syncStatus: row.syncStatus as LinkedEvent["syncStatus"] });
    byAppointment.set(row.appointmentId, list);
  }
  for (const [appointmentId, events] of byAppointment) snapshots.set(appointmentId, buildJobSnapshot(events));
  return snapshots;
}

/** Depois da exclusão bem-sucedida: um job DELETE por agendamento, com o snapshot lido antes. */
export async function enqueueDeleteJobs(db: Db, clinicId: string, snapshots: Map<string, JobSnapshot>) {
  for (const [appointmentId, snapshot] of snapshots) {
    await enqueueCalendarSync(db, { clinicId, appointmentId, operation: "DELETE", snapshot });
  }
}

/**
 * Backfill: CREATE para agendamentos de hoje em diante e não cancelados (paginado por id, com tetos). `userId` limita aos agendamentos
 * cujo nome de profissional casa com o do usuário (conexão individual). Não duplica jobs PENDING.
 */
export async function enqueueBackfill(db: Db, input: { clinicId: string; userId?: string; now?: Date; pageSize?: number; maxAppointments?: number }) {
  const { clinicId } = input;
  const pageSize = input.pageSize ?? BACKFILL_PAGE_SIZE;
  const maxAppointments = input.maxAppointments ?? BACKFILL_MAX_APPOINTMENTS;
  let wantedKey: string | null = null;
  if (input.userId) {
    const member = await db.clinicMembership.findFirst({ where: { clinicId, userId: input.userId }, select: { user: { select: { name: true } } } });
    wantedKey = professionalKey(member?.user.name);
    if (!wantedKey) return { enqueued: 0, scanned: 0 };
  }
  const from = appointmentInstant(clinicToday(input.now));
  let cursor: string | undefined;
  let enqueued = 0;
  let scanned = 0;
  while (enqueued < maxAppointments && scanned < BACKFILL_MAX_SCAN) {
    const page = await db.appointment.findMany({
      where: { clinicId, status: { not: "Cancelado" }, date: { gte: from } },
      select: { id: true, professional: true },
      orderBy: { id: "asc" },
      take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!page.length) break;
    scanned += page.length;
    cursor = page[page.length - 1].id;
    const wanted = (wantedKey ? page.filter((row) => professionalKey(row.professional) === wantedKey) : page).slice(0, maxAppointments - enqueued);
    if (wanted.length) {
      const pending = await db.calendarSyncJob.findMany({ where: { clinicId, appointmentId: { in: wanted.map((row) => row.id) }, status: "PENDING" }, select: { appointmentId: true } });
      const skip = new Set(pending.map((job) => job.appointmentId));
      const fresh = wanted.filter((row) => !skip.has(row.id));
      if (fresh.length) {
        await db.calendarSyncJob.createMany({ data: fresh.map((row) => ({ clinicId, appointmentId: row.id, operation: "CREATE", dedupeKey: jobDedupeKey(row.id, "CREATE") })) });
        enqueued += fresh.length;
      }
    }
    if (page.length < pageSize) break;
  }
  return { enqueued, scanned };
}
