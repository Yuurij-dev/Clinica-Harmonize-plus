"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSavePump } from "@/lib/save-pump";
import { autosaveWaitMs } from "@/lib/autosave-schedule-rules";

type SaveState = "saved" | "pending" | "saving" | "error";
let activeDraftGuard: (() => Promise<boolean>) | null = null;

export async function guardDraftNavigation() {
  return activeDraftGuard ? activeDraftGuard() : true;
}

export function useDraftAutosave({ scope, revision, enabled, save, canSave = true, delay = 900, maxWait }: {
  scope: string;
  revision: string | number;
  enabled: boolean;
  save: () => Promise<boolean>;
  canSave?: boolean;
  delay?: number;
  /** Teto opcional: grava no máximo `maxWait` ms depois da primeira alteração não salva, mesmo com edição contínua. Sem ele é só o debounce de `delay`. */
  maxWait?: number;
}) {
  const [state, setState] = useState<SaveState>("saved");
  const latestRevision = useRef(revision);
  const latestSave = useRef(save);
  const latestCanSave = useRef(canSave);
  const latestEnabled = useRef(enabled);
  const activeScope = useRef(scope);
  const initialized = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstDirtyAt = useRef<number | null>(null); // primeira alteração ainda não salva (só usada com maxWait)

  // Gravações serializadas: dois flush/timer simultâneos nunca enviam a mesma revisão esperada ao servidor.
  // Os getters só leem os refs quando a gravação roda (nunca durante a renderização).
  // eslint-disable-next-line react-hooks/refs
  const [pump] = useState(() => createSavePump<string | number>({
    latest: () => latestRevision.current,
    scope: () => activeScope.current,
    // Ao começar a gravar o teto zera: a próxima edição suja (inclusive uma feita com a gravação em voo) abre um teto novo.
    save: async () => { setState("saving"); firstDirtyAt.current = null; return latestSave.current(); },
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
    // Sobrou algo sujo (edição durante a gravação ou falha): mantém o teto aberto pela edição, ou abre um agora (espaça as tentativas).
    if (!pump.isDirty()) firstDirtyAt.current = null;
    else if (firstDirtyAt.current === null) firstDirtyAt.current = Date.now();
    setState(ok ? (pump.isDirty() ? "pending" : "saved") : "error");
    return ok;
  }, [pump]);

  useEffect(() => {
    if (!enabled) { firstDirtyAt.current = null; return; }
    if (!initialized.current || activeScope.current !== scope) {
      clearTimer();
      activeScope.current = scope;
      pump.markSaved(revision);
      firstDirtyAt.current = null;
      initialized.current = true;
      setState("saved");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mesmo comportamento anterior: sincroniza o estado com o rascunho
    if (!pump.isDirty()) { firstDirtyAt.current = null; setState("saved"); return; }
    setState("pending");
    clearTimer();
    if (!canSave) firstDirtyAt.current = null; // sem poder gravar não há teto correndo; ao voltar a poder, conta de agora
    else if (firstDirtyAt.current === null) firstDirtyAt.current = Date.now();
    if (canSave) timer.current = setTimeout(() => { void flush(); }, autosaveWaitMs({ now: Date.now(), firstDirtyAt: firstDirtyAt.current, delay, maxWait }));
    return clearTimer;
  }, [scope, revision, enabled, canSave, delay, maxWait, flush, pump]);

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
