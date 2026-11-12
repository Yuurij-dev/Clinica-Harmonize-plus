// Decisão PURA da sincronização com o Google Agenda: estado do agendamento + conexões + vínculos existentes + profissional
// resolvido -> lista de ações idempotentes. Também: resolução do profissional, backoff e coalescência de jobs.
// Sem Prisma, sem rede. Regra central: no máximo UM evento por calendário de pessoa por agendamento.
import { professionalKey } from "./appointment-conflict-rules.ts";
import {
  appointmentIsCancelled,
  calendarEventId,
  isValidCalendarEmail,
  normalizeCalendarEmail,
  type CalendarConnectionStatus,
  type CalendarConnectionType,
} from "./google-calendar-rules.ts";

// ---------- profissional ----------

export type ProfessionalMember = { userId: string; name: string; email: string; role: string };
export type ResolvedProfessional = { userId: string; name: string; email: string };
export type ProfessionalResolution =
  | { ok: true; professional: ResolvedProfessional }
  | { ok: false; reason: "NO_NAME" | "NOT_FOUND" | "AMBIGUOUS" };

/** Casa o nome livre do agendamento com membros ADMIN/PROFESSIONAL da clínica por professionalKey. 0 ou 2+ = sem convidado. */
export function resolveProfessionalMember(professionalName: string | null | undefined, members: ProfessionalMember[]): ProfessionalResolution {
  const key = professionalKey(professionalName);
  if (!key) return { ok: false, reason: "NO_NAME" };
  const matches = members.filter((member) => (member.role === "ADMIN" || member.role === "PROFESSIONAL") && professionalKey(member.name) === key);
  if (matches.length === 0) return { ok: false, reason: "NOT_FOUND" };
  if (matches.length > 1) return { ok: false, reason: "AMBIGUOUS" };
  const [match] = matches;
  return { ok: true, professional: { userId: match.userId, name: match.name, email: match.email } };
}

export const professionalNotIdentifiedMessage = "profissional não identificado";

// ---------- estado de entrada ----------

export type SyncConnection = {
  id: string;
  userId: string;
  type: CalendarConnectionType;
  status: CalendarConnectionStatus;
  googleEmail: string;
};

export type LinkRole = "CENTRAL" | "INDIVIDUAL";
export type LinkSyncStatus = "SYNCED" | "PENDING_INVITE" | "RECEIVED" | "CANCELLED" | "ERROR";

export type LinkedEvent = {
  connectionId: string;
  role: LinkRole;
  googleEventId: string;
  attendeeEmail: string | null;
  syncStatus: LinkSyncStatus;
};

export type SyncPlanInput = {
  /** Estado atual do agendamento; null = agendamento excluído (usar só os vínculos do snapshot). */
  appointment: { id: string; status: string } | null;
  appointmentId: string;
  connections: SyncConnection[];
  events: LinkedEvent[];
  professional: ProfessionalResolution;
};

export type SyncWarning = "PROFESSIONAL_NOT_IDENTIFIED" | "PROFESSIONAL_AMBIGUOUS" | "INVALID_ATTENDEE_EMAIL";

export type SyncAction =
  /** Cria (existing=false, com fallback para patch em 409) ou atualiza o evento. withStatus cancelled nunca é gerado aqui. */
  | { type: "UPSERT_EVENT"; connectionId: string; role: LinkRole; googleEventId: string; existing: boolean; attendeeEmail: string | null; sendUpdates: "all" | "none" }
  | { type: "CANCEL_EVENT"; connectionId: string; role: LinkRole; googleEventId: string; sendUpdates: "all" | "none" }
  | { type: "DELETE_EVENT"; connectionId: string; role: LinkRole; googleEventId: string; sendUpdates: "all" | "none" }
  /** Depois do evento central: confirma na agenda individual que o convite chegou (RECEIVED) ou marca PENDING_INVITE. Nunca cria cópia. */
  | { type: "VERIFY_INVITE"; centralConnectionId: string; centralGoogleEventId: string; individualConnectionId: string }
  /** Sem chamada ao Google: só atualiza o vínculo (evento recebido por convite que o Google já retirou). */
  | { type: "UNLINK"; connectionId: string; googleEventId: string; reason: "REASSIGNED" | "CANCELLED" | "DELETED" }
  | { type: "SKIP"; connectionId: string; googleEventId: string | null; reason: "CONNECTION_NOT_CONNECTED" };

