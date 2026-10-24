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

test("cent-based calculation preserves fractional cents distribution without floating-point drift", () => {
  const result = calculateQuote(
    [{ procedureId: "filler", quantity: 3, discountCents: 1 }],
    [{ id: "filler", name: "Preenchimento", priceCents: 3_333 }],
    { laborCents: 1, facilityCents: 0, medicationCents: 0 },
  );

  assert.equal(result?.items[0].subtotalCents, 9_998);
  assert.equal(result?.subtotalCents, 9_999);
  assert.equal(result?.discountCents, 1);
  assert.equal(result?.costTotalCents, 1);
  assert.equal(result?.totalCents, 9_999);
});

test("price with cents: 349,90 x3 = 1049,70, and a fractional catalog price converts to exact cents", () => {
  // Mesma conversão de toCents em src/lib/finance.ts (não importado: o módulo puxa o Prisma e não roda nos testes node).
  const toCents = (reais) => Math.max(0, Math.round(reais * 100));
  assert.equal(toCents(349.9), 34_990);
  assert.equal(toCents(0.1 + 0.2), 30);
  const result = calculateQuote([{ procedureId: "p", quantity: 3, discountCents: 0 }], [{ id: "p", name: "P", priceCents: toCents(349.9) }], { laborCents: 0, facilityCents: 0, medicationCents: 0 });
  assert.equal(result?.totalCents, 104_970);
  // desconto de 10% sobre 1049,70 = 104,97 (em centavos inteiros)
  const discounted = calculateQuote([{ procedureId: "p", quantity: 3, discountCents: Math.round(104_970 * 0.1) }], [{ id: "p", name: "P", priceCents: 34_990 }], { laborCents: 0, facilityCents: 0, medicationCents: 0 });
  assert.equal(discounted?.totalCents, 94_473);
  assert.equal(calculateQuote([{ procedureId: "p", quantity: 1, discountCents: 34_991 }], [{ id: "p", name: "P", priceCents: 34_990 }], { laborCents: 0, facilityCents: 0, medicationCents: 0 }), null);
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
