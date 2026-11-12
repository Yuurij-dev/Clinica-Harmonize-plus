// Fluxo OAuth do Google Agenda (conectar uma conta): início com PKCE/state em cookie assinado próprio (typ "gcal")
// e callback com todas as validações. Dependências injetadas (sem Next, sem rede real). Nunca logar code, tokens, state, nonce ou verifier.
import { jwtVerify, SignJWT } from "jose";
import type { PrismaClient } from "@prisma/client";
import { GoogleCalendarError, type GoogleCalendarClient } from "./google-calendar-client.ts";
import { buildCalendarAuthUrl, hasCalendarScope, parseConnectionType, normalizeCalendarEmail, GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID, type CalendarConnectionType } from "./google-calendar-rules.ts";
import type { CalendarConfig } from "./google-calendar-config.ts";
import { codeChallengeFor, generateCodeVerifier, generateOauthNonce, generateOauthState, OAUTH_FLOW_TTL_SECONDS, safeEqual, validateGoogleClaims } from "./google-oauth-rules.ts";
import { canForUser } from "./permissions.ts";
import { encryptGoogleToken } from "./secret-box.ts";

export const CALENDAR_FLOW_COOKIE = "harmonize_gcal_oauth";
export const SETTINGS_REDIRECT = "/configuracoes";

export type CalendarOutcome = "connected" | "denied" | "error" | "forbidden" | "already_central" | "no_scope" | "no_refresh" | "unavailable";
/** Destino fixo (sem returnTo do cliente) e sem tokens: só um código estável na query. */
export const calendarOutcomeRedirect = (outcome: CalendarOutcome) => `${SETTINGS_REDIRECT}?gcal=${outcome}`;

export type CalendarActor = { id: string; clinicId: string; role: string; isOwner?: boolean; rolePermissions?: unknown };

/** ADMIN (central): settings:manage ou dono. PROFESSIONAL (individual): papel ADMIN ou PROFESSIONAL. */
export function canConnectCalendar(user: CalendarActor, type: CalendarConnectionType) {
  if (type === "ADMIN") return canForUser(user, "settings:manage") || Boolean(user.isOwner);
  return user.role === "ADMIN" || user.role === "PROFESSIONAL";
}

// ---------- cookie de fluxo ----------

export type CalendarFlow = { state: string; nonce: string; codeVerifier: string; userId: string; clinicId: string; connectionType: CalendarConnectionType };

export async function signCalendarFlow(flow: CalendarFlow, secret: Uint8Array, ttlSeconds = OAUTH_FLOW_TTL_SECONDS) {
  return new SignJWT({ typ: "gcal", ...flow })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secret);
}

export async function verifyCalendarFlow(token: string | null | undefined, secret: Uint8Array): Promise<CalendarFlow | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    if (payload.typ !== "gcal") return null;
    const { state, nonce, codeVerifier, userId, clinicId } = payload;
    const connectionType = parseConnectionType(payload.connectionType);
    if (typeof state !== "string" || typeof nonce !== "string" || typeof codeVerifier !== "string" || typeof userId !== "string" || typeof clinicId !== "string" || !connectionType) return null;
    return { state, nonce, codeVerifier, userId, clinicId, connectionType };
  } catch {
    return null;
  }
}

// ---------- início ----------

export type StartResult =
  | { ok: true; url: string; flowCookie: { value: string; maxAge: number } }
  | { ok: false; status: 400 | 403 | 503; message: string };

export async function startCalendarOAuth(input: { user: CalendarActor; loginHint?: string; type: unknown; config: CalendarConfig | null; secret: Uint8Array }): Promise<StartResult> {
  if (!input.config) return { ok: false, status: 503, message: "A integração com o Google Agenda não está configurada." };
  const type = parseConnectionType(input.type);
  if (!type) return { ok: false, status: 400, message: "Tipo de conexão inválido." };
  if (!canConnectCalendar(input.user, type)) {
    return { ok: false, status: 403, message: type === "ADMIN" ? "Apenas administradores podem conectar a agenda central da clínica." : "Seu cargo não permite conectar uma agenda individual." };
  }
  const state = generateOauthState();
  const nonce = generateOauthNonce();
  const codeVerifier = generateCodeVerifier();
  const value = await signCalendarFlow({ state, nonce, codeVerifier, userId: input.user.id, clinicId: input.user.clinicId, connectionType: type }, input.secret);
  const url = buildCalendarAuthUrl({ clientId: input.config.clientId, redirectUri: input.config.redirectUri, state, nonce, codeChallenge: codeChallengeFor(codeVerifier), loginHint: input.loginHint });
  return { ok: true, url, flowCookie: { value, maxAge: OAUTH_FLOW_TTL_SECONDS } };
}

// ---------- callback ----------

type Db = Pick<PrismaClient, "googleCalendarConnection" | "googleCalendarEvent">;

export type CalendarCallbackDeps = {
  config: CalendarConfig | null;
  secret: Uint8Array;
  now: () => Date;
  db: Db;
  client: Pick<GoogleCalendarClient, "exchangeCode">;
  verifyIdToken: (idToken: string) => Promise<Record<string, unknown>>;
  /** Sessão atual (getCurrentUser), nunca confiar no cookie de fluxo para identidade. */
  getSessionUser: () => Promise<CalendarActor | null>;
  /** Enfileira o backfill depois de conectar (falha aqui não desfaz a conexão). */
  enqueueBackfill: (input: { clinicId: string; connectionType: CalendarConnectionType; userId: string }) => Promise<void>;
  env?: Record<string, string | undefined>;
};

