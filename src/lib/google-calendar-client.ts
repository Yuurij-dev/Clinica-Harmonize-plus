// Cliente REST mínimo do Google (OAuth + Calendar v3) por `fetch` injetável. Sem SDK, sem Prisma.
// NUNCA logar tokens, code, verifier nem corpo de resposta/requisição: os erros carregam só tipo, status e motivo.
import type { GoogleEventPayload } from "./google-calendar-rules.ts";

export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
export const DEFAULT_TIMEOUT_MS = 10_000;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type GoogleErrorKind = "auth" | "notFound" | "conflict" | "rateLimit" | "transient" | "permanent";

export class GoogleCalendarError extends Error {
  readonly kind: GoogleErrorKind;
  readonly status: number | null;
  readonly reason: string | null;
  readonly retryAfterSeconds: number | null;
  constructor(kind: GoogleErrorKind, status: number | null, reason: string | null = null, retryAfterSeconds: number | null = null) {
    super(`Google ${kind}${status ? ` (${status})` : ""}${reason ? `: ${reason}` : ""}`);
    this.name = "GoogleCalendarError";
    this.kind = kind;
    this.status = status;
    this.reason = reason;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const isGoogleCalendarError = (error: unknown): error is GoogleCalendarError => error instanceof GoogleCalendarError;

const RATE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded", "calendarUsageLimitsExceeded"]);
const AUTH_REASONS = new Set(["insufficientPermissions", "forbidden", "authError", "invalid_grant", "invalid_token", "unauthorized_client", "access_denied", "invalid_client"]);

function safeReason(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,60}$/.test(value) ? value : null;
}

function retryAfter(response: Response) {
  const raw = response.headers?.get?.("retry-after");
  const seconds = raw ? Number(raw) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 3600) : null;
}

/** Mapeia status + motivo (sem expor o corpo) para um erro tipado. `tokenEndpoint`: 400/401 de token = auth. */
export function classifyGoogleResponse(status: number, body: unknown, options: { tokenEndpoint?: boolean; retryAfterSeconds?: number | null } = {}): GoogleCalendarError {
  const data = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const nested = (data.error && typeof data.error === "object" ? data.error : {}) as Record<string, unknown>;
  const first = Array.isArray(nested.errors) ? (nested.errors[0] as Record<string, unknown> | undefined) : undefined;
  const reason = safeReason(typeof data.error === "string" ? data.error : first?.reason ?? nested.status);
  const after = options.retryAfterSeconds ?? null;
  if (options.tokenEndpoint && (status === 400 || status === 401)) {
    return reason === "invalid_grant" || reason === "invalid_client" || reason === "unauthorized_client" || status === 401
      ? new GoogleCalendarError("auth", status, reason)
      : new GoogleCalendarError("permanent", status, reason);
  }
  if (status === 401) return new GoogleCalendarError("auth", status, reason);
  if (status === 403) {
    if (reason && RATE_REASONS.has(reason)) return new GoogleCalendarError("rateLimit", status, reason, after);
    return reason && AUTH_REASONS.has(reason) ? new GoogleCalendarError("auth", status, reason) : new GoogleCalendarError("permanent", status, reason);
  }
  if (status === 404 || status === 410) return new GoogleCalendarError("notFound", status, reason);
  if (status === 409) return new GoogleCalendarError("conflict", status, reason);
  if (status === 429) return new GoogleCalendarError("rateLimit", status, reason, after);
  if (status === 408 || status >= 500) return new GoogleCalendarError("transient", status, reason, after);
  return new GoogleCalendarError("permanent", status, reason);
}

export type GoogleTokenResult = { accessToken: string; refreshToken: string | null; expiresInSeconds: number; scope: string; idToken: string | null };
export type SendUpdates = "all" | "none" | "externalOnly";
export type GoogleEvent = {
  id: string;
  iCalUID?: string;
  status?: string;
  htmlLink?: string;
  organizer?: { email?: string; self?: boolean };
  attendees?: Array<{ email?: string; responseStatus?: string; self?: boolean }>;
  extendedProperties?: { private?: Record<string, string> };
};

export type GoogleCalendarClientOptions = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Só para servidor Google falso (testes/e2e): sobrescreve os endpoints. Nunca definir em produção. */
  endpoints?: { api?: string; token?: string; revoke?: string };
};

