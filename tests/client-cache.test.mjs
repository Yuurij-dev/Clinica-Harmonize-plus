import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  clearClientCache,
  getCachedJson,
  invalidateClientCache,
  readClientCache,
  setClientCacheScope,
} from "../src/lib/client-cache.ts";

const originalFetch = globalThis.fetch;
const originalNow = Date.now;

afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  setClientCacheScope(null);
  clearClientCache();
});

test("deduplicates requests, serves fresh data, and refreshes after the TTL", async () => {
  let now = 1_000;
  Date.now = () => now;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify({ requests }), { status: 200 });
  };
  setClientCacheScope("user-a:clinic-a");

  const [first, concurrent] = await Promise.all([
    getCachedJson("/api/patients"),
    getCachedJson("/api/patients"),
  ]);
  assert.deepEqual(first, concurrent);
  assert.equal(requests, 1);
  assert.deepEqual(await getCachedJson("/api/patients"), { requests: 1 });
  assert.equal(requests, 1);

  now += 60_001;
  assert.deepEqual(readClientCache("/api/patients"), { requests: 1 });
  assert.deepEqual(await getCachedJson("/api/patients"), { requests: 2 });
  assert.equal(requests, 2);
});

test("invalidates only affected keys, including query-string variants", async () => {
  let requests = 0;
  globalThis.fetch = async (url) => {
    requests += 1;
    return new Response(JSON.stringify({ url, requests }), { status: 200 });
  };
  setClientCacheScope("user-a:clinic-a");
  await getCachedJson("/api/patients/1/history?tab=Histórico");
  await getCachedJson("/api/dashboard/bootstrap");
  invalidateClientCache("/api/patients/1/history");
  await getCachedJson("/api/patients/1/history?tab=Histórico");
  await getCachedJson("/api/dashboard/bootstrap");
  assert.equal(requests, 3);
});

test("keeps patient and tab responses separate while reusing revisited tabs", async () => {
  let requests = 0;
  globalThis.fetch = async (url) => {
    requests += 1;
    return new Response(JSON.stringify({ url }), { status: 200 });
  };
  setClientCacheScope("user-a:clinic-a");
  const first = "/api/patients/1/history?tab=Procedimentos";
  const second = "/api/patients/1/history?tab=Histórico";
  const otherPatient = "/api/patients/2/history?tab=Procedimentos";
  await getCachedJson(first);
  await getCachedJson(second);
  await getCachedJson(otherPatient);
  assert.deepEqual(await getCachedJson(first), { url: first });
  assert.equal(requests, 3);
});

test("clears private data and discards an old in-flight response on user change", async () => {
  let releaseOld;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    if (requests === 1) return new Promise((resolve) => { releaseOld = resolve; });
    return new Response(JSON.stringify({ owner: "user-b" }), { status: 200 });
  };
  setClientCacheScope("user-a:clinic-a");
  const oldRequest = getCachedJson("/api/patients");
  setClientCacheScope("user-b:clinic-b");
  releaseOld(new Response(JSON.stringify({ owner: "user-a" }), { status: 200 }));
  await assert.rejects(oldRequest, { name: "AbortError" });
  assert.equal(readClientCache("/api/patients"), undefined);
  assert.deepEqual(await getCachedJson("/api/patients"), { owner: "user-b" });
  assert.equal(requests, 2);
});

test("an old unauthorized response cannot sign out a newer user", async () => {
  let releaseOld;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    if (requests === 1) return new Promise((resolve) => { releaseOld = resolve; });
    return new Response(JSON.stringify({ owner: "user-b" }), { status: 200 });
  };
  setClientCacheScope("user-a:clinic-a");
  const oldRequest = getCachedJson("/api/patients");
  setClientCacheScope("user-b:clinic-b");
  await getCachedJson("/api/patients");
  releaseOld(new Response("{}", { status: 401 }));
  await assert.rejects(oldRequest, { name: "AbortError" });
  assert.deepEqual(readClientCache("/api/patients"), { owner: "user-b" });
});

test("does not reuse private data after an unauthorized response", async () => {
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return requests === 1
      ? new Response(JSON.stringify({ owner: "user-a" }), { status: 200 })
      : new Response("{}", { status: 401 });
  };
  setClientCacheScope("user-a:clinic-a");
  await getCachedJson("/api/patients");
  invalidateClientCache("/api/patients");
  await assert.rejects(getCachedJson("/api/patients"));
  assert.equal(readClientCache("/api/patients"), undefined);
});
