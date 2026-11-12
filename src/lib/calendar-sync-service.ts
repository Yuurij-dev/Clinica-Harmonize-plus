// Executa o plano de sincronização de UM agendamento contra o Google Agenda, com idempotência:
// insert com id determinístico (409 -> patch, inclusive reativar), delete 404/410 = ok, convite verificado sem criar cópia.
// Cliente do Google e banco são injetados. Nunca logar tokens nem corpo de resposta.
import type { PrismaClient } from "@prisma/client";
import { appointmentDurations } from "./appointment-conflict.ts";
import { appointmentDay } from "./clinic-time.ts";
import {
  planCalendarSync,
  professionalNotIdentifiedMessage,
  resolveProfessionalMember,
  type JobSnapshot,
  type LinkedEvent,
  type ProfessionalMember,
  type SyncAction,
  type SyncConnection,
  type SyncWarning,
} from "./calendar-sync-rules.ts";
import { GoogleCalendarError, isGoogleCalendarError, type GoogleCalendarClient, type GoogleEvent } from "./google-calendar-client.ts";
import { appointmentLink, buildEventPayload, calendarEventId, type CalendarAppointmentState } from "./google-calendar-rules.ts";
import { getConnectionAccess, markConnectionError, type ConnectionAccess } from "./google-calendar-token-service.ts";

type Env = Record<string, string | undefined>;

export type SyncDeps = {
  db: PrismaClient;
  client: Pick<GoogleCalendarClient, "refreshAccessToken" | "insertEvent" | "patchEvent" | "deleteEvent" | "getEvent" | "listEvents">;
  now?: () => Date;
  env?: Env;
  appOrigin?: string | null;
};

export type SyncOutcome = { warnings: SyncWarning[]; actions: number };

const warningMessage = (warnings: SyncWarning[]) => {
  if (warnings.includes("PROFESSIONAL_NOT_IDENTIFIED") || warnings.includes("PROFESSIONAL_AMBIGUOUS")) return professionalNotIdentifiedMessage;
  if (warnings.includes("INVALID_ATTENDEE_EMAIL")) return "e-mail do profissional inválido";
  return null;
};

/** Membros ADMIN/PROFESSIONAL da clínica (com e-mail) para resolver o profissional do agendamento. */
export async function loadProfessionalMembers(db: Pick<PrismaClient, "clinicMembership">, clinicId: string): Promise<ProfessionalMember[]> {
  const rows = await db.clinicMembership.findMany({ where: { clinicId, role: { in: ["ADMIN", "PROFESSIONAL"] } }, select: { role: true, user: { select: { id: true, name: true, email: true } } } });
  return rows.map((row) => ({ userId: row.user.id, name: row.user.name, email: row.user.email, role: row.role }));
}

/**
 * Sincroniza o agendamento com TODAS as conexões da clínica. `snapshot` só é usado quando o agendamento já não existe.
 * Executa todas as ações possíveis e, no fim, relança a primeira falha (ações são idempotentes: o retry repete sem duplicar).
 */