export function createGoogleCalendarClient(options: GoogleCalendarClientOptions) {
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tokenEndpoint = options.endpoints?.token ?? GOOGLE_TOKEN_ENDPOINT;
  const revokeEndpoint = options.endpoints?.revoke ?? GOOGLE_REVOKE_ENDPOINT;
  const apiBase = options.endpoints?.api ?? GOOGLE_CALENDAR_API;

  async function send(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await doFetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      const aborted = controller.signal.aborted || (error as { name?: string } | null)?.name === "AbortError";
      throw new GoogleCalendarError("transient", null, aborted ? "timeout" : "network");
    } finally {
      clearTimeout(timer);
    }
  }

  async function readJson(response: Response): Promise<unknown> {
    try {
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  async function tokenRequest(params: Record<string, string>): Promise<GoogleTokenResult> {
    const response = await send(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: options.clientId, client_secret: options.clientSecret, ...params }).toString(),
    });
    const body = (await readJson(response)) as Record<string, unknown> | null;
    if (!response.ok) throw classifyGoogleResponse(response.status, body, { tokenEndpoint: true, retryAfterSeconds: retryAfter(response) });
    if (!body || typeof body.access_token !== "string" || !body.access_token) throw new GoogleCalendarError("permanent", response.status, "invalid_token_response");
    return {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : null,
      expiresInSeconds: typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 3600,
      scope: typeof body.scope === "string" ? body.scope : "",
      idToken: typeof body.id_token === "string" ? body.id_token : null,
    };
  }

  async function api(method: string, accessToken: string, path: string, query: Record<string, string | number | undefined> = {}, body?: unknown): Promise<{ status: number; data: unknown }> {
    const url = new URL(`${apiBase}${path}`);
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    const response = await send(url.toString(), {
      method,
      headers: { authorization: `Bearer ${accessToken}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await readJson(response);
    if (!response.ok) throw classifyGoogleResponse(response.status, data, { retryAfterSeconds: retryAfter(response) });
    return { status: response.status, data };
  }

  const calendarPath = (calendarId: string) => `/calendars/${encodeURIComponent(calendarId)}/events`;
  const eventPath = (calendarId: string, eventId: string) => `${calendarPath(calendarId)}/${encodeURIComponent(eventId)}`;

  return {
    exchangeCode: (input: { code: string; codeVerifier: string }) =>
      tokenRequest({ grant_type: "authorization_code", code: input.code, code_verifier: input.codeVerifier, redirect_uri: options.redirectUri }),

    refreshAccessToken: (refreshToken: string) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }),

    /** Best-effort: 400 invalid_token (já revogado) conta como sucesso; demais erros são lançados. */
    async revokeToken(token: string): Promise<void> {
      const response = await send(revokeEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
      });
      if (response.ok) return;
      const body = await readJson(response);
      const error = classifyGoogleResponse(response.status, body, { retryAfterSeconds: retryAfter(response) });
      if (response.status === 400 && error.reason === "invalid_token") return;
      throw error;
    },

    /** `event.id` deve ser o id determinístico. 409 = já existe (conflict). */
    async insertEvent(accessToken: string, calendarId: string, eventId: string, payload: GoogleEventPayload, sendUpdates: SendUpdates = "none"): Promise<GoogleEvent> {
      const { data } = await api("POST", accessToken, calendarPath(calendarId), { sendUpdates }, { ...payload, id: eventId });
      return data as GoogleEvent;
    },

    async patchEvent(accessToken: string, calendarId: string, eventId: string, payload: Partial<GoogleEventPayload>, sendUpdates: SendUpdates = "none"): Promise<GoogleEvent> {
      const { data } = await api("PATCH", accessToken, eventPath(calendarId, eventId), { sendUpdates }, payload);
      return data as GoogleEvent;
    },

    /** 404/410 = já não existe: devolve "gone" (idempotente). */
    async deleteEvent(accessToken: string, calendarId: string, eventId: string, sendUpdates: SendUpdates = "none"): Promise<"deleted" | "gone"> {
      try {
        await api("DELETE", accessToken, eventPath(calendarId, eventId), { sendUpdates });
        return "deleted";
      } catch (error) {
        if (isGoogleCalendarError(error) && error.kind === "notFound") return "gone";
        throw error;
      }
    },

    /** null se não existir (404/410). */
    async getEvent(accessToken: string, calendarId: string, eventId: string): Promise<GoogleEvent | null> {
      try {
        const { data } = await api("GET", accessToken, eventPath(calendarId, eventId));
        return data as GoogleEvent;
      } catch (error) {
        if (isGoogleCalendarError(error) && error.kind === "notFound") return null;
        throw error;
      }
    },

    /** Busca na agenda pelo iCalUID (verificação de convite recebido). */
    async listEvents(accessToken: string, calendarId: string, query: { iCalUID?: string; maxResults?: number; timeMin?: string; timeMax?: string; pageToken?: string } = {}): Promise<{ items: GoogleEvent[]; nextPageToken: string | null }> {
      const { data } = await api("GET", accessToken, calendarPath(calendarId), { ...query, maxResults: query.maxResults ?? 10, singleEvents: "true", showDeleted: "false" });
      const body = (data ?? {}) as { items?: GoogleEvent[]; nextPageToken?: string };
      return { items: Array.isArray(body.items) ? body.items : [], nextPageToken: body.nextPageToken ?? null };
    },
  };
}

export type GoogleCalendarClient = ReturnType<typeof createGoogleCalendarClient>;
