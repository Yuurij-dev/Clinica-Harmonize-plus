"use client";

import { useEffect, useReducer } from "react";
import { CLIENT_CACHE_INVALIDATED_EVENT, getCachedJson, readClientCache } from "@/lib/client-cache";
import { indexProcedureImagesByName, procedureNameKey } from "@/lib/procedure-image-rules";

// Telas que só têm o TEXTO do procedimento (agenda, jornadas) acham a imagem pelo nome exato entre os procedimentos
// da PRÓPRIA clínica, já carregados por outras telas (cache cliente). Sem correspondência: placeholder.
const sources = ["/api/agenda/bootstrap", "/api/quotes/options", "/api/procedures"] as const;
type SourceData = { procedures?: Array<{ name: string; image?: { url: string | null } | null }> };
const indexes = new WeakMap<object, Map<string, string>>();

function lookup(name: string) {
  const key = procedureNameKey(name);
  if (!key) return null;
  for (const source of sources) {
    const data = readClientCache<SourceData>(source);
    if (!data?.procedures) continue;
    let index = indexes.get(data);
    if (!index) { index = indexProcedureImagesByName(data.procedures); indexes.set(data, index); }
    const url = index.get(key);
    if (url) return url;
  }
  return null;
}

const hasAnySource = () => sources.some((source) => readClientCache<SourceData>(source)?.procedures);

export function useProcedureImageByName(name: string, enabled: boolean) {
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const sync = () => {
      if (hasAnySource()) { refresh(); return; }
      // /api/quotes/options não tem restrição de papel e já é a fonte de procedimentos do orçamento; é compartilhada pelo cache.
      getCachedJson<SourceData>("/api/quotes/options").then(() => { if (active) refresh(); }).catch(() => undefined);
    };
    sync();
    window.addEventListener(CLIENT_CACHE_INVALIDATED_EVENT, sync);
    return () => { active = false; window.removeEventListener(CLIENT_CACHE_INVALIDATED_EVENT, sync); };
  }, [enabled]);
  return enabled ? lookup(name) : null;
}
