// Access token válido de uma conexão do Google Agenda: decifra, renova com margem de 60 s e persiste o novo token cifrado.
// invalid_grant/401 (ou chave de cifra trocada) => conexão ERROR com mensagem sem segredos. Nunca loga tokens.
import type { PrismaClient } from "@prisma/client";
import { GoogleCalendarError, type GoogleCalendarClient } from "./google-calendar-client.ts";
import { decryptGoogleToken, encryptGoogleToken } from "./secret-box.ts";

export const TOKEN_REFRESH_MARGIN_MS = 60_000;
export const RECONNECT_MESSAGE = "Conexão com o Google inválida: reconecte a conta.";

type Db = Pick<PrismaClient, "googleCalendarConnection">;
type Env = Record<string, string | undefined>;

export type TokenDeps = { db: Db; client: Pick<GoogleCalendarClient, "refreshAccessToken">; now?: () => Date; env?: Env };

/** Marca ERROR só se ainda estiver CONNECTED (não desfaz uma desconexão manual concorrente). */
export async function markConnectionError(db: Db, connectionId: string, clinicId: string, message: string = RECONNECT_MESSAGE) {
  await db.googleCalendarConnection.updateMany({ where: { id: connectionId, clinicId, status: "CONNECTED" }, data: { status: "ERROR", lastError: message.slice(0, 300) } });
}

export type ConnectionAccess = { accessToken: string; calendarId: string };

/**
 * Lança GoogleCalendarError("auth") quando a conexão não é utilizável (marcando ERROR); erros transitórios do refresh
 * (rede/5xx/429) são relançados sem alterar a conexão.
 */
export async function getConnectionAccess(deps: TokenDeps, connectionId: string, clinicId: string): Promise<ConnectionAccess> {
  const now = (deps.now ?? (() => new Date()))();
  const connection = await deps.db.googleCalendarConnection.findFirst({
    where: { id: connectionId, clinicId },
    select: { id: true, status: true, calendarId: true, accessTokenEncrypted: true, refreshTokenEncrypted: true, tokenExpiresAt: true },
  });
  if (!connection || connection.status !== "CONNECTED") throw new GoogleCalendarError("auth", null, "connection_inactive");

  let refreshToken: string | null = null;
  try {
    if (connection.accessTokenEncrypted && connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() - now.getTime() > TOKEN_REFRESH_MARGIN_MS) {
      return { accessToken: decryptGoogleToken(connection.accessTokenEncrypted, deps.env), calendarId: connection.calendarId };
    }
    refreshToken = connection.refreshTokenEncrypted ? decryptGoogleToken(connection.refreshTokenEncrypted, deps.env) : null;
  } catch {
    // Chave de cifra trocada/payload corrompido: só reconectando.
    await markConnectionError(deps.db, connection.id, clinicId);
    throw new GoogleCalendarError("auth", null, "decrypt_failed");
  }
  if (!refreshToken) {
    await markConnectionError(deps.db, connection.id, clinicId);
    throw new GoogleCalendarError("auth", null, "no_refresh_token");
  }

  let refreshed;
  try {
    refreshed = await deps.client.refreshAccessToken(refreshToken);
  } catch (error) {
    if (error instanceof GoogleCalendarError && error.kind === "auth") await markConnectionError(deps.db, connection.id, clinicId);
    throw error;
  }

  const expiresAt = new Date(now.getTime() + refreshed.expiresInSeconds * 1000);
  // Update condicional: se outra execução já renovou (refresh/expiração mudaram), não sobrescreve; o token obtido continua válido para esta chamada.
  await deps.db.googleCalendarConnection.updateMany({
    where: { id: connection.id, clinicId, status: "CONNECTED", refreshTokenEncrypted: connection.refreshTokenEncrypted, tokenExpiresAt: connection.tokenExpiresAt },
    data: {
      accessTokenEncrypted: encryptGoogleToken(refreshed.accessToken, deps.env),
      tokenExpiresAt: expiresAt,
      ...(refreshed.refreshToken ? { refreshTokenEncrypted: encryptGoogleToken(refreshed.refreshToken, deps.env) } : {}),
      lastError: null,
    },
  });
  return { accessToken: refreshed.accessToken, calendarId: connection.calendarId };
}
