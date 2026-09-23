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
  const promise = fetch(url)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Não foi possível carregar ${url}.`);
      return response.json() as Promise<T>;
    })
    .then((data) => {
      cache.set(key, { data });
      return data;
    })
    .catch((error) => {
      cache.delete(key);
      throw error;
    });
  cache.set(key, { promise });
  return promise;
}

export function invalidateClientCache(...keys: string[]) {
  keys.forEach((key) => cache.delete(key));
}
