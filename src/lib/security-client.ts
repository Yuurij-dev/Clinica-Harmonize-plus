// Cliente das rotas /api/security/*: tipos das respostas e uma chamada comum para as mutações.
import { CLIENT_CACHE_UNAUTHORIZED_EVENT } from "./client-cache";

export const SECURITY_OVERVIEW_KEY = "/api/security/overview";
export const SECURITY_EVENTS_PAGE_SIZE = 20;

export type SecurityOverview = {
  mfa: { enabled: boolean; enabledAt: string | null; setupPending: boolean; required: boolean; recoveryCodesRemaining: number };
  trustedDevices: Array<{ id: string; label: string; createdAt: string; lastUsedAt: string; expiresAt: string; current: boolean }>;
  sessions: Array<{ id: string; label: string; browser: string; os: string; ipMasked: string; createdAt: string; lastSeenAt: string; expiresAt: string; current: boolean; trusted: boolean }>;
};

export type SecurityEventRow = { id: string; type: string; success: boolean; createdAt: string; ipMasked: string; device: string | null; detail: string | null };
export type SecurityEventsPage = { events: SecurityEventRow[]; nextCursor: string | null };

export function securityEventsKey(cursor?: string | null) {
  return `/api/security/events?limit=${SECURITY_EVENTS_PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
}

export type SecurityResult<T> = { ok: boolean; status: number; code?: string; message: string; data: T | null };

/** Mutação em /api/security/*. Nunca lança: erro de rede vira `ok: false`. 401 avisa o app (volta ao login). */
export async function securityRequest<T = Record<string, unknown>>(method: "POST" | "DELETE", url: string, body?: Record<string, unknown>): Promise<SecurityResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      cache: "no-store",
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
  } catch {
    return { ok: false, status: 0, message: "Não foi possível conectar. Verifique sua conexão e tente novamente.", data: null };
  }
  const data = await response.json().catch(() => null) as (T & { message?: string; code?: string }) | null;
  if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event(CLIENT_CACHE_UNAUTHORIZED_EVENT));
  return {
    ok: response.ok,
    status: response.status,
    code: data?.code,
    message: response.ok ? "" : (typeof data?.message === "string" && data.message) || "Não foi possível concluir a ação. Tente novamente.",
    data,
  };
}
