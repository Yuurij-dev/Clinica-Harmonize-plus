"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  const savedRevision = useRef<string | number>(revision);
  const latestRevision = useRef(revision);
  const latestSave = useRef(save);
  const latestCanSave = useRef(canSave);
  const activeScope = useRef(scope);
  const initialized = useRef(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  latestRevision.current = revision;
  latestSave.current = save;
  latestCanSave.current = canSave;

  function clearTimer() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  const flush = useCallback(async function flush(): Promise<boolean> {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!enabled || !initialized.current) return true;
    if (inFlight.current) {
      await inFlight.current;
      if (savedRevision.current === latestRevision.current) return true;
    }
    if (savedRevision.current === latestRevision.current) return true;
    if (!latestCanSave.current) { setState("error"); return false; }
    const startedRevision = latestRevision.current;
    const startedScope = activeScope.current;
    setState("saving");
    const request = latestSave.current();
    inFlight.current = request;
    let ok = false;
    try { ok = await request; } catch { ok = false; }
    if (inFlight.current === request) inFlight.current = null;
    if (startedScope !== activeScope.current) return false;
    if (ok) savedRevision.current = startedRevision;
    setState(ok ? savedRevision.current === latestRevision.current ? "saved" : "pending" : "error");
    return ok && savedRevision.current === latestRevision.current ? true : ok ? flush() : false;
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (!initialized.current || activeScope.current !== scope) {
      clearTimer();
      activeScope.current = scope;
      savedRevision.current = revision;
      initialized.current = true;
      setState("saved");
      return;
    }
    if (savedRevision.current === revision) { setState("saved"); return; }
    setState("pending");
    clearTimer();
    if (canSave) timer.current = setTimeout(() => { void flush(); }, delay);
    return clearTimer;
  }, [scope, revision, enabled, canSave, delay, flush]);

  useEffect(() => {
    if (!enabled) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (savedRevision.current === latestRevision.current && !inFlight.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [enabled]);

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