export async function syncAppointment(deps: SyncDeps, input: { clinicId: string; appointmentId: string; snapshot?: JobSnapshot | null }): Promise<SyncOutcome> {
  const { db, client } = deps;
  const now = deps.now ?? (() => new Date());
  const { clinicId, appointmentId } = input;

  const appointment = await db.appointment.findFirst({
    where: { id: appointmentId, clinicId },
    select: { id: true, status: true, date: true, time: true, procedure: true, professional: true, patient: { select: { name: true } } },
  });
  const connectionRows = await db.googleCalendarConnection.findMany({ where: { clinicId }, select: { id: true, userId: true, connectionType: true, status: true, googleEmail: true, calendarId: true } });
  const connections: SyncConnection[] = connectionRows.map((row) => ({ id: row.id, userId: row.userId, type: row.connectionType as SyncConnection["type"], status: row.status as SyncConnection["status"], googleEmail: row.googleEmail }));

  let events: LinkedEvent[];
  if (appointment) {
    const rows = await db.googleCalendarEvent.findMany({ where: { clinicId, appointmentId }, select: { connectionId: true, role: true, googleEventId: true, attendeeEmail: true, syncStatus: true } });
    events = rows.map((row) => ({ connectionId: row.connectionId, role: row.role as LinkedEvent["role"], googleEventId: row.googleEventId, attendeeEmail: row.attendeeEmail, syncStatus: row.syncStatus as LinkedEvent["syncStatus"] }));
  } else {
    events = input.snapshot?.events ?? [];
  }

  let state: CalendarAppointmentState | null = null;
  let professional: ReturnType<typeof resolveProfessionalMember> = { ok: false, reason: "NO_NAME" };
  if (appointment) {
    const [durationOf, members] = await Promise.all([appointmentDurations(db, clinicId, [appointment.procedure]), loadProfessionalMembers(db, clinicId)]);
    state = { status: appointment.status, day: appointmentDay(appointment.date), time: appointment.time, procedure: appointment.procedure, professional: appointment.professional, durationMinutes: durationOf(appointment.procedure) };
    professional = resolveProfessionalMember(appointment.professional, members);
  }

  const plan = planCalendarSync({ appointment: appointment ? { id: appointment.id, status: appointment.status } : null, appointmentId, connections, events, professional });
  const warning = warningMessage(plan.warnings);
  const connById = new Map(connectionRows.map((row) => [row.id, row]));
  const tokenDeps = { db, client, now, env: deps.env };
  const accessCache = new Map<string, ConnectionAccess>();
  const accessOf = async (connectionId: string) => {
    const cached = accessCache.get(connectionId);
    if (cached) return cached;
    const access = await getConnectionAccess(tokenDeps, connectionId, clinicId);
    accessCache.set(connectionId, access);
    return access;
  };
  const touched = new Set<string>();
  const failedConnections = new Set<string>();
  const iCalUidOf = new Map<string, string>(); // `${connectionId}:${googleEventId}` -> iCalUID
  let firstError: unknown = null;

  const linkKey = { appointmentId };
  const saveLink = (connectionId: string, data: { googleEventId: string; role: "CENTRAL" | "INDIVIDUAL"; attendeeEmail: string | null; syncStatus: string; lastError: string | null }) =>
    db.googleCalendarEvent.upsert({
      where: { appointmentId_connectionId: { appointmentId, connectionId } },
      create: { clinicId, appointmentId, connectionId, ...data, lastSyncedAt: now() },
      update: { ...data, lastSyncedAt: now() },
    });

  async function upsertEvent(action: Extract<SyncAction, { type: "UPSERT_EVENT" }>) {
    if (!appointment || !state) return;
    const access = await accessOf(action.connectionId);
    const payload = buildEventPayload({ ...state, appointmentId, clinicId, patientName: appointment.patient.name, attendeeEmail: action.attendeeEmail, link: appointmentLink(deps.appOrigin ?? null) });
    if (!payload) throw new GoogleCalendarError("permanent", null, "invalid_appointment_time");
    // Ids alternativos só para quando o id determinístico está "queimado" (evento apagado no Google deixa o id reservado).
    const candidates = [...new Set([action.googleEventId, calendarEventId(action.connectionId, `${appointmentId}:r1`), calendarEventId(action.connectionId, `${appointmentId}:r2`)])];
    let done: { id: string; event: GoogleEvent } | null = null;
    for (const [index, id] of candidates.entries()) {
      if (index === 0 && action.existing) {
        try {
          done = { id, event: await client.patchEvent(access.accessToken, access.calendarId, id, payload, action.sendUpdates) };
          break;
        } catch (error) {
          if (!isGoogleCalendarError(error) || error.kind !== "notFound") throw error;
        }
      }
      try {
        done = { id, event: await client.insertEvent(access.accessToken, access.calendarId, id, payload, action.sendUpdates) };
        break;
      } catch (error) {
        if (!isGoogleCalendarError(error) || error.kind !== "conflict") throw error;
      }
      try {
        // 409: já existe com este id (crash entre o Google e o banco, ou reativação): atualiza em vez de duplicar.
        done = { id, event: await client.patchEvent(access.accessToken, access.calendarId, id, payload, action.sendUpdates) };
        break;
      } catch (error) {
        if (!isGoogleCalendarError(error) || (error.kind !== "notFound" && error.kind !== "conflict")) throw error;
      }
    }
    if (!done) throw new GoogleCalendarError("permanent", null, "event_id_unavailable");
    if (done.event?.iCalUID) iCalUidOf.set(`${action.connectionId}:${done.id}`, done.event.iCalUID);
    try {
      await saveLink(action.connectionId, { googleEventId: done.id, role: action.role, attendeeEmail: action.attendeeEmail, syncStatus: "SYNCED", lastError: action.role === "CENTRAL" ? warning : null });
    } catch (error) {
      // Agendamento excluído enquanto o evento era criado: o vínculo não pode existir, então remove o evento recém-criado em vez de deixá-lo órfão.
      if (await db.appointment.findFirst({ where: { id: appointmentId, clinicId }, select: { id: true } })) throw error;
      await client.deleteEvent(access.accessToken, access.calendarId, done.id, action.sendUpdates).catch(() => undefined);
    }
  }

  async function verifyInvite(action: Extract<SyncAction, { type: "VERIFY_INVITE" }>) {
    const central = await accessOf(action.centralConnectionId);
    let iCalUID = iCalUidOf.get(`${action.centralConnectionId}:${action.centralGoogleEventId}`);
    if (!iCalUID) iCalUID = (await client.getEvent(central.accessToken, central.calendarId, action.centralGoogleEventId))?.iCalUID;
    const individual = await accessOf(action.individualConnectionId);
    let found: GoogleEvent | null = null;
    if (iCalUID) {
      const list = await client.listEvents(individual.accessToken, individual.calendarId, { iCalUID });
      found = list.items.find((item) => item.status !== "cancelled") ?? null;
    }
    // PENDING_INVITE guarda o id do evento central só como referência: nunca é usado para chamar o Google na agenda individual.
    await saveLink(action.individualConnectionId, {
      googleEventId: found?.id ?? action.centralGoogleEventId,
      role: "INDIVIDUAL",
      attendeeEmail: connById.get(action.individualConnectionId)?.googleEmail ?? null,
      syncStatus: found ? "RECEIVED" : "PENDING_INVITE",
      lastError: null,
    });
  }

  async function run(action: SyncAction) {
    switch (action.type) {
      case "UPSERT_EVENT":
        await upsertEvent(action);
        touched.add(action.connectionId);
        return;
      case "CANCEL_EVENT": {
        const access = await accessOf(action.connectionId);
        try {
          await client.patchEvent(access.accessToken, access.calendarId, action.googleEventId, { status: "cancelled" }, action.sendUpdates);
        } catch (error) {
          if (!isGoogleCalendarError(error) || error.kind !== "notFound") throw error;
        }
        await db.googleCalendarEvent.updateMany({ where: { clinicId, ...linkKey, connectionId: action.connectionId }, data: { syncStatus: "CANCELLED", lastSyncedAt: now(), lastError: null } });
        touched.add(action.connectionId);
        return;
      }
      case "DELETE_EVENT": {
        const access = await accessOf(action.connectionId);
        await client.deleteEvent(access.accessToken, access.calendarId, action.googleEventId, action.sendUpdates);
        await db.googleCalendarEvent.deleteMany({ where: { clinicId, ...linkKey, connectionId: action.connectionId } });
        touched.add(action.connectionId);
        return;
      }
      case "VERIFY_INVITE":
        if (failedConnections.has(action.centralConnectionId)) return;
        try {
          await verifyInvite(action);
        } catch (error) {
          // Verificar o recebimento é secundário: conexão individual inválida não bloqueia o evento central.
          if (!isGoogleCalendarError(error) || error.kind !== "auth") throw error;
          await markConnectionError(db, action.individualConnectionId, clinicId).catch(() => undefined);
          failedConnections.add(action.individualConnectionId);
          return;
        }
        touched.add(action.individualConnectionId);
        return;
      case "UNLINK":
        if (action.reason === "CANCELLED") await db.googleCalendarEvent.updateMany({ where: { clinicId, ...linkKey, connectionId: action.connectionId }, data: { syncStatus: "CANCELLED", lastSyncedAt: now() } });
        else await db.googleCalendarEvent.deleteMany({ where: { clinicId, ...linkKey, connectionId: action.connectionId } });
        return;
      case "SKIP":
        return;
    }
  }

  for (const action of plan.actions) {
    try {
      await run(action);
    } catch (error) {
      if ("connectionId" in action) {
        failedConnections.add(action.connectionId);
        // 401/403 de autenticação da Calendar API: a conexão reflete a realidade (ERROR). Só desfaz CONNECTED, nunca uma desconexão manual.
        if (isGoogleCalendarError(error) && error.kind === "auth") await markConnectionError(db, action.connectionId, clinicId).catch(() => undefined);
      }
      firstError ??= error;
    }
  }

  if (touched.size) {
    const ok = [...touched].filter((id) => !failedConnections.has(id));
    if (ok.length) await db.googleCalendarConnection.updateMany({ where: { id: { in: ok }, clinicId, status: "CONNECTED" }, data: { lastSyncAt: now() } });
  }
  if (firstError) throw firstError;
  return { warnings: plan.warnings, actions: plan.actions.length };
}
