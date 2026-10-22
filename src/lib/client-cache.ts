type CacheEntry = {
  data?: unknown;
  updatedAt?: number;
  promise?: Promise<unknown>;
  controller?: AbortController;
};

type CachePolicy = { freshFor: number; retainFor: number };

const cache = new Map<string, CacheEntry>();
const maxEntries = 80;
const maxPhotoEntries = 6;
let scope: string | null = null;
let generation = 0;

function policyFor(key: string): CachePolicy {
  if (key.startsWith("/api/agenda")) return { freshFor: 20_000, retainFor: 90_000 };
  if (key.startsWith("/api/dashboard/bootstrap")) return { freshFor: 45_000, retainFor: 180_000 };
  if (key.includes("/history?")) return { freshFor: 30_000, retainFor: 120_000 };
  if (key.includes("/follow-ups")) return { freshFor: 30_000, retainFor: 90_000 };
  if (key.includes("/evaluation?") && !key.includes("list=1")) return { freshFor: 60_000, retainFor: 120_000 };
  if (key.startsWith("/api/clinic/") || key === "/api/team" || key === "/api/procedures" || key === "/api/products" || key === "/api/quotes/options") {
    return { freshFor: 300_000, retainFor: 900_000 };
  }
  return { freshFor: 60_000, retainFor: 300_000 };
}

// Chave de período da agenda (/api/agenda?from=..&to=..) que contém o dia AAAA-MM-DD.
export function agendaKeyCoversDay(cacheKey: string, day: string) {
  const match = /^\/api\/agenda\?from=(\d{4}-\d{2}-\d{2})&to=(\d{4}-\d{2}-\d{2})$/.exec(cacheKey);
  return Boolean(match) && match![1] <= day && day <= match![2];
}

function isPhotoKey(key: string) {
  return key.includes("/history?") || key.includes("/follow-ups") || (key.includes("/evaluation?") && !key.includes("list=1"));
}

function remove(key: string) {
  cache.get(key)?.controller?.abort();
  cache.delete(key);
}

function remember(key: string, entry: CacheEntry) {
  cache.delete(key);
  cache.set(key, entry);
  const photoKeys = [...cache.keys()].filter(isPhotoKey);
  for (const oldKey of photoKeys.slice(0, Math.max(0, photoKeys.length - maxPhotoEntries))) remove(oldKey);
  while (cache.size > maxEntries) remove(cache.keys().next().value as string);
}

export function clearClientCache() {
  generation += 1;
  for (const key of cache.keys()) remove(key);
}

export function setClientCacheScope(nextScope: string | null) {
  if (scope === nextScope) return;
  clearClientCache();
  scope = nextScope;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CLIENT_CACHE_SCOPE_CHANGED_EVENT));
}

export function readClientCache<T>(key: string) {
  const entry = cache.get(key);
  if (!entry || entry.updatedAt === undefined) return undefined;
  if (Date.now() - entry.updatedAt > policyFor(key).retainFor) {
    remove(key);
    return undefined;
  }
  remember(key, entry);
  return entry.data as T;
}

export async function getCachedJson<T>(key: string, url = key) {
  const current = cache.get(key);
  if (current?.promise) return current.promise as Promise<T>;
  if (current?.updatedAt !== undefined && Date.now() - current.updatedAt <= policyFor(key).freshFor) {
    remember(key, current);
    return current.data as T;
  }

  const requestGeneration = generation;
  const controller = new AbortController();
  const entry: CacheEntry = { data: current?.data, updatedAt: current?.updatedAt, controller };
  const promise = fetch(url, { cache: "no-store", signal: controller.signal })
    .then(async (response) => {
      if (generation !== requestGeneration || controller.signal.aborted) throw new DOMException("Consulta cancelada.", "AbortError");
      if (response.status === 401) {
        setClientCacheScope(null);
        if (typeof window !== "undefined") window.dispatchEvent(new Event(CLIENT_CACHE_UNAUTHORIZED_EVENT));
      }
      if (!response.ok) throw new Error(`Não foi possível carregar ${url}.`);
      const data = await response.json() as T;
      if (generation !== requestGeneration || controller.signal.aborted) throw new DOMException("Consulta cancelada.", "AbortError");
      if (cache.get(key) === entry) remember(key, { data, updatedAt: Date.now() });
      return data;
    })
    .catch((error) => {
      if (cache.get(key) === entry) {
        if (entry.updatedAt !== undefined) remember(key, { data: entry.data, updatedAt: entry.updatedAt });
        else cache.delete(key);
      }
      throw error;
    });
  entry.promise = promise;
  remember(key, entry);
  return promise;
}

