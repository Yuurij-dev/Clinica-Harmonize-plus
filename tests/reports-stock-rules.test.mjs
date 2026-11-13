import assert from "node:assert/strict";
import { test } from "node:test";
import { consumptionByProcedure, consumptionByProduct, knownCost, movementNote, movementTypeLabel, stockPosition, stockSituation, summarizeMovements } from "../src/lib/reports-stock-rules.ts";

const today = "2026-11-13";
const products = [
  { id: "a", name: "Ácido", kind: "produto", unit: "ml", costCents: 1000, minStock: 10, archived: false },
  { id: "b", name: "Agulha", kind: "material", unit: "unidade", costCents: 0, minStock: 5, archived: false },
  { id: "c", name: "Gaze", kind: "material", unit: "unidade", costCents: 50, minStock: 0, archived: false },
  { id: "d", name: "Antigo", kind: "material", unit: "unidade", costCents: 10, minStock: 0, archived: true },
];
const lots = [
  { productId: "a", expiresOn: "2026-11-01", balance: 4 }, // vencido
  { productId: "a", expiresOn: "2026-11-20", balance: 3 }, // a vencer (30 dias)
  { productId: "a", expiresOn: "2027-12-31", balance: 0 }, // sem saldo: não conta
  { productId: "b", expiresOn: "2027-12-31", balance: 20 },
  { productId: "d", expiresOn: "2027-12-31", balance: 2 },
];

test("situation: zero or negative = sem estoque, below minimum only with balance", () => {
  assert.equal(stockSituation(0, 0), "out_of_stock");
  assert.equal(stockSituation(-1, 0), "out_of_stock");
  assert.equal(stockSituation(3, 10), "below_minimum");
  assert.equal(stockSituation(10, 10), "ok");
});

test("knownCost: 0 means no cost registered (null), never zero", () => {
  assert.equal(knownCost(0), null);
  assert.equal(knownCost(null), null);
  assert.equal(knownCost(250), 250);
});

test("position: balance, situation, value with unknown cost, expiry and archived exclusion", () => {
  const { items, summary, archivedWithBalance } = stockPosition({ products, lots, today, warningDays: 30 });
  assert.deepEqual(items.map((item) => item.name), ["Ácido", "Agulha", "Gaze"]);
  const acid = items[0];
  assert.equal(acid.balance, 7);
  assert.equal(acid.situation, "below_minimum");
  assert.equal(acid.valueCents, 7000);
  assert.equal(acid.unitCostCents, 1000);
  assert.equal(acid.nextExpiry, "2026-11-01");
  assert.deepEqual([acid.expiredLots, acid.expiringLots], [1, 1]);
  const needle = items[1];
  assert.equal(needle.balance, 20);
  assert.equal(needle.unitCostCents, null);
  assert.equal(needle.valueCents, null); // custo desconhecido ≠ 0
  assert.equal(needle.situation, "ok");
  const gauze = items[2];
  assert.equal(gauze.balance, 0);
  assert.equal(gauze.situation, "out_of_stock");
  assert.equal(gauze.valueCents, 0); // custo conhecido e saldo 0: zero real
  assert.equal(gauze.nextExpiry, null);
  assert.equal(archivedWithBalance, 1);
  assert.deepEqual(
    [summary.items, summary.belowMinimum, summary.outOfStock, summary.expiredLots, summary.expiringLots, summary.totalValueCents, summary.itemsWithoutCost],
    [3, 1, 1, 1, 1, 7000, 1],
  );
});

test("position: total value is unknown when no stocked item has cost; zero only when nothing is stocked", () => {
  const onlyNoCost = stockPosition({ products: [products[1]], lots: [lots[3]], today, warningDays: 30 });
  assert.equal(onlyNoCost.summary.totalValueCents, null);
  const empty = stockPosition({ products: [products[2]], lots: [], today, warningDays: 30 });
  assert.equal(empty.summary.totalValueCents, 0);
  assert.equal(stockPosition({ products: [], lots: [], today, warningDays: 30 }).items.length, 0);
});

test("movement type labels, including the two meanings of reversal", () => {
  assert.equal(movementTypeLabel("initial"), "Entrada inicial");
  assert.equal(movementTypeLabel("purchase"), "Compra");
  assert.equal(movementTypeLabel("attendance"), "Consumo em atendimento");
  assert.equal(movementTypeLabel("manual_out"), "Saída manual");
  assert.equal(movementTypeLabel("count_adjustment"), "Ajuste de contagem");
  assert.equal(movementTypeLabel("reversal", "m1"), "Estorno");
  assert.equal(movementTypeLabel("reversal", null), "Cancelamento de compra desfeito");
  assert.equal(movementTypeLabel("purchase_cancel"), "Cancelamento de compra");
  assert.equal(movementTypeLabel("x_new"), "x_new");
});

const catalog = new Map([
  ["a", { id: "a", name: "Ácido", unit: "ml", kind: "produto", costCents: 1000 }],
  ["b", { id: "b", name: "Agulha", unit: "unidade", kind: "material", costCents: 0 }],
]);

