"use client";

import { useCallback, useEffect, useState } from "react";
import { CLIENT_CACHE_INVALIDATED_EVENT, getCachedJson, readClientCache } from "@/lib/client-cache";
import type { AnamnesisAlert, AnamnesisContent, AnamnesisState } from "@/lib/anamnesis-rules";
import type { EncounterItem, JourneyRow, NextReturn } from "@/lib/clinical-record-rules";

export type AuditView = { at: string; by: string; action: string; note?: string };

export type AnamnesisVersionMeta = {
  id: string; version: number; status: "RASCUNHO" | "CONCLUIDA" | "PENDENTE_REVISAO"; origin: string; basedOnVersion: number | null;
  createdBy: string; updatedBy: string; completedBy: string | null; completedAt: string | null;
  reviewRequestedBy: string | null; reviewRequestedAt: string | null; reviewReason: string; reviewConfirmedBy: string | null; reviewConfirmedAt: string | null;
  createdAt: string; updatedAt: string;
};
export type AnamnesisVersionFull = AnamnesisVersionMeta & { content: AnamnesisContent; alerts: AnamnesisAlert[]; audit: AuditView[] };

export type AnamnesisOverview =
  | { restricted: true; exists: boolean }
  | {
    restricted: false; exists: boolean; state: AnamnesisState; reason: "manual" | "policy" | null; versions: AnamnesisVersionMeta[];
    current: AnamnesisVersionFull | null; draft: AnamnesisVersionFull | null; alerts: AnamnesisAlert[];
    evaluationFallback: { evaluationId: string; createdAt: string; professional: string; alerts: AnamnesisAlert[] } | null;
  };

export type EncountersResponse = {
  items: EncounterItem[];
  journeys: JourneyRow[];
  nextReturn: (Omit<NextReturn, "date"> & { date: string }) | null;
  truncated: boolean;
};

export const anamnesisKey = (patientId: string) => `/api/patients/${encodeURIComponent(patientId)}/anamnesis`;
export const anamnesisVersionKey = (patientId: string, versionId: string) => `${anamnesisKey(patientId)}/${encodeURIComponent(versionId)}`;
export const encountersKey = (patientId: string) => `/api/patients/${encodeURIComponent(patientId)}/encounters`;

// Leitura em cache com revalidação; refaz a consulta quando uma mutação invalida a chave.
// O estado é guardado junto da chave para nunca exibir dados de outro recurso ao trocar de chave.
type Entry<T> = { key: string; data?: T; error?: boolean };

export function useCachedResource<T>(key: string) {
  const [entry, setEntry] = useState<Entry<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const current = entry?.key === key ? entry : null;
  const data = current?.data ?? (key ? readClientCache<T>(key) : undefined);
  const error = Boolean(current?.error);
  const loading = Boolean(key) && data === undefined && !error;

  useEffect(() => {
    if (!key) return;
    let active = true;
    getCachedJson<T>(key)
      .then((value) => { if (active) setEntry({ key, data: value }); })
      .catch((reason) => { if (active && !(reason instanceof DOMException && reason.name === "AbortError")) setEntry((previous) => ({ key, data: previous?.key === key ? previous.data : undefined, error: true })); });
    return () => { active = false; };
  }, [key, attempt]);

  useEffect(() => {
    if (!key) return;
    let active = true;
    const refresh = (event: Event) => {
      const keys = (event as CustomEvent<string[]>).detail ?? [];
      if (!keys.some((item) => key === item || key.startsWith(`${item}?`))) return; // mesma regra de invalidateClientCache: a chave pode ter query string
      getCachedJson<T>(key).then((value) => { if (active) setEntry({ key, data: value }); }).catch((reason) => { if (active && !(reason instanceof DOMException && reason.name === "AbortError")) setEntry((previous) => ({ key, data: previous?.key === key ? previous.data : undefined, error: true })); });
    };
    window.addEventListener(CLIENT_CACHE_INVALIDATED_EVENT, refresh);
    return () => { active = false; window.removeEventListener(CLIENT_CACHE_INVALIDATED_EVENT, refresh); };
  }, [key]);

  const retry = useCallback(() => { setEntry(null); setAttempt((value) => value + 1); }, []);
  return { data, loading, error, retry };
}

export function formatDate(value?: string | null) {
  if (!value) return "Não informado";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Não informado" : new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Sao_Paulo" }).format(date).replace(/\./g, "");
}

export function formatTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(date);
}

export function formatWeekday(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "America/Sao_Paulo" }).format(date);
}
