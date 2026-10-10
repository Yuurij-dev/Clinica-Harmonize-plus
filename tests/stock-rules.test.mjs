import assert from "node:assert/strict";
import { test } from "node:test";
import { convertMaterialsText, describeTechnicalSheet, formatQuantity, lotBalance, lotStatus, materialBalance, parseQuantity, validateQuantity } from "../src/lib/stock-rules.ts";

test("lot balance sums signed movements without floating point noise", () => {
  assert.equal(lotBalance([{ quantity: 0.1 }, { quantity: 0.2 }]), 0.3);
  assert.equal(lotBalance([{ quantity: 10 }, { quantity: -2.5 }, { quantity: -1 }]), 6.5);
  assert.equal(lotBalance([]), 0);
});

test("material balance adds the balance of every lot and flags the minimum", () => {
  const lots = [{ balance: 2 }, { balance: 1.5 }, { balance: 0 }];
  assert.deepEqual(materialBalance(lots, 5), { balance: 3.5, belowMinimum: true });
  assert.deepEqual(materialBalance(lots, 3.5), { balance: 3.5, belowMinimum: false });
  assert.deepEqual(materialBalance([], 0), { balance: 0, belowMinimum: false });
});

test("lot status uses the clinic warning window", () => {
  const today = "2026-10-09";
  assert.equal(lotStatus("2026-11-09", today, 30), "valid");
  assert.equal(lotStatus("2026-11-08", today, 30), "expiring");
  assert.equal(lotStatus("2026-11-07", today, 30), "expiring");
  assert.equal(lotStatus("2026-10-09", today, 30), "expiring");
  assert.equal(lotStatus("2026-10-08", today, 30), "expired");
  assert.equal(lotStatus("2026-10-20", today, 10), "valid");
});

test("quantity accepts decimals only for ml", () => {
  assert.equal(validateQuantity(0.5, "ml"), null);
  assert.equal(validateQuantity(2, "unidade"), null);
  assert.equal(validateQuantity(1, "frasco"), null);
  assert.match(validateQuantity(1.5, "unidade"), /inteir/);
  assert.match(validateQuantity(0.5, "frasco"), /inteir/);
  assert.match(validateQuantity(0, "ml"), /maior que zero/);
  assert.match(validateQuantity(-1, "unidade"), /maior que zero/);
  assert.match(validateQuantity(Number.NaN, "ml"), /maior que zero/);
  assert.match(validateQuantity(0.0001, "ml"), /casas decimais/);
});

test("quantity text uses the Brazilian decimal comma", () => {
  assert.equal(parseQuantity("0,5"), 0.5);
  assert.equal(parseQuantity(" 12 "), 12);
  assert.equal(parseQuantity("1.000,25"), 1000.25);
  assert.ok(Number.isNaN(parseQuantity("")));
  assert.ok(Number.isNaN(parseQuantity("abc")));
  assert.equal(formatQuantity(0.5, "ml"), "0,5 ml");
  assert.equal(formatQuantity(2, "unidade"), "2 un");
  assert.equal(formatQuantity(1, "frasco"), "1 frasco");
  assert.equal(formatQuantity(3, "frasco"), "3 frascos");
});

test("legacy material text converts to a technical sheet with quantity 1", () => {
  const products = [
    { id: "p1", name: "Toxina botulínica" },
    { id: "p2", name: "Agulha" },
    { id: "p3", name: "Ácido Hialurônico" },
  ];
  assert.deepEqual(convertMaterialsText("Toxina botulinica, Agulha", products), [
    { productId: "p1", quantity: 1 },
    { productId: "p2", quantity: 1 },
  ]);
  assert.deepEqual(convertMaterialsText("ACIDO HIALURONICO, Luvas descartáveis", products), [{ productId: "p3", quantity: 1 }]);
  assert.deepEqual(convertMaterialsText("Agulha, agulha", products), [{ productId: "p2", quantity: 1 }]);
  assert.deepEqual(convertMaterialsText("Anestésico tópico", products), []);
  assert.deepEqual(convertMaterialsText("", products), []);
});

test("technical sheet is described with quantities and units", () => {
  assert.equal(describeTechnicalSheet([{ name: "Ácido hialurônico", unit: "ml", quantity: 1 }, { name: "Agulha", unit: "unidade", quantity: 2 }]), "1 ml Ácido hialurônico, 2 un Agulha");
  assert.equal(describeTechnicalSheet([]), "");
});
