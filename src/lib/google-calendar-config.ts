// Configuração do Google Agenda a partir do ambiente: credenciais, redirect URI e fábrica do cliente REST.
// Sem Prisma. "Não configurado" (null) nunca quebra agendamentos: só desliga a integração.
import { createRemoteJWKSet } from "jose";
import { createGoogleCalendarClient, type FetchLike, type GoogleCalendarClient } from "./google-calendar-client.ts";
import { resolveAppOrigin, resolveCalendarRedirectUri } from "./google-calendar-rules.ts";
import { verifyGoogleIdToken } from "./google-oauth.ts";

type Env = Record<string, string | undefined>;

export type CalendarConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  appOrigin: string | null;
  /** Servidor Google falso local (só fora de produção e só loopback). null no uso normal. */
  fakeBase: string | null;
};

/**
 * GOOGLE_CALENDAR_FAKE_BASE_URL aponta os endpoints (token, revoke, calendar v3, JWKS) para um servidor local de teste.
 * Ignorada em produção e para qualquer host que não seja loopback: nunca desvia tokens reais para fora.
 */
export function resolveFakeGoogleBase(env: Env = process.env): string | null {
  if (env.NODE_ENV === "production") return null;
  const raw = env.GOOGLE_CALENDAR_FAKE_BASE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getCalendarConfig(env: Env = process.env): CalendarConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const redirectUri = resolveCalendarRedirectUri(env);
  if (!redirectUri) return null;
  return { clientId, clientSecret, redirectUri, appOrigin: resolveAppOrigin(env), fakeBase: resolveFakeGoogleBase(env) };
}

export function createCalendarClient(config: CalendarConfig, fetchImpl?: FetchLike): GoogleCalendarClient {
  const base = config.fakeBase;
  return createGoogleCalendarClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
    ...(base ? { endpoints: { api: `${base}/calendar/v3`, token: `${base}/token`, revoke: `${base}/revoke` } } : {}),
  });
}

/** Verificador do id_token do consentimento: o mesmo verifyGoogleIdToken do login (JWKS do Google; do servidor falso quando configurado). */
export function createIdTokenVerifier(config: CalendarConfig): (idToken: string) => Promise<Record<string, unknown>> {
  const keys = config.fakeBase ? createRemoteJWKSet(new URL(`${config.fakeBase}/oauth2/v3/certs`), { timeoutDuration: 8_000 }) : undefined;
  return (idToken) => verifyGoogleIdToken(idToken, config.clientId, keys);
}
