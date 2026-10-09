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
  if (key.includes("/evaluation?") && !key.includes("list=1")) return { freshFor: 60_000, retainFor: 120_000 };
  if (key.startsWith("/api/clinic/") || key === "/api/team" || key === "/api/procedures" || key === "/api/products" || key === "/api/quotes/options") {
    return { freshFor: 300_000, retainFor: 900_000 };
  }
  return { freshFor: 60_000, retainFor: 300_000 };
}

function isPhotoKey(key: string) {
  return key.includes("/history?") || (key.includes("/evaluation?") && !key.includes("list=1"));
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
  for (const cachedKey of cache.keys()) {
    if (keys.some((key) => cachedKey === key || cachedKey.startsWith(`${key}?`))) remove(cachedKey);
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<string[]>(CLIENT_CACHE_INVALIDATED_EVENT, { detail: keys }));
}
