// Regras puras da coordenação entre abas (líder por Web Locks + BroadcastChannel). Sem acesso a window/navigator.

export const PRESENCE_TTL_MS = 45_000;
export const HEARTBEAT_MS = 30_000;
export const MIN_CYCLE_GAP_MS = 10_000;

export type ActiveSessionMessage = { id: string; patientId: string; journeyId: string; procedureName: string; patientName: string; journeyName: string };
export type AutomaticUpdateMessage = { id: string; patientId: string; date: string; status: string };

export type TabMessage =
  | { kind: "presence"; visible: boolean; sessionsEligible: boolean }
  | { kind: "hello" }
  | { kind: "bye" }
  | { kind: "refresh"; force?: boolean }
  | { kind: "cycle"; alerts: Record<string, unknown> | null; updated: AutomaticUpdateMessage[] }
  | { kind: "sessions"; sessions: ActiveSessionMessage[] };

export type TabEnvelope = { scope: string; from: string; message: TabMessage };
export type PeerPresence = { visible: boolean; sessionsEligible: boolean; at: number };

// Escopo da aba = escopo completo do client-cache ("userId:clinicId:permissões"): abas com permissões
// diferentes não dividem lock nem canal. Sem usuário/clínica no escopo, não há coordenação (null).
export function tabScopeFromCacheScope(cacheScope: string | null) {
  if (!cacheScope) return null;
  const [userId, clinicId] = cacheScope.split(":");
  return userId && clinicId ? cacheScope : null;
}

// O coordenador só continua válido enquanto o escopo do cache é exatamente o dele.
export function scopeStillValid(tabScope: string, cacheScope: string | null) {
  return tabScopeFromCacheScope(cacheScope) === tabScope;
}

// O "viewer" devolvido pela API (ids da sessão do cookie) precisa ser o usuário/clínica desta aba.
export function viewerMatchesScope(viewer: unknown, cacheScope: string | null) {
  if (!isRecord(viewer) || !isText(viewer.userId) || !isText(viewer.clinicId) || !cacheScope) return false;
  const prefix = `${viewer.userId}:${viewer.clinicId}`;
  return cacheScope === prefix || cacheScope.startsWith(`${prefix}:`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isText = (value: unknown): value is string => typeof value === "string";

// Valida o envelope: escopo igual ao da aba, remetente diferente de si mesma e mensagem bem formada.
export function parseEnvelope(raw: unknown, scope: string, selfId: string): TabEnvelope | null {
  if (!isRecord(raw) || raw.scope !== scope || !isText(raw.from) || raw.from === selfId || !isRecord(raw.message)) return null;
  const message = raw.message;
  switch (message.kind) {
    case "presence":
      return typeof message.visible === "boolean" && typeof message.sessionsEligible === "boolean"
        ? { scope, from: raw.from, message: { kind: "presence", visible: message.visible, sessionsEligible: message.sessionsEligible } } : null;
    case "hello": return { scope, from: raw.from, message: { kind: "hello" } };
    case "bye": return { scope, from: raw.from, message: { kind: "bye" } };
    case "refresh": return { scope, from: raw.from, message: { kind: "refresh", force: message.force === true } };
    case "cycle": {
      if (message.alerts !== null && !isRecord(message.alerts)) return null;
      if (isRecord(message.alerts) && message.alerts.appointments !== undefined && !Array.isArray(message.alerts.appointments)) return null;
      if (!Array.isArray(message.updated)) return null;
      const updated = message.updated.filter((item): item is AutomaticUpdateMessage => isRecord(item) && isText(item.id) && isText(item.patientId) && isText(item.date) && isText(item.status));
      if (updated.length !== message.updated.length) return null;
      return { scope, from: raw.from, message: { kind: "cycle", alerts: message.alerts as Record<string, unknown> | null, updated } };
    }
    case "sessions": {
      if (!Array.isArray(message.sessions)) return null;
      const sessions = message.sessions.filter((item): item is ActiveSessionMessage => isRecord(item) && isText(item.id) && isText(item.patientId) && isText(item.journeyId) && isText(item.procedureName) && isText(item.patientName) && isText(item.journeyName));
      if (sessions.length !== message.sessions.length) return null;
      return { scope, from: raw.from, message: { kind: "sessions", sessions } };
    }
    default: return null;
  }
}

export function freshPeers(peers: Iterable<PeerPresence>, now: number) {
  return [...peers].filter((peer) => now - peer.at <= PRESENCE_TTL_MS);
}

export function prunePeers(peers: Map<string, PeerPresence>, now: number) {
  for (const [id, peer] of peers) if (now - peer.at > PRESENCE_TTL_MS) peers.delete(id);
}

// A líder roda o ciclo de alertas quando ela mesma ou alguma seguidora (heartbeat não expirado) está visível.
export function shouldRunCycle(own: { visible: boolean }, peers: Iterable<PeerPresence>, now: number) {
  return own.visible || freshPeers(peers, now).some((peer) => peer.visible);
}

// active-procedures só vale se alguma aba visível for desktop com permissão clínica.
export function shouldRunSessions(own: { visible: boolean; sessionsEligible: boolean }, peers: Iterable<PeerPresence>, now: number) {
  return (own.visible && own.sessionsEligible) || freshPeers(peers, now).some((peer) => peer.visible && peer.sessionsEligible);
}

// Evita ciclos em rajada (remontagem, retorno de visibilidade, pedidos de seguidoras); "force" ignora o intervalo.
export function cycleThrottleAllows(lastAt: number, now: number, force = false) {
  return force || lastAt === 0 || now - lastAt >= MIN_CYCLE_GAP_MS;
}
