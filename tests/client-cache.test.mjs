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

test("invalidates patient profile and journey summaries after clinical history changes", async () => {
  let requests = 0;
  globalThis.fetch = async (url) => {
    requests += 1;
    return new Response(JSON.stringify({ url, requests }), { status: 200 });
  };
  setClientCacheScope("user-a:clinic-a");
  const profile = "/api/patients/1/profile";
  const journeys = "/api/patients/1/journeys";
  const history = "/api/patients/1/history?tab=Procedimentos&journeyId=j1";
  await Promise.all([getCachedJson(profile), getCachedJson(journeys), getCachedJson(history)]);
  invalidateClientCache("/api/patients/1/history");
  await Promise.all([getCachedJson(profile), getCachedJson(journeys), getCachedJson(history)]);
  assert.equal(requests, 6);
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

test("mudanças em histórico, jornadas ou sessões também invalidam a lista de atendimentos do mesmo paciente", async () => {
  globalThis.fetch = async (url) => new Response(JSON.stringify({ url }), { status: 200 });
  setClientCacheScope("user-a:clinic-a");
  const keys = ["/api/patients/p1/encounters", "/api/patients/p2/encounters", "/api/patients/p1/anamnesis"];
  const warm = () => Promise.all(keys.map((key) => getCachedJson(key)));
  for (const changed of ["/api/patients/p1/history", "/api/patients/p1/journeys", "/api/patients/p1/procedure-sessions/s1/follow-ups", "/api/patients/p1/evaluation"]) {
    await warm();
    invalidateClientCache(changed);
    assert.equal(readClientCache("/api/patients/p1/encounters"), undefined, changed);
    assert.notEqual(readClientCache("/api/patients/p2/encounters"), undefined, changed);
    if (!changed.endsWith("/evaluation")) assert.notEqual(readClientCache("/api/patients/p1/anamnesis"), undefined, changed);
  }
});

test("avaliação invalida a anamnese; agenda e estoque pendente invalidam os atendimentos de todos os pacientes em cache", async () => {
  globalThis.fetch = async (url) => new Response(JSON.stringify({ url }), { status: 200 });
  setClientCacheScope("user-a:clinic-a");
  const keys = ["/api/patients/p1/encounters", "/api/patients/p2/encounters", "/api/patients/p1/anamnesis", "/api/patients/p2/anamnesis"];
  const warm = () => Promise.all(keys.map((key) => getCachedJson(key)));
  await warm();
  invalidateClientCache("/api/patients/p1/evaluation");
  assert.equal(readClientCache("/api/patients/p1/anamnesis"), undefined);
  assert.notEqual(readClientCache("/api/patients/p2/anamnesis"), undefined);
  for (const changed of ["/api/agenda/bootstrap", "/api/appointments/options", "/api/stock/pending"]) {
    await warm();
    invalidateClientCache(changed);
    assert.equal(readClientCache("/api/patients/p1/encounters"), undefined, changed);
    assert.equal(readClientCache("/api/patients/p2/encounters"), undefined, changed);
    assert.notEqual(readClientCache("/api/patients/p1/anamnesis"), undefined, changed);
  }
});

test("fotos e documentos: chaves com query são invalidadas por prefixo, só do mesmo paciente, e por registros de origem", async () => {
  globalThis.fetch = async (url) => new Response(JSON.stringify({ url }), { status: 200 });
  setClientCacheScope("user-a:clinic-a");
  const keys = ["/api/patients/p1/documents?page=1&pageSize=9", "/api/patients/p1/documents?category=EXAMES", "/api/patients/p2/documents?page=1", "/api/patients/p1/photos", "/api/patients/p2/photos"];
  const warm = () => Promise.all(keys.map((key) => getCachedJson(key)));
  await warm();
  invalidateClientCache("/api/patients/p1/documents");
  assert.equal(readClientCache(keys[0]), undefined);
  assert.equal(readClientCache(keys[1]), undefined);
  assert.notEqual(readClientCache(keys[2]), undefined);
  assert.notEqual(readClientCache(keys[3]), undefined);
  await warm();
  invalidateClientCache("/api/patients/p1/photos");
  assert.equal(readClientCache(keys[3]), undefined);
  assert.notEqual(readClientCache(keys[4]), undefined);
  assert.notEqual(readClientCache(keys[0]), undefined);
  for (const changed of ["/api/patients/p1/evaluation", "/api/patients/p1/history", "/api/patients/p1/procedure-sessions/s1/follow-ups"]) {
    await warm();
    invalidateClientCache(changed);
    assert.equal(readClientCache(keys[3]), undefined, changed);
    assert.notEqual(readClientCache(keys[4]), undefined, changed);
    if (changed.endsWith("/evaluation")) assert.equal(readClientCache(keys[0]), undefined, changed);
  }
  await warm();
  invalidateClientCache("/api/patients/p1/anamnesis");
  assert.equal(readClientCache(keys[0]), undefined);
});

test("invalidar /photos também remove as marcações /photos/<ref> do mesmo paciente", async () => {
  globalThis.fetch = async (url) => new Response(JSON.stringify({ url }), { status: 200 });
  setClientCacheScope("user-a:clinic-a");
  const keys = ["/api/patients/p1/photos", "/api/patients/p1/photos/evaluation%3Ax", "/api/patients/p2/photos/evaluation%3Ay"];
  await Promise.all(keys.map((key) => getCachedJson(key)));
  invalidateClientCache("/api/patients/p1/evaluation");
  assert.equal(readClientCache(keys[0]), undefined);
  assert.equal(readClientCache(keys[1]), undefined);
  assert.notEqual(readClientCache(keys[2]), undefined);
});

test("mudar documentos do paciente também invalida as sessões de procedimento (resumo de consentimento), só do mesmo paciente", async () => {
  globalThis.fetch = async (url) => new Response(JSON.stringify({ url }), { status: 200 });
  setClientCacheScope("user-a:clinic-a");
  const keys = ["/api/patients/p1/procedure-sessions?journeyId=j1&quoteId=q1", "/api/patients/p2/procedure-sessions?journeyId=j2&quoteId=q2"];
  await Promise.all(keys.map((key) => getCachedJson(key)));
  invalidateClientCache("/api/patients/p1/documents");
  assert.equal(readClientCache(keys[0]), undefined);
  assert.notEqual(readClientCache(keys[1]), undefined);
});

test("patient list pages, searches and sizes are cached under separate stable keys", async () => {
  let requests = 0;
  globalThis.fetch = async (url) => { requests += 1; return new Response(JSON.stringify({ url }), { status: 200 }); };
  setClientCacheScope("user-a:clinic-a");
  const page1 = "/api/patients?page=1&pageSize=20&sort=name";
  const page2 = "/api/patients?page=2&pageSize=20&sort=name";
  const search = "/api/patients?page=1&pageSize=20&q=ana&sort=name";
  await Promise.all([getCachedJson(page1), getCachedJson(page2), getCachedJson(search)]);
  await Promise.all([getCachedJson(page1), getCachedJson(page2), getCachedJson(search)]);
  assert.equal(requests, 3);
  assert.deepEqual(readClientCache(page2), { url: page2 });
});

test("patient mutations refresh list pages and selector searches but not other patient resources", async () => {
  let requests = 0;
  globalThis.fetch = async (url) => { requests += 1; return new Response(JSON.stringify({ url, requests }), { status: 200 }); };
  setClientCacheScope("user-a:clinic-a");
  const keys = ["/api/patients?page=1&pageSize=20&sort=name", "/api/patients?page=2&pageSize=20&q=ana&sort=name", "/api/patients/lookup?q=ana&limit=8"];
  const untouched = ["/api/patients/p1/history?tab=Hist", "/api/quotes", "/api/agenda/bootstrap", "/api/agenda?from=2026-10-01&to=2026-10-31"];
  await Promise.all([...keys, ...untouched].map((key) => getCachedJson(key)));
  invalidateClientCache("/api/patients");
  for (const key of keys) assert.equal(readClientCache(key), undefined, key);
  for (const key of untouched) assert.notEqual(readClientCache(key), undefined, key);
});

test("invalidating the patient list also drops exact patient records but not their sub-resources", async () => {
  globalThis.fetch = async (url) => new Response(JSON.stringify({ url }), { status: 200 });
  setClientCacheScope("user-a:clinic-a");
  const records = ["/api/patients/p1", "/api/patients/p2"];
  const subResources = ["/api/patients/p1/profile", "/api/patients/p1/history?tab=Hist", "/api/patients/p2/journeys"];
  await Promise.all([...records, ...subResources].map((key) => getCachedJson(key)));
  invalidateClientCache("/api/patients");
  for (const key of records) assert.equal(readClientCache(key), undefined, key);
  for (const key of subResources) assert.notEqual(readClientCache(key), undefined, key);
});

test("invalidating one patient record leaves other patients and the list pages alone", async () => {
  globalThis.fetch = async (url) => new Response(JSON.stringify({ url }), { status: 200 });
  setClientCacheScope("user-a:clinic-a");
  await Promise.all(["/api/patients/p1", "/api/patients/p2", "/api/patients?page=1&pageSize=20&sort=name"].map((key) => getCachedJson(key)));
  invalidateClientCache("/api/patients/p1");
  assert.equal(readClientCache("/api/patients/p1"), undefined);
  assert.notEqual(readClientCache("/api/patients/p2"), undefined);
  assert.notEqual(readClientCache("/api/patients?page=1&pageSize=20&sort=name"), undefined);
});

test("agenda periods are cached per range and a changed day only drops the periods that contain it", async () => {
  let requests = 0;
  globalThis.fetch = async (url) => { requests += 1; return new Response(JSON.stringify({ url }), { status: 200 }); };
  setClientCacheScope("user-a:clinic-a");
  const october = "/api/agenda?from=2026-10-01&to=2026-10-31";
  const novemberWeek = "/api/agenda?from=2026-11-02&to=2026-11-08";
  const octoberWeek = "/api/agenda?from=2026-10-19&to=2026-10-25";
  const november = "/api/agenda?from=2026-11-01&to=2026-11-30";
  await Promise.all([october, novemberWeek, octoberWeek, november, "/api/agenda/bootstrap", "/api/dashboard/bootstrap"].map((key) => getCachedJson(key)));
  assert.equal(requests, 6);
  invalidateClientCache("/api/agenda?day=2026-10-22");
  assert.equal(readClientCache(october), undefined);
  assert.equal(readClientCache(octoberWeek), undefined);
  assert.notEqual(readClientCache(novemberWeek), undefined);
  assert.notEqual(readClientCache(november), undefined);
  assert.notEqual(readClientCache("/api/agenda/bootstrap"), undefined);
  // Dia limite: 31/10 está no mês de outubro, mas não na semana de 19 a 25.
  await getCachedJson(october);
  await getCachedJson(octoberWeek);
  invalidateClientCache("/api/agenda?day=2026-10-31");
  assert.equal(readClientCache(october), undefined);
  assert.notEqual(readClientCache(octoberWeek), undefined);
});

test("invalidating /api/agenda drops every cached period but keeps the static bootstrap", async () => {
  globalThis.fetch = async (url) => new Response(JSON.stringify({ url }), { status: 200 });
  setClientCacheScope("user-a:clinic-a");
  await Promise.all(["/api/agenda?from=2026-10-01&to=2026-10-31", "/api/agenda?from=2026-11-01&to=2026-11-30", "/api/agenda/bootstrap"].map((key) => getCachedJson(key)));
  invalidateClientCache("/api/agenda");
  assert.equal(readClientCache("/api/agenda?from=2026-10-01&to=2026-10-31"), undefined);
  assert.equal(readClientCache("/api/agenda?from=2026-11-01&to=2026-11-30"), undefined);
  assert.notEqual(readClientCache("/api/agenda/bootstrap"), undefined);
});

test("agenda changes refresh each patient's encounters (next return) but not their other resources", async () => {
  globalThis.fetch = async (url) => new Response(JSON.stringify({ url }), { status: 200 });
  setClientCacheScope("user-a:clinic-a");
  await Promise.all(["/api/patients/p1/encounters?page=1", "/api/patients/p1/documents"].map((key) => getCachedJson(key)));
  invalidateClientCache("/api/agenda?day=2026-10-22");
  assert.equal(readClientCache("/api/patients/p1/encounters?page=1"), undefined);
  assert.notEqual(readClientCache("/api/patients/p1/documents"), undefined);
});

test("a failed period request leaves other cached agenda periods intact", async () => {
  let fail = false;
  globalThis.fetch = async (url) => fail ? new Response("{}", { status: 500 }) : new Response(JSON.stringify({ url }), { status: 200 });
  setClientCacheScope("user-a:clinic-a");
  const key = "/api/agenda?from=2026-10-01&to=2026-10-31";
  await getCachedJson(key);
  fail = true;
  await assert.rejects(getCachedJson("/api/agenda?from=2026-11-01&to=2026-11-30"));
  assert.deepEqual(readClientCache(key), { url: key });
  assert.equal(readClientCache("/api/agenda?from=2026-11-01&to=2026-11-30"), undefined);
});
