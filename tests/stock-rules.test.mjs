import assert from "node:assert/strict";
import { test } from "node:test";
import { stockAlerts, convertMaterialsText, manualMovement, describeTechnicalSheet, formatQuantity, lotBalance, lotStatus, materialBalance, parseQuantity, validateQuantity } from "../src/lib/stock-rules.ts";

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

test("manual movements need a note and cannot take more than the lot balance", () => {
  assert.deepEqual(manualMovement({ reason: "loss", quantity: 1, unit: "ml", lotBalance: 3, notes: "Frasco quebrou" }), { type: "manual_out", quantity: -1 });
  assert.deepEqual(manualMovement({ reason: "internal_use", quantity: 2, unit: "unidade", lotBalance: 2, notes: "Treino" }), { type: "manual_out", quantity: -2 });
  assert.deepEqual(manualMovement({ reason: "count", direction: "in", quantity: 0.5, unit: "ml", lotBalance: 0, notes: "Contagem" }), { type: "count_adjustment", quantity: 0.5 });
  assert.deepEqual(manualMovement({ reason: "count", direction: "out", quantity: 1, unit: "ml", lotBalance: 1, notes: "Contagem" }), { type: "count_adjustment", quantity: -1 });
  assert.match(manualMovement({ reason: "loss", quantity: 1, unit: "ml", lotBalance: 3, notes: "  " }).error, /observação/);
  assert.match(manualMovement({ reason: "loss", quantity: 4, unit: "ml", lotBalance: 3, notes: "x" }).error, /saldo/);
  assert.match(manualMovement({ reason: "count", direction: "out", quantity: 4, unit: "ml", lotBalance: 3, notes: "x" }).error, /saldo/);
  assert.match(manualMovement({ reason: "loss", quantity: 1.5, unit: "frasco", lotBalance: 3, notes: "x" }).error, /inteiro/);
  assert.match(manualMovement({ reason: "gift", quantity: 1, unit: "ml", lotBalance: 3, notes: "x" }).error, /Motivo/);
});

test("stock alerts flag low materials and lots close to expiry", () => {
  const materials = [
    { id: "m1", name: "Ácido hialurônico", unit: "ml", balance: 2, minStock: 5 },
    { id: "m2", name: "Agulha", unit: "unidade", balance: 10, minStock: 10 },
    { id: "m3", name: "Toxina", unit: "frasco", balance: 0, minStock: 0 },
  ];
  const lots = [
    { id: "l1", productId: "m1", productName: "Ácido hialurônico", code: "AH1", expiresOn: "2026-11-08", balance: 1 },
    { id: "l2", productId: "m1", productName: "Ácido hialurônico", code: "AH2", expiresOn: "2026-11-09", balance: 1 },
    { id: "l3", productId: "m2", productName: "Agulha", code: "AG1", expiresOn: "2026-10-01", balance: 10 },
    { id: "l4", productId: "m3", productName: "Toxina", code: "TX1", expiresOn: "2026-10-10", balance: 0 },
    { id: "l5", productId: "m2", productName: "Agulha", code: "AG2", expiresOn: "2026-10-09", balance: 3 },
  ];
  const alerts = stockAlerts({ materials, lots, today: "2026-10-09", warningDays: 30 });
  assert.deepEqual(alerts.map((alert) => [alert.kind, alert.productId, alert.lotId ?? null, alert.message]), [
    ["expired", "m2", "l3", "Lote AG1 de Agulha venceu em 01/10/2026"],
    ["expiring", "m2", "l5", "Lote AG2 de Agulha vence hoje"],
    ["expiring", "m1", "l1", "Lote AH1 de Ácido hialurônico vence em 30 dias"],
    ["below_minimum", "m1", null, "Ácido hialurônico abaixo do mínimo (2 de 5 ml)"],
  ]);
  assert.deepEqual(stockAlerts({ materials, lots, today: "2026-10-09", warningDays: 0 }).map((alert) => alert.lotId ?? alert.kind), ["l3", "l5", "below_minimum"]);
});
