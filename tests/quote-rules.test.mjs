import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateQuote, formatMoneyInput, parseMoneyInput } from "../src/lib/quote-rules.ts";

const catalog = [{ id: "filler", name: "Preenchimento", priceCents: 120_000 }];
const costs = { laborCents: 10_000, facilityCents: 5_000, medicationCents: 2_000 };

test("quote totals use catalog prices, quantity, discount, and clinic costs", () => {
  assert.deepEqual(calculateQuote([{ procedureId: "filler", quantity: 2, discountCents: 5_000 }], catalog, costs), {
    items: [{ procedureId: "filler", name: "Preenchimento", quantity: 2, unitPriceCents: 120_000, discountCents: 5_000, subtotalCents: 235_000 }],
    subtotalCents: 240_000,
    discountCents: 5_000,
    costTotalCents: 17_000,
    totalCents: 252_000,
  });
});

test("quote calculation rejects unknown, duplicate, invalid quantity, and excessive discounts", () => {
  assert.equal(calculateQuote([{ procedureId: "missing", quantity: 1, discountCents: 0 }], catalog, costs), null);
  assert.equal(calculateQuote([{ procedureId: "filler", quantity: 1, discountCents: 1 }, { procedureId: "filler", quantity: 1, discountCents: 0 }], catalog, costs), null);
  assert.equal(calculateQuote([{ procedureId: "filler", quantity: 0, discountCents: 0 }], catalog, costs), null);
  assert.equal(calculateQuote([{ procedureId: "filler", quantity: 1, discountCents: 120_001 }], catalog, costs), null);
});

test("Brazilian money input preserves cents and accepts common decimal separators", () => {
  assert.equal(parseMoneyInput("1.234,56"), 123_456);
  assert.equal(parseMoneyInput("1234.56"), 123_456);
  assert.equal(parseMoneyInput("12,5"), 1_250);
  assert.equal(parseMoneyInput("12."), 1_200);
  assert.equal(parseMoneyInput(""), 0);
  assert.equal(parseMoneyInput("12,345"), null);
  assert.equal(parseMoneyInput("R$ 1.234,56"), 123_456);
  assert.equal(formatMoneyInput(123_456), "1.234,56");
});