export type SyncPlan = { actions: SyncAction[]; warnings: SyncWarning[] };

const isConnected = (connection: SyncConnection | undefined): connection is SyncConnection => connection?.status === "CONNECTED";
// Individual "independente" = criado pelo Harmonize na agenda do profissional (não é convite recebido).
const isIndependent = (event: LinkedEvent) => event.role === "INDIVIDUAL" && event.syncStatus !== "RECEIVED" && event.syncStatus !== "PENDING_INVITE";
const isInviteBased = (event: LinkedEvent) => event.role === "INDIVIDUAL" && (event.syncStatus === "RECEIVED" || event.syncStatus === "PENDING_INVITE");

/** Convida o attendee quando há convidado ou havia (remover convidado também precisa avisar). */
const updatesFor = (...emails: Array<string | null | undefined>): "all" | "none" => (emails.some(Boolean) ? "all" : "none");

/** Ações por evento já vinculado quando o agendamento foi excluído ou cancelado. */
function teardown(events: LinkedEvent[], byId: Map<string, SyncConnection>, mode: "CANCEL" | "DELETE"): SyncAction[] {
  const out: SyncAction[] = [];
  for (const event of events) {
    const connection = byId.get(event.connectionId);
    if (!isConnected(connection)) {
      out.push({ type: "SKIP", connectionId: event.connectionId, googleEventId: event.googleEventId, reason: "CONNECTION_NOT_CONNECTED" });
      continue;
    }
    if (isInviteBased(event)) {
      out.push({ type: "UNLINK", connectionId: event.connectionId, googleEventId: event.googleEventId, reason: mode === "CANCEL" ? "CANCELLED" : "DELETED" });
      continue;
    }
    const sendUpdates = updatesFor(event.role === "CENTRAL" ? event.attendeeEmail : null);
    out.push(
      mode === "CANCEL" && event.role === "CENTRAL"
        ? { type: "CANCEL_EVENT", connectionId: event.connectionId, role: event.role, googleEventId: event.googleEventId, sendUpdates }
        : { type: "DELETE_EVENT", connectionId: event.connectionId, role: event.role, googleEventId: event.googleEventId, sendUpdates },
    );
  }
  return out;
}

/**
 * Plano idempotente para um agendamento. Reexecutar o plano com o mesmo estado (ou sem vínculos, como numa reconexão/backfill)
 * produz o mesmo googleEventId (determinístico) e nunca um segundo evento para o mesmo (agendamento, conexão).
 * Conexões não CONNECTED nunca recebem chamadas (SKIP); eventos antigos delas ficam como histórico.
 */
