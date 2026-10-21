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
  if (key.startsWith("/api/agenda/bootstrap")) return { freshFor: 20_000, retainFor: 90_000 };
  if (key.startsWith("/api/dashboard/bootstrap")) return { freshFor: 45_000, retainFor: 180_000 };
  if (key.includes("/history?")) return { freshFor: 30_000, retainFor: 120_000 };
  if (key.includes("/follow-ups")) return { freshFor: 30_000, retainFor: 90_000 };
  if (key.includes("/evaluation?") && !key.includes("list=1")) return { freshFor: 60_000, retainFor: 120_000 };
  if (key.startsWith("/api/clinic/") || key === "/api/team" || key === "/api/procedures" || key === "/api/products" || key === "/api/quotes/options") {
    return { freshFor: 300_000, retainFor: 900_000 };
  }
  return { freshFor: 60_000, retainFor: 300_000 };
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
  // Agendamentos e conferência de materiais alteram o próximo retorno e as pendências de qualquer paciente em cache.
  if (keys.some((key) => key.startsWith("/api/agenda/bootstrap") || key.startsWith("/api/appointments") || key.startsWith("/api/stock/pending"))) {
    for (const cachedKey of cache.keys()) { const match = cachedKey.match(/^(\/api\/patients\/[^/?]+\/encounters)(?:\?|$)/); if (match) affected.add(match[1]); }
  }
  for (const cachedKey of cache.keys()) {
    // /photos também derruba /photos/<ref> (marcações por foto), que são derivadas dos mesmos registros.
    if ([...affected].some((key) => cachedKey === key || cachedKey.startsWith(`${key}?`) || (key.endsWith("/photos") && cachedKey.startsWith(`${key}/`)))) remove(cachedKey);
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<string[]>(CLIENT_CACHE_INVALIDATED_EVENT, { detail: [...affected] }));
}
