import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { clearClientCache, getCachedJson, readClientCache, setClientCacheScope } from "../src/lib/client-cache.ts";
import { invalidateFinanceCache, invalidatePaymentCache, invalidateRecurringCache } from "../src/lib/finance-cache.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; setClientCacheScope(null); clearClientCache(); });

const financeKeys = [
  "/api/finance/summary?period=month", "/api/finance/flow?granularity=day&period=month", "/api/finance/movements?type=all&page=1",
  "/api/finance/accounts?kind=receivable&status=open", "/api/expenses?period=month", "/api/recurring-expenses",
];

async function fill(keys) {
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }));
  setClientCacheScope("u:c");
  for (const key of keys) await getCachedJson(key);
  for (const key of keys) assert.ok(readClientCache(key), key);
}

test("invalidateFinanceCache derruba as chaves do financeiro com parâmetros", async () => {
  await fill([...financeKeys, "/api/payments"]);
  invalidateFinanceCache();
  for (const key of financeKeys) assert.equal(readClientCache(key), undefined, key);
  assert.ok(readClientCache("/api/payments"));
});

test("invalidatePaymentCache derruba financeiro, pagamentos, painel e história/perfil do paciente", async () => {
  const keys = [...financeKeys, "/api/payments", "/api/dashboard/bootstrap", "/api/patients/p1/history?x=1", "/api/patients/p1/profile", "/api/patients/p2/profile"];
  await fill(keys);
  invalidatePaymentCache("p1");
  for (const key of keys.filter((item) => !item.includes("p2"))) assert.equal(readClientCache(key), undefined, key);
  assert.ok(readClientCache("/api/patients/p2/profile"));
});

test("invalidateRecurringCache derruba também o histórico da despesa fixa", async () => {
  const keys = [...financeKeys, "/api/recurring-expenses/r1?limit=24", "/api/recurring-expenses/r2?limit=24"];
  await fill(keys);
  invalidateRecurringCache("r1");
  for (const key of keys.filter((item) => !item.includes("r2"))) assert.equal(readClientCache(key), undefined, key);
  assert.ok(readClientCache("/api/recurring-expenses/r2?limit=24"));
});