export function planCalendarSync(input: SyncPlanInput): SyncPlan {
  const byId = new Map(input.connections.map((connection) => [connection.id, connection]));
  const warnings: SyncWarning[] = [];

  if (!input.appointment) return { actions: teardown(input.events, byId, "DELETE"), warnings };
  if (appointmentIsCancelled(input.appointment.status)) return { actions: teardown(input.events, byId, "CANCEL"), warnings };

  const appointmentId = input.appointmentId;
  const central = input.connections.find((connection) => connection.type === "ADMIN" && connection.status === "CONNECTED");
  const professional = input.professional.ok ? input.professional.professional : null;
  if (!input.professional.ok) warnings.push(input.professional.reason === "AMBIGUOUS" ? "PROFESSIONAL_AMBIGUOUS" : "PROFESSIONAL_NOT_IDENTIFIED");
  const individual = professional ? input.connections.find((connection) => connection.type === "PROFESSIONAL" && connection.userId === professional.userId && connection.status === "CONNECTED") : undefined;

  const actions: SyncAction[] = [];
  const eventOf = (connectionId: string) => input.events.find((event) => event.connectionId === connectionId);

  // 1) Eventos de pessoas que já não são o profissional atual (troca de profissional ou nome não identificado).
  // Profissional não identificado: nunca apaga evento individual independente já existente (conservador); só desvincula convites recebidos.
  const stale = input.events.filter((event) => {
    if (event.role !== "INDIVIDUAL") return false;
    if (!professional) return isInviteBased(event);
    const owner = byId.get(event.connectionId)?.userId;
    return !owner || owner !== professional.userId;
  });
  const staleActions = teardown(stale, byId, "DELETE").map((action) => (action.type === "UNLINK" ? { ...action, reason: "REASSIGNED" as const } : action));

  // 2) Convidado e individual do profissional atual.
  const individualEvent = individual ? eventOf(individual.id) : undefined;
  const inviteEmail = individual ? individual.googleEmail : professional?.email ?? null;
  const independentExists = Boolean(individualEvent && isIndependent(individualEvent));
  const sameAccountAsCentral = Boolean(central && inviteEmail && normalizeCalendarEmail(inviteEmail) === normalizeCalendarEmail(central.googleEmail));
  let attendeeEmail: string | null = null;
  if (central && professional && !independentExists && !sameAccountAsCentral) {
    if (isValidCalendarEmail(inviteEmail)) attendeeEmail = normalizeCalendarEmail(inviteEmail);
    else warnings.push("INVALID_ATTENDEE_EMAIL");
  }

  // 3) Evento central.
  const centralEvent = central ? eventOf(central.id) : undefined;
  if (central) {
    actions.push({
      type: "UPSERT_EVENT",
      connectionId: central.id,
      role: "CENTRAL",
      googleEventId: centralEvent?.googleEventId ?? calendarEventId(central.id, appointmentId),
      existing: Boolean(centralEvent),
      attendeeEmail,
      sendUpdates: updatesFor(attendeeEmail, centralEvent?.attendeeEmail),
    });
  }
  // Eventos centrais de conexões que já não estão ativas ficam como histórico.
  for (const event of input.events) {
    if (event.role === "CENTRAL" && event.connectionId !== central?.id && !isConnected(byId.get(event.connectionId))) {
      actions.push({ type: "SKIP", connectionId: event.connectionId, googleEventId: event.googleEventId, reason: "CONNECTION_NOT_CONNECTED" });
    }
  }

  actions.push(...staleActions);

  // 4) Agenda individual do profissional atual.
  if (individual && professional) {
    const centralGoogleEventId = central ? centralEvent?.googleEventId ?? calendarEventId(central.id, appointmentId) : null;
    if (central && attendeeEmail && centralGoogleEventId) {
      // Convidado pelo evento central: só verifica o recebimento (não cria cópia). Se já havia independente, ele foi tratado antes (attendee nulo).
      if (individualEvent?.syncStatus !== "RECEIVED") actions.push({ type: "VERIFY_INVITE", centralConnectionId: central.id, centralGoogleEventId, individualConnectionId: individual.id });
    } else if (!sameAccountAsCentral && !(individualEvent && isInviteBased(individualEvent))) {
      // Sem central (ou central que não o convida): evento independente único. Convite já recebido conta como evento da pessoa.
      actions.push({
        type: "UPSERT_EVENT",
        connectionId: individual.id,
        role: "INDIVIDUAL",
        googleEventId: individualEvent?.googleEventId ?? calendarEventId(individual.id, appointmentId),
        existing: Boolean(individualEvent),
        attendeeEmail: null,
        sendUpdates: "none",
      });
    }
  } else if (professional) {
    // Profissional sem conta própria conectada: se havia evento individual dele em conexão desligada, vira histórico.
    for (const event of input.events) {
      if (event.role === "INDIVIDUAL" && byId.get(event.connectionId)?.userId === professional.userId && !isConnected(byId.get(event.connectionId))) {
        actions.push({ type: "SKIP", connectionId: event.connectionId, googleEventId: event.googleEventId, reason: "CONNECTION_NOT_CONNECTED" });
      }
    }
  }

  return { actions, warnings };
}

// ---------- backoff e jobs ----------

export const MAX_SYNC_ATTEMPTS = 6;
export const SYNC_BACKOFF_MINUTES = [1, 2, 4, 8, 16] as const;
export const STALE_LOCK_MS = 5 * 60_000;

export type SyncErrorKind = "auth" | "notFound" | "conflict" | "rateLimit" | "transient" | "permanent";

/** Atraso (min) após a falha de número `attempts` (já contando a falha atual): 1, 2, 4, 8, 16. */
export function backoffMinutes(attempts: number) {
  return SYNC_BACKOFF_MINUTES[Math.min(Math.max(attempts, 1), SYNC_BACKOFF_MINUTES.length) - 1];
}

export type RetryDecision =
  | { status: "PENDING"; nextRetryAt: Date; attempts: number }
  | { status: "FAILED"; attempts: number; markConnectionError: boolean; message: string };

