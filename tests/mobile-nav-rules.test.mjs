import assert from "node:assert/strict";
import { test } from "node:test";
import { quickCreateFor, splitMobileSections } from "../src/lib/mobile-nav-rules.ts";
import { visibleSections } from "../src/lib/permissions.ts";

test("administrador: 4 destinos fixos na barra e o resto em Mais", () => {
  const { bar, more } = splitMobileSections(visibleSections("ADMIN"));
  assert.deepEqual(bar, ["agenda", "clientes", "orcamentos", "pagamentos"]);
  assert.equal(more.length, 8);
  assert.ok(more.includes("dashboard") && more.includes("configuracoes"));
});

test("profissional e atendente mostram todas as suas seções na barra", () => {
  assert.deepEqual(splitMobileSections(visibleSections("PROFESSIONAL")), { bar: ["agenda", "clientes", "orcamentos"], more: [] });
  assert.deepEqual(splitMobileSections(visibleSections("STAFF")), { bar: ["agenda", "clientes", "orcamentos", "pagamentos"], more: [] });
});

test("criação rápida só oferece o que o papel pode abrir", () => {
  assert.equal(quickCreateFor(visibleSections("ADMIN")).length, 4);
  assert.deepEqual(quickCreateFor(visibleSections("PROFESSIONAL")).map((item) => item.id), ["appointment", "client", "quote"]);
  assert.deepEqual(quickCreateFor(visibleSections("STAFF")).map((item) => item.id), ["appointment", "client", "quote", "payment"]);
  assert.deepEqual(quickCreateFor(visibleSections(null)), []);
});
