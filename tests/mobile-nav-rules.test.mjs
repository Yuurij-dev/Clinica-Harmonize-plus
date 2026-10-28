import assert from "node:assert/strict";
import { test } from "node:test";
import { quickCreateFor, splitMobileSections } from "../src/lib/mobile-nav-rules.ts";
import { visibleSections } from "../src/lib/permissions.ts";

test("administrador: 4 destinos fixos na barra e o resto em Mais", () => {
  const allowed = visibleSections("ADMIN");
  const { bar, more } = splitMobileSections(allowed);
  assert.deepEqual(bar, ["agenda", "clientes", "orcamentos", "pagamentos"]);
  assert.equal(bar.length + more.length, allowed.length);
  assert.ok(more.includes("dashboard") && more.includes("configuracoes"));
});

test("papéis com poucas seções mostram todas na barra; com mais que 4, o excedente vai para Mais", () => {
  assert.deepEqual(splitMobileSections(["agenda", "clientes"]), { bar: ["agenda", "clientes"], more: [] });
  assert.deepEqual(splitMobileSections(["agenda", "clientes", "orcamentos", "pagamentos"]), { bar: ["agenda", "clientes", "orcamentos", "pagamentos"], more: [] });
  assert.deepEqual(splitMobileSections(visibleSections("PROFESSIONAL")), { bar: ["agenda", "clientes", "orcamentos"], more: ["procedimentos", "configuracoes"] });
});

test("criação rápida só oferece o que as seções permitidas abrem", () => {
  assert.equal(quickCreateFor(visibleSections("ADMIN")).length, 4);
  assert.deepEqual(quickCreateFor(visibleSections("PROFESSIONAL")).map((item) => item.id), ["appointment", "client", "quote"]);
  assert.deepEqual(quickCreateFor(visibleSections("STAFF")).map((item) => item.id), ["appointment", "client"]);
  assert.deepEqual(quickCreateFor(visibleSections(null)), []);
});
