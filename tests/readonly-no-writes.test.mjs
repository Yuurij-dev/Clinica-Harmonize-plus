import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// Somente leitura precisa consultar SEM alterar o banco. Testes estruturais sobre as rotas (sem subir servidor):
// 1) nenhum handler GET grava despesas recorrentes; 2) nenhuma rota usa mais requireActiveTrial (que respondia 401);
// 3) toda rota de escrita que antes exigia trial ativo agora passa por denyIfReadonly (403 com code).

const apiRoot = join(process.cwd(), "src", "app", "api");
const routes = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path); else if (name === "route.ts") routes.push(path);
  }
})(apiRoot);

// Corpo de cada handler exportado (do `export async function X` até o próximo `export` ou o fim).
function handlers(source) {
  const found = [];
  const re = /export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/g;
  const marks = [...source.matchAll(re)].map((match) => ({ method: match[1], start: match.index }));
  // Fatia cada handler até o primeiro "}" na coluna 0 (convenção do projeto); helpers entre handlers não entram no corpo.
  marks.forEach((mark) => {
    const close = source.indexOf("\n}", mark.start);
    found.push({ method: mark.method, code: source.slice(mark.start, close < 0 ? source.length : close + 2) });
  });
  return found;
}

test("nenhum GET gera despesas recorrentes (nem chama escrita no banco para isso)", () => {
  for (const file of routes) {
    for (const handler of handlers(readFileSync(file, "utf8"))) {
      if (handler.method !== "GET") continue;
      assert.equal(/ensureRecurringOccurrences/.test(handler.code), false, `${file}: GET chama ensureRecurringOccurrences`);
    }
  }
});

test("ensureRecurringOccurrences só é chamado por handlers de escrita", () => {
  let writers = 0;
  for (const file of routes) {
    for (const handler of handlers(readFileSync(file, "utf8"))) {
      if (!/ensureRecurringOccurrences\(/.test(handler.code)) continue;
      writers += 1;
      assert.notEqual(handler.method, "GET", file);
    }
  }
  assert.ok(writers >= 3, "POST create, POST sync e PATCH deveriam chamar a geração");
});

test("requireActiveTrial não existe mais em src (bloqueio comercial é 403 com code, nunca 401)", () => {
  const offenders = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name) && /requireActiveTrial/.test(readFileSync(path, "utf8"))) offenders.push(path);
    }
  })(join(process.cwd(), "src"));
  assert.deepEqual(offenders, []);
});

test("toda rota de escrita que passa por denyIfReadonly o faz depois da checagem de login (401 só sem sessão)", () => {
  let guarded = 0;
  for (const file of routes) {
    const source = readFileSync(file, "utf8");
    for (const handler of handlers(source)) {
      const at = handler.code.indexOf("denyIfReadonly(");
      if (at < 0) continue;
      guarded += 1;
      const auth = handler.code.indexOf("getCurrentUser(");
      assert.ok(auth >= 0 && auth < at, `${file} ${handler.method}: denyIfReadonly antes de getCurrentUser`);
      assert.notEqual(handler.method, "GET", `${file}: GET não deve bloquear por somente leitura`);
    }
  }
  assert.ok(guarded >= 60, `esperava dezenas de handlers protegidos, achei ${guarded}`);
});

test("o guard de somente leitura vem ANTES de qualquer leitura de corpo ou acesso ao banco no handler", () => {
  for (const file of routes) {
    for (const handler of handlers(readFileSync(file, "utf8"))) {
      const guard = handler.code.search(/denyIfReadonly\(|adminUser\(true/);
      if (guard < 0) continue;
      const firstWork = handler.code.search(/request\.(json|formData|text|arrayBuffer)\(|prisma\.\w+\.(create|update|delete|upsert|find|count)|\$transaction/);
      assert.ok(firstWork < 0 || guard < firstWork, `${file} ${handler.method}: guard depois de ler corpo/banco`);
    }
  }
});

test("denyIfReadonly NÃO aparece em GET: consultar é sempre permitido", () => {
  for (const file of routes) {
    for (const handler of handlers(readFileSync(file, "utf8"))) {
      if (handler.method === "GET") assert.equal(/denyIfReadonly|adminUser\(true/.test(handler.code), false, file);
    }
  }
});