/** Falha de uma tentativa -> reagendar ou encerrar. `attemptsBefore` = tentativas já feitas antes desta. */
export const AUTH_FAILURE_MESSAGE = "Conexão com o Google inválida: reconecte a conta.";

export function decideJobFailure(input: { kind: SyncErrorKind; attemptsBefore: number; now: Date; retryAfterSeconds?: number | null }): RetryDecision {
  const attempts = input.attemptsBefore + 1;
  if (input.kind === "auth") return { status: "FAILED", attempts, markConnectionError: true, message: AUTH_FAILURE_MESSAGE };
  if (input.kind === "rateLimit" || input.kind === "transient") {
    if (attempts >= MAX_SYNC_ATTEMPTS) return { status: "FAILED", attempts, markConnectionError: false, message: "Falha temporária persistente no Google Agenda." };
    const delayMs = Math.max(backoffMinutes(attempts) * 60_000, (input.retryAfterSeconds ?? 0) * 1000);
    return { status: "PENDING", attempts, nextRetryAt: new Date(input.now.getTime() + delayMs) };
  }
  return { status: "FAILED", attempts, markConnectionError: false, message: "O Google Agenda recusou a operação." };
}

export const jobDedupeKey = (appointmentId: string, operation: JobOperation) => `${appointmentId}:${operation}`;

export type JobOperation = "CREATE" | "UPDATE" | "DELETE";
export type PendingJobRef = { id: string; operation: JobOperation };

export type EnqueueDecision = { insert: boolean; supersedeIds: string[] };

/**
 * Coalescência entre jobs PENDING do mesmo agendamento (o processamento é baseado em estado, então CREATE/UPDATE equivalem).
 * DELETE sobrepõe tudo (e ignora enfileiramentos posteriores de CREATE/UPDATE). Jobs em PROCESSING não entram: enfileira-se outro.
 */
export function decideEnqueue(incoming: JobOperation, pending: PendingJobRef[]): EnqueueDecision {
  if (incoming === "DELETE") {
    if (pending.some((job) => job.operation === "DELETE")) return { insert: false, supersedeIds: [] };
    return { insert: true, supersedeIds: pending.map((job) => job.id) };
  }
  return { insert: pending.length === 0, supersedeIds: [] };
}

export type JobSnapshot = { events: LinkedEvent[] };

/** Mínimo para um DELETE depois que o agendamento some: vínculos e ids de conexão/evento. Sem dado clínico. */
export function buildJobSnapshot(events: LinkedEvent[]): JobSnapshot {
  return {
    events: events.map((event) => ({
      connectionId: event.connectionId,
      role: event.role,
      googleEventId: event.googleEventId,
      attendeeEmail: event.attendeeEmail,
      syncStatus: event.syncStatus,
    })),
  };
}

const ROLES = ["CENTRAL", "INDIVIDUAL"];
const LINK_STATUSES = ["SYNCED", "PENDING_INVITE", "RECEIVED", "CANCELLED", "ERROR"];

export function parseJobSnapshot(value: unknown): JobSnapshot | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as { events?: unknown }).events)) return null;
  const events: LinkedEvent[] = [];
  for (const raw of (value as { events: unknown[] }).events) {
    const item = raw as Partial<LinkedEvent> | null;
    if (!item || typeof item.connectionId !== "string" || typeof item.googleEventId !== "string" || !ROLES.includes(item.role as string)) return null;
    events.push({
      connectionId: item.connectionId,
      googleEventId: item.googleEventId,
      role: item.role as LinkRole,
      attendeeEmail: typeof item.attendeeEmail === "string" ? item.attendeeEmail : null,
      syncStatus: LINK_STATUSES.includes(item.syncStatus as string) ? (item.syncStatus as LinkSyncStatus) : "SYNCED",
    });
  }
  return { events };
}

/** Job elegível: PENDING com nextRetryAt vencido, ou PROCESSING com trava antiga (> 5 min). */
export function isJobRunnable(job: { status: string; nextRetryAt: Date; lockedAt: Date | null }, now: Date) {
  if (job.status === "PENDING") return job.nextRetryAt.getTime() <= now.getTime();
  if (job.status === "PROCESSING") return !job.lockedAt || now.getTime() - job.lockedAt.getTime() > STALE_LOCK_MS;
  return false;
}
