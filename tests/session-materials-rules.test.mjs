import assert from "node:assert/strict";
import { test } from "node:test";
import { adjustLotAllocations, suggestSessionMaterials, uncoveredQuantity } from "../src/lib/session-materials-rules.ts";

const item = (productId, quantity, extra = {}) => ({ productId, name: productId, kind: "material", unit: "unidade", quantity, ...extra });

test("multiplies the sheet by the quote quantity and sums repeated products across procedures", () => {
  const sheets = [
    { procedureId: "a", items: [item("seringa", 1), item("toxina", 2.5, { unit: "ml", kind: "produto" })] },
    { procedureId: "b", items: [item("seringa", 2)] },
  ];
  const result = suggestSessionMaterials(sheets, [{ procedureId: "a", quantity: 2 }, { procedureId: "b", quantity: 1 }]);
  assert.deepEqual(result.map((row) => [row.productId, row.quantity]), [["seringa", 4], ["toxina", 5]]);
  assert.deepEqual(result[0].procedureIds, ["a", "b"]);
});

test("ignores archived products, procedures outside the quote and invalid quantities", () => {
  const sheets = [
    { procedureId: "a", items: [item("x", 1, { archived: true }), item("y", 0), item("z", Number.NaN), item("ok", 1)] },
    { procedureId: "fora", items: [item("fora", 1)] },
    { procedureId: "vazia", items: [] },
  ];
  assert.deepEqual(suggestSessionMaterials(sheets, [{ procedureId: "a" }, { procedureId: "vazia", quantity: 3 }]).map((row) => row.productId), ["ok"]);
  assert.deepEqual(suggestSessionMaterials([], []), []);
});

test("keeps up to 3 decimals for ml and rounds other units up", () => {
  const sheets = [{ procedureId: "a", items: [item("ml", 0.1, { unit: "ml" }), item("un", 1.2)] }];
  const result = suggestSessionMaterials(sheets, [{ procedureId: "a", quantity: 3 }]);
  assert.equal(result.find((row) => row.productId === "ml").quantity, 0.3);
  assert.equal(result.find((row) => row.productId === "un").quantity, 4);
});

test("caps the quantity at 10000 and treats a missing quote quantity as 1", () => {
  const sheets = [{ procedureId: "a", items: [item("big", 6000)] }];
  assert.equal(suggestSessionMaterials(sheets, [{ procedureId: "a", quantity: 2 }])[0].quantity, 10000);
  assert.equal(suggestSessionMaterials(sheets, [{ procedureId: "a" }])[0].quantity, 6000);
});

test("orders materials before products, then by name", () => {
  const sheets = [{ procedureId: "a", items: [item("b", 1, { name: "Zeta", kind: "produto" }), item("c", 1, { name: "Beta" }), item("d", 1, { name: "Álcool" }), item("e", 1, { name: "Alfa", kind: "produto" })] }];
  assert.deepEqual(suggestSessionMaterials(sheets, [{ procedureId: "a", quantity: 1 }]).map((row) => row.name), ["Álcool", "Beta", "Alfa", "Zeta"]);
});

test("limits the list to 40 products", () => {
  const items = Array.from({ length: 45 }, (_, index) => item(`p${String(index).padStart(2, "0")}`, 1));
  assert.equal(suggestSessionMaterials([{ procedureId: "a", items }], [{ procedureId: "a" }]).length, 40);
});

const lots = [
  { id: "l2", code: "L2", expiresOn: "2027-06-01", balance: 10 },
  { id: "l1", code: "L1", expiresOn: "2027-01-01", balance: 3 },
];

test("raising the quantity extends the lots by expiry using the remaining balance", () => {
  const first = adjustLotAllocations([], 2, lots);
  assert.deepEqual(first.allocations.map((a) => [a.lotId, a.quantity]), [["l1", 2]]);
  const grown = adjustLotAllocations(first.allocations, 5, lots);
  assert.deepEqual(grown.allocations.map((a) => [a.lotId, a.quantity]), [["l1", 3], ["l2", 2]]);
  assert.equal(grown.missing, 0);
  assert.equal(grown.allocations[1].code, "L2");
});

test("reports what the lots cannot cover and shrinks from the end", () => {
  const full = adjustLotAllocations([], 20, lots);
  assert.equal(full.missing, 7);
  assert.equal(uncoveredQuantity(20, full.allocations), 7);
  const shrunk = adjustLotAllocations(full.allocations, 4, lots);
  assert.deepEqual(shrunk.allocations.map((a) => [a.lotId, a.quantity]), [["l1", 3], ["l2", 1]]);
  assert.deepEqual(adjustLotAllocations(full.allocations, 0, lots), { allocations: [], missing: 0 });
  assert.equal(uncoveredQuantity(1, [{ quantity: 1 }]), 0);
});
