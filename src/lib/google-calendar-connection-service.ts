// Estado e desconexão das conexões do Google Agenda (banco e cliente injetados). Escopo SEMPRE pela sessão (clinicId/userId do usuário
// autenticado); nunca devolve tokens nem hashes; o profissional não vê e-mail/dados de outros.
import type { PrismaClient } from "@prisma/client";
import type { GoogleCalendarClient } from "./google-calendar-client.ts";
import { parseConnectionType, type CalendarConnectionType } from "./google-calendar-rules.ts";
import { canConnectCalendar, type CalendarActor } from "./google-calendar-oauth-service.ts";
import { decryptGoogleToken } from "./secret-box.ts";

type Env = Record<string, string | undefined>;

export type ConnectionState = {
  /** CONNECTED | ERROR | DISCONNECTED | NOT_CONNECTED */
  status: string;
  connected: boolean;
  googleEmail: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  syncedEvents: number;
  pendingJobs: number | null;
  failedJobs: number | null;
  /** Conexão central feita por outra pessoa (só informativo para o ADMIN). */
  connectedByOther?: boolean;
};

export type CalendarStatus = {
  configured: boolean;
  canConnectCentral: boolean;
  canConnectIndividual: boolean;
  central: ConnectionState;
  individual: ConnectionState;
};

const none = (): ConnectionState => ({ status: "NOT_CONNECTED", connected: false, googleEmail: null, lastSyncAt: null, lastError: null, syncedEvents: 0, pendingJobs: null, failedJobs: null });

const activeCentral = (clinicId: string) => ({ clinicId, connectionType: "ADMIN", status: { not: "DISCONNECTED" } });

export async function loadCalendarStatus(db: PrismaClient, user: CalendarActor, configured: boolean): Promise<CalendarStatus> {
  const clinicId = user.clinicId;
  const canCentral = canConnectCalendar(user, "ADMIN");
  const canIndividual = canConnectCalendar(user, "PROFESSIONAL");
  const select = { id: true, status: true, googleEmail: true, lastSyncAt: true, lastError: true, userId: true } as const;
  const [centralRow, individualRow] = await Promise.all([
    db.googleCalendarConnection.findFirst({ where: activeCentral(clinicId), select }),
    canIndividual ? db.googleCalendarConnection.findUnique({ where: { clinicId_connectionType_userId: { clinicId, connectionType: "PROFESSIONAL", userId: user.id } }, select }) : null,
  ]);

  const central = none();
  if (centralRow) {
    central.status = centralRow.status;
    central.connected = centralRow.status === "CONNECTED";
    // PROFESSIONAL/STAFF só sabem que existe uma central: nada de e-mail, contadores nem erro de outra pessoa.
    if (canCentral) {
      const [synced, pending, failed] = await Promise.all([
        db.googleCalendarEvent.count({ where: { clinicId, connectionId: centralRow.id, syncStatus: { in: ["SYNCED", "RECEIVED"] } } }),
        db.calendarSyncJob.count({ where: { clinicId, status: { in: ["PENDING", "PROCESSING"] } } }),
        db.calendarSyncJob.count({ where: { clinicId, status: "FAILED" } }),
      ]);
      central.googleEmail = centralRow.googleEmail;
      central.lastSyncAt = centralRow.lastSyncAt?.toISOString() ?? null;
      central.lastError = centralRow.lastError;
      central.syncedEvents = synced;
      central.pendingJobs = pending;
      central.failedJobs = failed;
      central.connectedByOther = centralRow.userId !== user.id;
    }
  }

  const individual = none();
  if (individualRow && individualRow.status !== "DISCONNECTED") {
    individual.status = individualRow.status;
    individual.connected = individualRow.status === "CONNECTED";
    individual.googleEmail = individualRow.googleEmail;
    individual.lastSyncAt = individualRow.lastSyncAt?.toISOString() ?? null;
    individual.lastError = individualRow.lastError;
    individual.syncedEvents = await db.googleCalendarEvent.count({ where: { clinicId, connectionId: individualRow.id, syncStatus: { in: ["SYNCED", "RECEIVED"] } } });
  }
  return { configured, canConnectCentral: canCentral, canConnectIndividual: canIndividual, central, individual };
}

/** Conexão central ativa de OUTRA pessoa na clínica (impede iniciar outra OAuth que falharia no índice único). */
export async function centralOwnedByAnother(db: Pick<PrismaClient, "googleCalendarConnection">, user: CalendarActor) {
  const row = await db.googleCalendarConnection.findFirst({ where: { ...activeCentral(user.clinicId), userId: { not: user.id } }, select: { id: true } });
  return Boolean(row);
}

export type DisconnectResult = { ok: true; revoked: boolean } | { ok: false; status: 400 | 403 | 404; message: string };

export async function disconnectCalendar(
  deps: { db: PrismaClient; client: Pick<GoogleCalendarClient, "revokeToken">; env?: Env },
  input: { user: CalendarActor; type: unknown },
): Promise<DisconnectResult> {
  const type: CalendarConnectionType | null = parseConnectionType(input.type);
  if (!type) return { ok: false, status: 400, message: "Tipo de conexão inválido." };
  const { user } = input;
  if (!canConnectCalendar(user, type)) return { ok: false, status: 403, message: type === "ADMIN" ? "Apenas administradores podem desconectar a agenda central." : "Seu cargo não permite esta ação." };

  // ADMIN desconecta a central da clínica; PROFESSIONAL só a própria. Nunca a individual de outra pessoa.
  const connection = await deps.db.googleCalendarConnection.findFirst({
    where: type === "ADMIN" ? activeCentral(user.clinicId) : { clinicId: user.clinicId, connectionType: "PROFESSIONAL", userId: user.id, status: { not: "DISCONNECTED" } },
    select: { id: true, googleAccountId: true, refreshTokenEncrypted: true },
  });
  if (!connection) return { ok: false, status: 404, message: "Nenhuma conexão ativa para desconectar." };

  // Revogar derruba a concessão inteira da conta no nosso app: se a mesma conta Google serve outra conexão ativa, só desconecta aqui.
  let revoked = false;
  const shared = connection.googleAccountId
    ? await deps.db.googleCalendarConnection.count({ where: { googleAccountId: connection.googleAccountId, id: { not: connection.id }, status: { not: "DISCONNECTED" } } })
    : 0;
  if (!shared && connection.refreshTokenEncrypted) {
    try {
      await deps.client.revokeToken(decryptGoogleToken(connection.refreshTokenEncrypted, deps.env));
      revoked = true;
    } catch {
      // best-effort: a conexão é desligada localmente mesmo assim
    }
  }
  await deps.db.googleCalendarConnection.updateMany({
    where: { id: connection.id, clinicId: user.clinicId },
    data: { status: "DISCONNECTED", accessTokenEncrypted: null, refreshTokenEncrypted: null, tokenExpiresAt: null, lastError: null },
  });
  return { ok: true, revoked };
}
