import assert from "node:assert/strict";
import { test } from "node:test";
import { STOCK_CATALOG, catalogCategories, filterStockCatalog, findCatalogItem } from "../src/lib/stock-catalog.ts";
import { normalizeSearch } from "../src/lib/procedure-catalog-rules.ts";
import { isStockKind, isStockUnit } from "../src/lib/stock-rules.ts";

test("catálogo tem entre 45 e 55 itens com slugs e nomes únicos", () => {
  assert.ok(STOCK_CATALOG.length >= 45 && STOCK_CATALOG.length <= 55);
  assert.equal(new Set(STOCK_CATALOG.map((item) => item.slug)).size, STOCK_CATALOG.length);
  assert.equal(new Set(STOCK_CATALOG.map((item) => normalizeSearch(item.name))).size, STOCK_CATALOG.length);
});

test("todo item tem tipo, unidade, categoria e slug válidos", () => {
  for (const item of STOCK_CATALOG) {
    assert.ok(isStockKind(item.kind), item.slug);
    assert.ok(isStockUnit(item.unit), item.slug);
    assert.ok(item.category && item.name.trim() === item.name && item.name.length <= 120, item.slug);
    assert.match(item.slug, /^[a-z0-9-]+$/);
  }
  assert.ok(catalogCategories.length > 1);
});

test("busca ignora acento e caixa", () => {
  assert.ok(filterStockCatalog(STOCK_CATALOG, "ACIDO hialuronico").every((item) => item.name.includes("Ácido hialurônico")));
  assert.ok(filterStockCatalog(STOCK_CATALOG, "canula").length >= 2);
  assert.equal(filterStockCatalog(STOCK_CATALOG, "").length, STOCK_CATALOG.length);
  assert.equal(filterStockCatalog(STOCK_CATALOG, "zzzz inexistente").length, 0);
});

test("filtro por tipo", () => {
  const materials = filterStockCatalog(STOCK_CATALOG, "", "material");
  const products = filterStockCatalog(STOCK_CATALOG, "", "produto");
  assert.ok(materials.length && products.length);
  assert.equal(materials.length + products.length, STOCK_CATALOG.length);
  assert.ok(materials.every((item) => item.kind === "material"));
  assert.equal(filterStockCatalog(STOCK_CATALOG, "agulha", "produto").length, 0);
});

test("findCatalogItem", () => {
  assert.equal(findCatalogItem("agulha-30g")?.name, "Agulha 30G (13 mm)");
  assert.equal(findCatalogItem("nao-existe"), undefined);
  assert.equal(findCatalogItem(undefined), undefined);
  assert.equal(findCatalogItem({}), undefined);
});
