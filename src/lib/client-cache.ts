type CacheEntry = {
  data?: unknown;
  promise?: Promise<unknown>;
};

const cache = new Map<string, CacheEntry>();

export function readClientCache<T>(key: string) {
  return cache.get(key)?.data as T | undefined;
}

export async function getCachedJson<T>(key: string, url = key) {
  const current = cache.get(key);
  if (current?.data) return current.data as T;
  if (current?.promise) return current.promise as Promise<T>;
  const promise = fetch(url, { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Não foi possível carregar ${url}.`);
      return response.json() as Promise<T>;
    })
    .then((data) => {
      if (cache.get(key)?.promise === promise) cache.set(key, { data });
      return data;
    })
    .catch((error) => {
      if (cache.get(key)?.promise === promise) cache.delete(key);
      throw error;
    });
  cache.set(key, { promise });
  return promise;
}

export const CLIENT_CACHE_INVALIDATED_EVENT = "client-cache:invalidated";

export function invalidateClientCache(...keys: string[]) {
  for (const cachedKey of cache.keys()) {
    if (keys.some((key) => cachedKey === key || cachedKey.startsWith(`${key}?`))) {
      cache.delete(cachedKey);
    }
  }
  // Permite que telas abertas recarreguem dados derivados quando algo muda.
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<string[]>(CLIENT_CACHE_INVALIDATED_EVENT, { detail: keys }));
}
