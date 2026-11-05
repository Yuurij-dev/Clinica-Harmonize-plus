"use client";

import { useEffect, useRef, useState } from "react";
import { nextPollDelay, remainingVisibleMs, type PollOutcome } from "@/lib/evaluation-photo-sync-rules";

// Polling leve de fotos enviadas pelo app: uma checagem por vez, só com a aba visível, com backoff (5 s, 10, 20, 60) em falha e parada definitiva
// quando `check` devolve "stop" (401/403/404). Também roda ao voltar à aba/foco. Timers e listeners são limpos ao desmontar ou desligar.
export function usePhotoSyncPoll(enabled: boolean, check: () => Promise<PollOutcome>) {
  const checkRef = useRef(check);
  useEffect(() => { checkRef.current = check; });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let running = false;
    let stopped = false;
    let failures = 0;
    let timer: number | undefined;
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { void run(); }, nextPollDelay(failures)); };
    async function run() {
      if (!active || running || stopped) return;
      if (document.visibilityState !== "visible") { schedule(); return; }
      running = true;
      let outcome: PollOutcome;
      try { outcome = await checkRef.current(); } catch { outcome = "retry"; }
      running = false;
      if (!active) return;
      if (outcome === "stop") { stopped = true; return; }
      failures = outcome === "retry" ? failures + 1 : 0;
      schedule();
    }
    const trigger = () => { if (!running && !stopped) { window.clearTimeout(timer); void run(); } };
    schedule();
    document.addEventListener("visibilitychange", trigger);
    window.addEventListener("focus", trigger);
    return () => { active = false; window.clearTimeout(timer); document.removeEventListener("visibilitychange", trigger); window.removeEventListener("focus", trigger); };
  }, [enabled]);
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
