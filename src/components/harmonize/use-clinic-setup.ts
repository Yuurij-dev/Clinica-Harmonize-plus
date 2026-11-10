"use client";

import { useCallback, useEffect, useState } from "react";
import { CLIENT_CACHE_INVALIDATED_EVENT, getCachedJson, readClientCache } from "@/lib/client-cache";
import { setupUpdatedEvent } from "@/lib/section-events";
import type { SetupEvaluation, SetupStatus, SetupStepKey } from "@/lib/setup-rules";

export type SetupSummary = {
  clinicName: string;
  clinicFields: { name: boolean; phone: boolean; address: boolean };
  professionals: number;
  procedures: number;
  materials: number;
  products: number;
  recurringExpenses: number;
  hours: { opening: string; closing: string; professionalOpening: string; professionalClosing: string };
  alerts: { appointments: boolean; sound: boolean; stock: boolean; expiryWarningDays: number };
};

export type SetupPayload = SetupEvaluation & { status: SetupStatus; currentStep: SetupStepKey; summary: SetupSummary };

export type SetupAction = { action: "start" | "dismiss" | "finish" } | { action: "goto" | "undo"; step: SetupStepKey } | { action: "decide"; step: SetupStepKey; decision: "confirmed" | "skipped" };

const KEY = "/api/setup";

// Chaves de cache cujas mudanças alteram o que o assistente conta (procedimentos, estoque, clínica, equipe, custos fixos).
const AFFECTING_PREFIXES = ["/api/procedures", "/api/products", "/api/stock", "/api/clinic/", "/api/team", "/api/invitations", "/api/recurring-expenses"];

function affectsSetup(event: Event) {
  const keys = (event as CustomEvent<string[] | undefined>).detail;
  return Array.isArray(keys) && keys.some((key) => AFFECTING_PREFIXES.some((prefix) => key === prefix || key.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`) || key.startsWith(`${prefix}?`)));
}

/**
 * Estado do assistente de configuração, sempre vindo do servidor (nada em localStorage). Sem `enabled` (não é admin) não
 * consulta nada. Com `live`, revalida ao voltar o foco para a janela e quando o cache for invalidado por outra tela
 * (cadastro de procedimento, produto etc.): sem polling.
 */
export function useClinicSetup(enabled: boolean, live: boolean) {
  const [data, setData] = useState<SetupPayload | null>(() => enabled ? readClientCache<SetupPayload>(KEY) ?? null : null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async (): Promise<SetupPayload | null> => {
    try {
      const next = await getCachedJson<SetupPayload>(KEY);
      setData(next);
      setFailed(false);
      return next;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setFailed(true);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    getCachedJson<SetupPayload>(KEY).then((next) => { if (active) setData(next); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !live || data?.status === "completed") return;
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const onInvalidated = (event: Event) => { if (affectsSetup(event)) void refresh(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(CLIENT_CACHE_INVALIDATED_EVENT, onInvalidated);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(CLIENT_CACHE_INVALIDATED_EVENT, onInvalidated);
    };
  }, [enabled, live, data?.status, refresh]);

  // Gravação feita por outro componente (assistente x card do Dashboard): recebe o estado novo sem consultar de novo.
  useEffect(() => {
    if (!enabled) return;
    const onUpdated = (event: Event) => setData((event as CustomEvent<SetupPayload>).detail);
    window.addEventListener(setupUpdatedEvent, onUpdated);
    return () => window.removeEventListener(setupUpdatedEvent, onUpdated);
  }, [enabled]);

  /** Grava no servidor e devolve o novo estado; lança com a mensagem do servidor se falhar (cache só invalida após sucesso). */
  const send = useCallback(async (body: SetupAction) => {
    const response = await fetch(KEY, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await response.json().catch(() => ({})) as Partial<SetupPayload> & { message?: string };
    if (!response.ok) throw new Error(json.message ?? "Não foi possível salvar a configuração.");
    setData(json as SetupPayload);
    window.dispatchEvent(new CustomEvent<SetupPayload>(setupUpdatedEvent, { detail: json as SetupPayload }));
    return json as SetupPayload;
  }, []);

  return { data, failed, refresh, send };
}
