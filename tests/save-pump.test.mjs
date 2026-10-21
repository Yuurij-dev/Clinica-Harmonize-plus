import assert from "node:assert/strict";
import { test } from "node:test";
import { createSavePump } from "../src/lib/save-pump.ts";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Servidor simulado com a mesma regra do PUT: só grava se a revisão esperada for a atual.
function fakeServer(delay = 20) {
  let revision = 0;
  const calls = [];
  return {
    calls,
    async put(expected) {
      calls.push(expected);
      await sleep(delay);
      if (expected !== revision) return { status: 409 };
      revision += 1;
      return { status: 200, revision };
    },
  };
}

test("dois flush simultâneos com save lento nunca enviam a mesma revisão esperada", async () => {
  const server = fakeServer();
  let local = 1;
  let known = 0;
  const pump = createSavePump({
    latest: () => local, scope: () => "a",
    save: async () => { const response = await server.put(known); if (response.status !== 200) return false; known = response.revision; return true; },
  });
  const [first, second] = await Promise.all([pump.flush(), pump.flush()]);
  assert.equal(first, true);
  assert.equal(second, true);
  assert.deepEqual(server.calls, [0], "a segunda chamada vê o rascunho já salvo e não grava de novo");
});

test("edição durante a gravação gera outra gravação sequencial, e a conclusão (flush) espera ambas", async () => {
  const server = fakeServer();
  let local = 1;
  let known = 0;
  const pump = createSavePump({
    latest: () => local, scope: () => "a",
    save: async () => { const response = await server.put(known); if (response.status !== 200) return false; known = response.revision; return true; },
  });
  const timerFlush = pump.flush();
  await sleep(5);
  local = 2; // usuário digita enquanto o autosave está em voo
  const completeFlush = pump.flush();
  assert.equal(await timerFlush, true);
  assert.equal(await completeFlush, true);
  assert.deepEqual(server.calls, [0, 1]);
  assert.equal(pump.isDirty(), false);
  assert.equal(pump.busy, false);
});

test("falha não marca como salvo e a fila segue funcionando; mudança de escopo descarta o resultado", async () => {
  let ok = false;
  let local = 1;
  let scope = "a";
  const pump = createSavePump({ latest: () => local, scope: () => scope, save: async () => ok });
  assert.equal(await pump.flush(), false);
  assert.equal(pump.isDirty(), true);
  ok = true;
  assert.equal(await pump.flush(), true);
  local = 2;
  const pumpScope = createSavePump({ latest: () => local, scope: () => scope, save: async () => { scope = "b"; return true; } });
  assert.equal(await pumpScope.flush(), false);
  const throwing = createSavePump({ latest: () => 1, scope: () => "a", save: async () => { throw new Error("rede"); } });
  assert.equal(await throwing.flush(), false);
});

test("markSaved define a linha de base e evita gravação desnecessária", async () => {
  let calls = 0;
  const pump = createSavePump({ latest: () => 5, scope: () => "a", save: async () => { calls += 1; return true; } });
  pump.markSaved(5);
  assert.equal(await pump.flush(), true);
  assert.equal(calls, 0);
});
