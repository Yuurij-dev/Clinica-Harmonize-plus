// Processador da fila de sincronização com o Google Agenda. Reserva atômica por UPDATE condicional (sem workers em memória),
// um job por agendamento por vez, backoff exponencial e nunca deixa exceção vazar. Mensagens de erro sem segredos.
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { decideJobFailure, MAX_SYNC_ATTEMPTS, parseJobSnapshot, STALE_LOCK_MS, type SyncErrorKind } from "./calendar-sync-rules.ts";
import { syncAppointment, type SyncDeps } from "./calendar-sync-service.ts";
import { isGoogleCalendarError } from "./google-calendar-client.ts";

export const DEFAULT_PROCESS_LIMIT = 10;
export const DEFAULT_BUDGET_MS = 40_000;

export type ProcessDeps = Omit<SyncDeps, "now"> & { db: PrismaClient; workerId?: string; budgetMs?: number };

export type ProcessSummary = { picked: number; completed: number; retried: number; failed: number; skipped: number };

const errorKind = (error: unknown): { kind: SyncErrorKind; retryAfterSeconds: number | null; message: string } => {
  if (isGoogleCalendarError(error)) return { kind: error.kind, retryAfterSeconds: error.retryAfterSeconds, message: error.message };
  return { kind: "transient", retryAfterSeconds: null, message: "Falha interna ao sincronizar." };
};

/** Libera a reserva (sem contar tentativa) quando outro job do mesmo agendamento está em andamento. */
const release = (db: PrismaClient, id: string, workerId: string) =>
  db.calendarSyncJob.updateMany({ where: { id, lockedBy: workerId, status: "PROCESSING" }, data: { status: "PENDING", lockedAt: null, lockedBy: null } });

export async function processCalendarSyncJobs(input: { limit?: number; now?: Date; clinicId?: string; deps: ProcessDeps }): Promise<ProcessSummary> {
  const { db } = input.deps;
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_PROCESS_LIMIT, 100));
  const startedAt = Date.now();
  const budgetMs = input.deps.budgetMs ?? DEFAULT_BUDGET_MS;
  const nowOf = () => input.now ?? new Date();
  const workerId = input.deps.workerId ?? `worker-${randomUUID()}`;
  const summary: ProcessSummary = { picked: 0, completed: 0, retried: 0, failed: 0, skipped: 0 };

  try {
    const now = nowOf();
    const staleCutoff = new Date(now.getTime() - STALE_LOCK_MS);
    const runnable = [
      { status: "PENDING", nextRetryAt: { lte: now } },
      { status: "PROCESSING", OR: [{ lockedAt: null }, { lockedAt: { lt: staleCutoff } }] },
    ];
    const candidates = await db.calendarSyncJob.findMany({
      where: { ...(input.clinicId ? { clinicId: input.clinicId } : {}), OR: runnable },
      select: { id: true, status: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
    });

    for (const candidate of candidates) {
      if (Date.now() - startedAt > budgetMs) break;
      const at = nowOf();
      // Reserva atômica: só um processador consegue virar PROCESSING (a condição é reavaliada pelo banco no UPDATE).
      // Retomar uma trava antiga (execução que morreu) conta como tentativa, para um job que derruba o processo não rodar para sempre.
      const stale = candidate.status === "PROCESSING";
      const reserved = await db.calendarSyncJob.updateMany({
        where: {
          id: candidate.id,
          ...(input.clinicId ? { clinicId: input.clinicId } : {}),
          ...(stale
            ? { status: "PROCESSING", OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(at.getTime() - STALE_LOCK_MS) } }] }
            : { status: "PENDING", nextRetryAt: { lte: at } }),
        },
        data: { status: "PROCESSING", lockedAt: at, lockedBy: workerId, ...(stale ? { attempts: { increment: 1 } } : {}) },
      });
      if (reserved.count === 0) {
        summary.skipped += 1;
        continue;
      }
      summary.picked += 1;
      await processReserved(input, workerId, candidate.id, stale, summary);
    }
  } catch {
    // Falha de banco no ciclo: o próximo ciclo (cron) retoma; nada vaza.
    console.warn("[calendar-sync]", "cycle_failed");
  }
  return summary;
}

async function processReserved(input: { now?: Date; clinicId?: string; deps: ProcessDeps }, workerId: string, jobId: string, stale: boolean, summary: ProcessSummary) {
  const { db } = input.deps;
  const nowOf = () => input.now ?? new Date();
  try {
    const job = await db.calendarSyncJob.findFirst({ where: { id: jobId, lockedBy: workerId, status: "PROCESSING" }, select: { id: true, clinicId: true, appointmentId: true, attempts: true, snapshot: true } });
    if (!job) return;

    // Um job por agendamento por vez: se outro está em andamento (trava recente), devolve este à fila.
    const other = await db.calendarSyncJob.findFirst({
      where: { clinicId: job.clinicId, appointmentId: job.appointmentId, id: { not: job.id }, status: "PROCESSING", lockedAt: { gt: new Date(nowOf().getTime() - STALE_LOCK_MS) } },
      select: { id: true },
    });
    if (other) {
      await release(db, job.id, workerId);
      summary.skipped += 1;
      summary.picked -= 1;
      return;
    }

    if (stale && job.attempts >= MAX_SYNC_ATTEMPTS) {
      await db.calendarSyncJob.updateMany({ where: { id: job.id, lockedBy: workerId, status: "PROCESSING" }, data: { status: "FAILED", lockedAt: null, lockedBy: null, lastError: "Tempo de processamento esgotado." } });
      summary.failed += 1;
      return;
    }

    try {
      await syncAppointment({ ...input.deps, now: nowOf }, { clinicId: job.clinicId, appointmentId: job.appointmentId, snapshot: parseJobSnapshot(job.snapshot) });
      await db.calendarSyncJob.updateMany({ where: { id: job.id, lockedBy: workerId, status: "PROCESSING" }, data: { status: "COMPLETED", lockedAt: null, lockedBy: null, lastError: null } });
      summary.completed += 1;
    } catch (error) {
      const info = errorKind(error);
      const decision = decideJobFailure({ kind: info.kind, attemptsBefore: job.attempts, now: nowOf(), retryAfterSeconds: info.retryAfterSeconds });
      if (decision.status === "PENDING") {
        await db.calendarSyncJob.updateMany({ where: { id: job.id, lockedBy: workerId, status: "PROCESSING" }, data: { status: "PENDING", attempts: decision.attempts, nextRetryAt: decision.nextRetryAt, lockedAt: null, lockedBy: null, lastError: info.message.slice(0, 300) } });
        summary.retried += 1;
      } else {
        await db.calendarSyncJob.updateMany({ where: { id: job.id, lockedBy: workerId, status: "PROCESSING" }, data: { status: "FAILED", attempts: decision.attempts, lockedAt: null, lockedBy: null, lastError: decision.message.slice(0, 300) } });
        summary.failed += 1;
      }
    }
  } catch {
    // Falha ao gravar o resultado: a trava expira em 5 min e o job é retomado (idempotente).
    console.warn("[calendar-sync]", "job_update_failed");
  }
}