export const CLIENT_CACHE_INVALIDATED_EVENT = "client-cache:invalidated";
export const CLIENT_CACHE_SCOPE_CHANGED_EVENT = "client-cache:scope-changed";
export const CLIENT_CACHE_UNAUTHORIZED_EVENT = "client-cache:unauthorized";

export function invalidateClientCache(...keys: string[]) {
  const affected = new Set(keys);
  for (const key of keys) {
    const patientResource = key.match(/^\/api\/patients\/([^/?]+)\/(history|evaluation|observations|procedures)(?:[/?]|$)/);
    if (patientResource) {
      const patientPrefix = `/api/patients/${patientResource[1]}`;
      affected.add(`${patientPrefix}/profile`);
      affected.add(`${patientPrefix}/journeys`);
      affected.add(`${patientPrefix}/encounters`);
      // A galeria de fotos e a lista de documentos (itens de sistema) derivam desses registros.
      affected.add(`${patientPrefix}/photos`);
      if (patientResource[2] === "evaluation") affected.add(`${patientPrefix}/documents`);
      // A anamnese também lê a avaliação como fallback.
      if (patientResource[2] === "evaluation") affected.add(`${patientPrefix}/anamnesis`);
    }
    // A lista de atendimentos é derivada de jornadas, sessões e retornos.
    const encounterSource = key.match(/^\/api\/patients\/([^/?]+)\/(journeys|procedure-sessions)(?:[/?]|$)/);
    if (encounterSource) { affected.add(`/api/patients/${encounterSource[1]}/encounters`); affected.add(`/api/patients/${encounterSource[1]}/photos`); }
    // O resumo de consentimento (gate de início do procedimento) vem dos termos em Documentos clínicos.
    const documentSource = key.match(/^\/api\/patients\/([^/?]+)\/documents(?:[/?]|$)/);
    if (documentSource) affected.add(`/api/patients/${documentSource[1]}/procedure-sessions`);
    const anamnesisSource = key.match(/^\/api\/patients\/([^/?]+)\/anamnesis(?:[/?]|$)/);
    if (anamnesisSource) affected.add(`/api/patients/${anamnesisSource[1]}/documents`);
  }
  // A lista de pacientes e as buscas dos seletores (/api/patients/lookup) partilham as mesmas mudanças (paciente novo/editado).
  if (keys.some((key) => key === "/api/patients" || key.startsWith("/api/patients?"))) {
    affected.add("/api/patients/lookup");
    // Os registros individuais (/api/patients/<id>) também mudam com a lista; subrecursos (/api/patients/<id>/...) não.
    for (const cachedKey of [...cache.keys()]) if (/^\/api\/patients\/[^/?]+(?:\?.*)?$/.test(cachedKey)) remove(cachedKey);
  }
  // "/api/agenda?day=AAAA-MM-DD" derruba só os períodos da agenda em cache que contêm esse dia (os demais continuam válidos).
  const changedDays = keys.map((key) => /^\/api\/agenda\?day=(\d{4}-\d{2}-\d{2})$/.exec(key)?.[1]).filter((day): day is string => Boolean(day));
  if (changedDays.length) for (const cachedKey of [...cache.keys()]) if (changedDays.some((day) => agendaKeyCoversDay(cachedKey, day))) remove(cachedKey);
  // Agendamentos e conferência de materiais alteram o próximo retorno e as pendências de qualquer paciente em cache.
  if (keys.some((key) => key.startsWith("/api/agenda") || key.startsWith("/api/appointments") || key.startsWith("/api/stock/pending"))) {
    for (const cachedKey of cache.keys()) { const match = cachedKey.match(/^(\/api\/patients\/[^/?]+\/encounters)(?:\?|$)/); if (match) affected.add(match[1]); }
  }
  for (const cachedKey of cache.keys()) {
    // /photos também derruba /photos/<ref> (marcações por foto), que são derivadas dos mesmos registros.
    if ([...affected].some((key) => cachedKey === key || cachedKey.startsWith(`${key}?`) || (key.endsWith("/photos") && cachedKey.startsWith(`${key}/`)))) remove(cachedKey);
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<string[]>(CLIENT_CACHE_INVALIDATED_EVENT, { detail: [...affected] }));
}