test("summarizeMovements: entries/exits by type with cost, unknown cost kept apart", () => {
  const groups = [
    { productId: "a", type: "initial", sign: "in", quantity: 100, count: 1 },
    { productId: "b", type: "purchase", sign: "in", quantity: 50, count: 2 },
    { productId: "a", type: "attendance", sign: "out", quantity: -3, count: 2 },
    { productId: "b", type: "attendance", sign: "out", quantity: -4, count: 1 },
    { productId: "a", type: "manual_out", sign: "out", quantity: -1, count: 1 },
    { productId: "a", type: "count_adjustment", sign: "in", quantity: 2, count: 1 },
    { productId: "a", type: "count_adjustment", sign: "out", quantity: -5, count: 1 },
    { productId: "zzz", type: "attendance", sign: "out", quantity: -9, count: 9 }, // produto fora da clínica: ignorado
  ];
  const { types, items, totals } = summarizeMovements(groups, catalog);
  const byLabel = Object.fromEntries(types.map((entry) => [entry.label, entry]));
  assert.equal(byLabel["Entrada inicial"].costCents, 100_000);
  assert.equal(byLabel["Compra"].costCents, null); // só item sem custo
  assert.equal(byLabel["Compra"].missingCost, 2);
  assert.equal(byLabel["Consumo em atendimento"].movements, 3);
  assert.equal(byLabel["Consumo em atendimento"].costCents, 3000); // só o ácido tem custo
  assert.equal(byLabel["Consumo em atendimento"].missingCost, 1);
  assert.equal(byLabel["Ajuste de contagem (+)"].costCents, 2000);
  assert.equal(byLabel["Ajuste de contagem (−)"].costCents, 5000);
  assert.deepEqual(types.map((entry) => entry.sign), ["in", "in", "in", "out", "out", "out"]);
  assert.deepEqual([totals.entryMovements, totals.exitMovements], [4, 5]);
  assert.equal(totals.entryCostCents, 102_000);
  assert.equal(totals.exitCostCents, 9000);
  assert.equal(totals.movementsWithoutCost, 3);
  const acid = items.find((item) => item.name === "Ácido");
  assert.deepEqual([acid.inQuantity, acid.outQuantity, acid.netQuantity], [102, 9, 93]);
  assert.ok(!items.some((item) => item.productId === "zzz"));
});

test("summarizeMovements with no groups: zero movements and a REAL zero cost (nothing moved)", () => {
  const { types, totals } = summarizeMovements([], catalog);
  assert.equal(types.length, 0);
  assert.deepEqual([totals.entryMovements, totals.exitMovements], [0, 0]);
  assert.equal(totals.entryCostCents, 0);
  assert.equal(totals.exitCostCents, 0);
});

test("summarizeMovements: period with only entries or only exits has real zero on the empty side; null only when movements have no cost", () => {
  const onlyIn = summarizeMovements([{ productId: "a", type: "purchase", sign: "in", quantity: 10, count: 1 }], catalog).totals;
  assert.deepEqual([onlyIn.entryCostCents, onlyIn.exitCostCents], [10_000, 0]);
  const onlyOut = summarizeMovements([{ productId: "a", type: "manual_out", sign: "out", quantity: -2, count: 1 }], catalog).totals;
  assert.deepEqual([onlyOut.entryCostCents, onlyOut.exitCostCents], [0, 2_000]);
  const noCost = summarizeMovements([{ productId: "b", type: "purchase", sign: "in", quantity: 3, count: 1 }], catalog).totals; // Agulha: sem custo
  assert.deepEqual([noCost.entryCostCents, noCost.exitCostCents], [null, 0]);
});

test("consumption by product and procedure: item without cost is unknown, partial cost keeps the count", () => {
  const byProduct = consumptionByProduct([{ productId: "a", quantity: -3 }, { productId: "b", quantity: -4 }], catalog);
  assert.deepEqual(byProduct.map((item) => [item.name, item.quantity, item.estimatedCostCents]), [["Ácido", 3, 3000], ["Agulha", 4, null]]);
  const byProcedure = consumptionByProcedure(
    [
      { productId: "a", quantity: -2, procedure: "Botox" },
      { productId: "b", quantity: -1, procedure: "Botox" },
      { productId: "b", quantity: -1, procedure: "Peeling" },
    ],
    catalog,
  );
  assert.deepEqual(byProcedure, [
    { name: "Botox", movements: 2, estimatedCostCents: 2000, missingCostMovements: 1 },
    { name: "Peeling", movements: 1, estimatedCostCents: null, missingCostMovements: 1 },
  ]);
});

test("movementNote: never exports free text; attendance = procedure name, manual reason = fixed label, reversal = Estorno", () => {
  assert.equal(movementNote({ type: "attendance", reason: null, attendanceName: "Procedimento - Botox" }), "Procedimento - Botox");
  assert.equal(movementNote({ type: "attendance", reason: null, attendanceName: null }), "");
  assert.equal(movementNote({ type: "manual_out", reason: "loss", attendanceName: null }), "Perda/quebra");
  assert.equal(movementNote({ type: "count_adjustment", reason: "count", attendanceName: null }), "Correção de contagem");
  assert.equal(movementNote({ type: "manual_out", reason: "SEGREDO-NOTA texto livre", attendanceName: null }), ""); // não é da lista fixa
  assert.equal(movementNote({ type: "manual_out", reason: "toString", attendanceName: null }), ""); // sem acesso a protótipo
  assert.equal(movementNote({ type: "reversal", reason: "SEGREDO-NOTA", attendanceName: null }), "Estorno");
  assert.equal(movementNote({ type: "purchase", reason: "SEGREDO-NOTA", attendanceName: null }), "");
});
