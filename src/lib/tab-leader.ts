import { CLIENT_CACHE_SCOPE_CHANGED_EVENT, CLIENT_CACHE_UNAUTHORIZED_EVENT, getClientCacheScope } from "./client-cache.ts";
import {
  HEARTBEAT_MS, parseEnvelope, prunePeers, scopeStillValid, shouldRunCycle, shouldRunSessions, tabScopeFromCacheScope,
  type PeerPresence, type TabMessage,
} from "./tab-leader-rules.ts";

// Uma aba líder por usuário+clínica (Web Locks) faz o polling e transmite os resultados às demais
// (BroadcastChannel, só em memória: nada vai para localStorage/sessionStorage). Sem Locks ou
// BroadcastChannel, ou sem escopo, a aba é líder de si mesma (comportamento sem coordenação).

export type TabCoordinator = {
  scope: string | null;
  isLeader(): boolean;
  post(message: TabMessage): void;
  subscribe(listener: (message: TabMessage) => void): () => void;
  onLeaderChange(listener: (leader: boolean) => void): () => void;
  setSessionsEligible(value: boolean): void;
  shouldRunCycle(): boolean;
  shouldRunSessions(): boolean;
  release(): void;
};

type Shared = { scope: string | null; coordinator: TabCoordinator; destroy: () => void; refs: number; closeTimer?: ReturnType<typeof setTimeout> };
let shared: Shared | null = null;

const isVisible = () => typeof document === "undefined" || document.visibilityState === "visible";

function createShared(scope: string | null): Shared {
  const selfId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const peers = new Map<string, PeerPresence>();
  const messageListeners = new Set<(message: TabMessage) => void>();
  const leaderListeners = new Set<(leader: boolean) => void>();
  let sessionsEligible = false;
  let closed = false;
  let leader = false;
  let channel: BroadcastChannel | null = null;
  let releaseLock: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const abort = new AbortController();
  const cleanups: Array<() => void> = [];

  function setLeader(next: boolean) {
    if (leader === next) return;
    leader = next;
    for (const listener of [...leaderListeners]) listener(next);
  }

  const post = (message: TabMessage) => {
    if (closed || !channel || !scope) return;
    try { channel.postMessage({ scope, from: selfId, message }); } catch { /* canal fechado ou dado não clonável */ }
  };
  const postPresence = () => post({ kind: "presence", visible: isVisible(), sessionsEligible });

  const supported = Boolean(scope) && typeof window !== "undefined" && typeof BroadcastChannel !== "undefined" && typeof navigator !== "undefined" && "locks" in navigator;
  if (!supported || !scope) {
    leader = true;
  } else {
    try {
      channel = new BroadcastChannel(`harmonize-tabs:${scope}`);
      channel.onmessage = (event) => {
        const envelope = parseEnvelope(event.data, scope, selfId);
        if (!envelope || closed) return;
        const { message } = envelope;
        if (message.kind === "presence") peers.set(envelope.from, { visible: message.visible, sessionsEligible: message.sessionsEligible, at: Date.now() });
        else if (message.kind === "bye") peers.delete(envelope.from);
        else if (message.kind === "hello") postPresence();
        else for (const listener of [...messageListeners]) listener(message);
      };
      navigator.locks.request(`harmonize-leader:${scope}`, { signal: abort.signal }, () => new Promise<void>((resolve) => {
        if (closed) { resolve(); return; }
        releaseLock = resolve;
        setLeader(true);
      })).catch(() => undefined);
      post({ kind: "hello" });
      postPresence();
      heartbeat = setInterval(() => { prunePeers(peers, Date.now()); if (isVisible()) postPresence(); }, HEARTBEAT_MS);
      const onVisibility = () => { postPresence(); if (isVisible()) post({ kind: "refresh" }); };
      document.addEventListener("visibilitychange", onVisibility);
      cleanups.push(() => document.removeEventListener("visibilitychange", onVisibility));
    } catch {
      // Sem suporte efetivo (ex.: contexto inseguro): cada aba é líder de si mesma.
      channel?.close();
      channel = null;
      leader = true;
    }
  }

  const coordinator: TabCoordinator = {
    scope,
    isLeader: () => leader && !closed,
    post,
    subscribe(listener) { messageListeners.add(listener); return () => { messageListeners.delete(listener); }; },
    onLeaderChange(listener) { leaderListeners.add(listener); return () => { leaderListeners.delete(listener); }; },
    setSessionsEligible(value) { if (sessionsEligible === value) return; sessionsEligible = value; postPresence(); },
    shouldRunCycle: () => shouldRunCycle({ visible: isVisible() }, peers.values(), Date.now()),
    shouldRunSessions: () => shouldRunSessions({ visible: isVisible(), sessionsEligible }, peers.values(), Date.now()),
    release() { /* substituído em cada handle */ },
  };

  function destroy() {
    if (closed) return;
    post({ kind: "bye" });
    closed = true;
    abort.abort();
    releaseLock?.();
    releaseLock = null;
    if (heartbeat) clearInterval(heartbeat);
    cleanups.forEach((cleanup) => cleanup());
    channel?.close();
    channel = null;
    messageListeners.clear();
    leaderListeners.clear();
    peers.clear();
    leader = false;
    if (shared?.coordinator === coordinator) shared = null;
  }

  // Troca de usuário/clínica ou logout/401: solta o lock e fecha o canal.
  if (scope && typeof window !== "undefined") {
    const onScopeChanged = () => { if (!scopeStillValid(scope, getClientCacheScope())) destroy(); };
    window.addEventListener(CLIENT_CACHE_SCOPE_CHANGED_EVENT, onScopeChanged);
    window.addEventListener(CLIENT_CACHE_UNAUTHORIZED_EVENT, destroy);
    cleanups.push(() => { window.removeEventListener(CLIENT_CACHE_SCOPE_CHANGED_EVENT, onScopeChanged); window.removeEventListener(CLIENT_CACHE_UNAUTHORIZED_EVENT, destroy); });
  }

  return { scope, coordinator, destroy, refs: 0 };
}

// Uma instância por aba, compartilhada entre Topbar e Sidebar; o escopo vem do client-cache (usuário:clínica).
export function acquireTabCoordinator(): TabCoordinator {
  const scope = tabScopeFromCacheScope(getClientCacheScope());
  if (shared && shared.scope !== scope) shared.destroy();
  if (!shared) shared = createShared(scope);
  const current = shared;
  if (current.closeTimer) { clearTimeout(current.closeTimer); current.closeTimer = undefined; }
  current.refs += 1;
  let released = false;
  return {
    ...current.coordinator,
    release() {
      if (released) return;
      released = true;
      current.refs -= 1;
      // Pequena espera para sobreviver à remontagem imediata (Strict Mode) sem trocar de líder.
      if (current.refs <= 0) current.closeTimer = setTimeout(() => current.destroy(), 100);
    },
  };
}
