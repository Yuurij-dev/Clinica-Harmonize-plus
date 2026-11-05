"use client";

import { useEffect, useRef, useState } from "react";
import { advancePollState, pollDelay, remainingVisibleMs, wakePollState, type PollOutcome, type PollState } from "@/lib/evaluation-photo-sync-rules";

// Polling leve de fotos enviadas pelo app: uma checagem por vez, só com a aba visível. Ociosidade espaça 5 s -> 15 -> 30 -> 60 s (até `maxIdleMs`);
// atividade, foco ou volta à aba voltam a 5 s na hora. Falha usa o backoff (5 s, 10, 20, 60) e "stop" (401/403/404) para de vez. Timers e listeners são limpos ao desmontar ou desligar.
export function usePhotoSyncPoll(enabled: boolean, check: () => Promise<PollOutcome>, maxIdleMs = 60_000, resetKey: string | number | null = null) {
  const checkRef = useRef(check);
  useEffect(() => { checkRef.current = check; });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let running = false;
    let stopped = false;
    let state: PollState = { failures: 0, idle: 0 };
    let timer: number | undefined;
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { void run(); }, pollDelay(state, maxIdleMs)); };
    async function run() {
      if (!active || running || stopped) return;
      if (document.visibilityState !== "visible") { schedule(); return; }
      running = true;
      let outcome: PollOutcome;
      try { outcome = await checkRef.current(); } catch { outcome = "retry"; }
      running = false;
      if (!active) return;
      if (outcome === "stop") { stopped = true; return; }
      state = advancePollState(state, outcome);
      schedule();
    }
    const trigger = () => { if (!running && !stopped) { state = wakePollState(state); window.clearTimeout(timer); void run(); } };
    schedule();
    document.addEventListener("visibilitychange", trigger);
    window.addEventListener("focus", trigger);
    return () => { active = false; window.clearTimeout(timer); document.removeEventListener("visibilitychange", trigger); window.removeEventListener("focus", trigger); };
  }, [enabled, maxIdleMs, resetKey]); // resetKey (paciente/sessão/avaliação) reinicia ociosidade e falhas
}

// Mantém o indicador visível por um tempo mínimo (~600 ms) para não piscar.
export function useMinimumVisible(active: boolean, minMs = 600) {
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);
  useEffect(() => {
    if (active) {
      shownAt.current = Date.now();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza o indicador com a atividade externa
      setVisible(true);
      return;
    }
    const timer = window.setTimeout(() => setVisible(false), remainingVisibleMs(shownAt.current, Date.now(), minMs));
    return () => window.clearTimeout(timer);
  }, [active, minMs]);
  return active || visible;
}
