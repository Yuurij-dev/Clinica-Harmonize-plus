import assert from "node:assert/strict";
import { test } from "node:test";
import { financeTotals, periodRange } from "../src/lib/finance-rules.ts";

test("period ranges follow the clinic calendar with weeks starting on Monday", () => {
  assert.deepEqual(periodRange("today", "2026-10-09"), { start: "2026-10-09", end: "2026-10-09" });
  assert.deepEqual(periodRange("week", "2026-10-09"), { start: "2026-10-05", end: "2026-10-11" });
  assert.deepEqual(periodRange("week", "2026-10-05"), { start: "2026-10-05", end: "2026-10-11" });
  assert.deepEqual(periodRange("week", "2026-10-11"), { start: "2026-10-05", end: "2026-10-11" });
  assert.deepEqual(periodRange("month", "2026-10-09"), { start: "2026-10-01", end: "2026-10-31" });
  assert.deepEqual(periodRange("month", "2028-02-10"), { start: "2028-02-01", end: "2028-02-29" });
  assert.deepEqual(periodRange("week", "2026-12-31"), { start: "2026-12-28", end: "2027-01-03" });
});

test("finance totals use cash basis inside the period", () => {
  const range = { start: "2026-10-01", end: "2026-10-31" };
  const totals = financeTotals({
    range,
    payments: [
      { value: 500, status: "Pago", date: "2026-10-01" },
      { value: 250, status: "Pago", date: "2026-10-31" },
      { value: 999, status: "Pago", date: "2026-09-30" },
      { value: 300, status: "Pendente", date: "2026-10-15" },
    ],
    expenses: [
      { amountCents: 12_050, status: "paid", dueOn: "2026-09-20", paidOn: "2026-10-02" },
      { amountCents: 40_000, status: "paid", dueOn: "2026-10-10", paidOn: "2026-11-01" },
      { amountCents: 8_000, status: "open", dueOn: "2026-10-20", paidOn: null },
      { amountCents: 7_000, status: "open", dueOn: "2026-11-05", paidOn: null },
      { amountCents: 99_999, status: "cancelled", dueOn: "2026-10-05", paidOn: null },
    ],
  });
  assert.deepEqual(totals, {
    revenueCents: 75_000,
    receivedCents: 75_000,
    pendingReceivableCents: 30_000,
    expensesCents: 12_050,
    resultCents: 62_950,
    payableCents: 8_000,
  });
});

test("result can be negative when expenses exceed revenue", () => {
  const totals = financeTotals({
    range: { start: "2026-10-09", end: "2026-10-09" },
    payments: [],
    expenses: [{ amountCents: 1_000, status: "paid", dueOn: "2026-10-09", paidOn: "2026-10-09" }],
  });
  assert.equal(totals.resultCents, -1_000);
});
