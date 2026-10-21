"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSavePump } from "@/lib/save-pump";

type SaveState = "saved" | "pending" | "saving" | "error";
let activeDraftGuard: (() => Promise<boolean>) | null = null;

export async function guardDraftNavigation() {
  return activeDraftGuard ? activeDraftGuard() : true;
}

export function useDraftAutosave({ scope, revision, enabled, save, canSave = true, delay = 900 }: {
  scope: string;
  revision: string | number;
  enabled: boolean;
  save: () => Promise<boolean>;
  canSave?: boolean;
  delay?: number;
}) {
  const [state, setState] = useState<SaveState>("saved");
  const latestRevision = useRef(revision);
  const latestSave = useRef(save);
  const latestCanSave = useRef(canSave);
  const latestEnabled = useRef(enabled);
  const activeScope = useRef(scope);
  const initialized = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Gravações serializadas: dois flush/timer simultâneos nunca enviam a mesma revisão esperada ao servidor.
  // Os getters só leem os refs quando a gravação roda (nunca durante a renderização).
  // eslint-disable-next-line react-hooks/refs
  const [pump] = useState(() => createSavePump<string | number>({
    latest: () => latestRevision.current,
    scope: () => activeScope.current,
    save: async () => { setState("saving"); return latestSave.current(); },
  }));

  useEffect(() => {
    latestRevision.current = revision;
    latestSave.current = save;
    latestCanSave.current = canSave;
    latestEnabled.current = enabled;
  });

  function clearTimer() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  const flush = useCallback(async function flush(): Promise<boolean> {
    clearTimer();
    if (!latestEnabled.current || !initialized.current) return true;
    if (!pump.isDirty() && !pump.busy) return true;
    if (!latestCanSave.current && pump.isDirty()) { setState("error"); return false; }
    const ok = await pump.flush();
    setState(ok ? (pump.isDirty() ? "pending" : "saved") : "error");
    return ok;
  }, [pump]);

  useEffect(() => {
    if (!enabled) return;
    if (!initialized.current || activeScope.current !== scope) {
      clearTimer();
      activeScope.current = scope;
      pump.markSaved(revision);
      initialized.current = true;
      setState("saved");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mesmo comportamento anterior: sincroniza o estado com o rascunho
    if (!pump.isDirty()) { setState("saved"); return; }
    setState("pending");
    clearTimer();
    if (canSave) timer.current = setTimeout(() => { void flush(); }, delay);
    return clearTimer;
  }, [scope, revision, enabled, canSave, delay, flush, pump]);

  useEffect(() => {
    if (!enabled) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!pump.isDirty() && !pump.busy) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [enabled, pump]);

  useEffect(() => {
    if (!enabled) return;
    const guard = async () => await flush() || window.confirm("As alterações não foram salvas. Deseja sair e perdê-las?");
    activeDraftGuard = guard;
    return () => { if (activeDraftGuard === guard) activeDraftGuard = null; };
  }, [enabled, flush]);

  async function leave(action: () => void) {
    if (await flush() || window.confirm("As alterações não foram salvas. Deseja sair e perdê-las?")) action();
  }

  return { state, flush, leave };
}