export type CalendarCallbackInput = { error?: string | null; code?: string | null; state?: string | null; flowToken?: string | null };
export type CalendarCallbackResult = { redirect: string; connectionId?: string; connectionType?: CalendarConnectionType; clinicId?: string };

const isUniqueViolation = (error: unknown) => (error as { code?: unknown } | null)?.code === "P2002";

function diag(code: string) {
  console.warn("[google-calendar-oauth]", /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : "unknown");
}

export async function handleCalendarCallback(deps: CalendarCallbackDeps, input: CalendarCallbackInput): Promise<CalendarCallbackResult> {
  const fail = (outcome: CalendarOutcome) => ({ redirect: calendarOutcomeRedirect(outcome) });
  if (!deps.config) return fail("unavailable");
  if (input.error) return fail(input.error === "access_denied" ? "denied" : "error");

  const flow = await verifyCalendarFlow(input.flowToken, deps.secret);
  if (!flow || !input.code || !safeEqual(input.state, flow.state)) return fail("error");

  // Sessão atual precisa ser a mesma pessoa/clínica que iniciou o fluxo, e ainda ter permissão.
  const user = await deps.getSessionUser();
  if (!user || user.id !== flow.userId || user.clinicId !== flow.clinicId) return fail("error");
  if (!canConnectCalendar(user, flow.connectionType)) return fail("forbidden");

  let tokens;
  let claims;
  try {
    tokens = await deps.client.exchangeCode({ code: input.code, codeVerifier: flow.codeVerifier });
    if (!tokens.idToken) throw new GoogleCalendarError("permanent", null, "no_id_token");
    const verified = validateGoogleClaims(await deps.verifyIdToken(tokens.idToken), { clientId: deps.config.clientId, nonce: flow.nonce, now: deps.now() });
    if (!verified.ok) throw new GoogleCalendarError("permanent", null, verified.reason);
    claims = verified;
  } catch (error) {
    diag(error instanceof GoogleCalendarError ? error.reason ?? error.kind : "exchange_failed");
    return fail("error");
  }

  // Sem revogar: a concessão (grant) é compartilhada com outras conexões da mesma conta Google.
  if (!hasCalendarScope(tokens.scope)) return fail("no_scope");

  const now = deps.now();
  const googleEmail = normalizeCalendarEmail(claims.email);
  const where = { clinicId_connectionType_userId: { clinicId: flow.clinicId, connectionType: flow.connectionType, userId: flow.userId } };

  const save = async () => {
    const existing = await deps.db.googleCalendarConnection.findUnique({ where, select: { id: true, googleEmail: true, googleAccountId: true, refreshTokenEncrypted: true } });
    // Preserva o refresh token existente quando o Google não manda outro (reconexão).
    const refreshTokenEncrypted = tokens.refreshToken ? encryptGoogleToken(tokens.refreshToken, deps.env) : existing?.refreshTokenEncrypted ?? null;
    if (!refreshTokenEncrypted) return { error: "no_refresh" as const };
    const data = {
      googleEmail,
      googleAccountId: claims.sub,
      calendarId: GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID,
      accessTokenEncrypted: encryptGoogleToken(tokens.accessToken, deps.env),
      refreshTokenEncrypted,
      tokenExpiresAt: new Date(now.getTime() + tokens.expiresInSeconds * 1000),
      scope: tokens.scope,
      status: "CONNECTED",
      lastError: null,
    };
    if (!existing) {
      const created = await deps.db.googleCalendarConnection.create({ data: { clinicId: flow.clinicId, userId: flow.userId, connectionType: flow.connectionType, ...data }, select: { id: true } });
      return { id: created.id };
    }
    // Outra conta Google na mesma conexão: os vínculos antigos apontam para a agenda anterior e são descartados (o backfill recria na nova).
    const changedAccount = (existing.googleAccountId && existing.googleAccountId !== claims.sub) || normalizeCalendarEmail(existing.googleEmail) !== googleEmail;
    if (changedAccount) await deps.db.googleCalendarEvent.deleteMany({ where: { connectionId: existing.id, clinicId: flow.clinicId } });
    await deps.db.googleCalendarConnection.update({ where: { id: existing.id }, data });
    return { id: existing.id };
  };

  let saved: { id: string } | { error: "no_refresh" };
  try {
    saved = await save();
  } catch (error) {
    if (!isUniqueViolation(error)) {
      diag("save_failed");
      return fail("error");
    }
    // P2002: ou a agenda central da clínica já é de outra conexão (índice parcial) ou houve corrida na mesma conexão.
    try {
      saved = await save();
    } catch (retry) {
      if (isUniqueViolation(retry) && flow.connectionType === "ADMIN") {
        return fail("already_central");
      }
      diag("save_failed");
      return fail("error");
    }
  }
  if ("error" in saved) {
    return fail("no_refresh");
  }

  try {
    await deps.enqueueBackfill({ clinicId: flow.clinicId, connectionType: flow.connectionType, userId: flow.userId });
  } catch {
    diag("backfill_enqueue_failed");
  }
  return { redirect: calendarOutcomeRedirect("connected"), connectionId: saved.id, connectionType: flow.connectionType, clinicId: flow.clinicId };
}
