import assert from "node:assert/strict";
import { test } from "node:test";
import { recurringOccurrences, addMonths, financeTotals, periodRange, splitInstallments } from "../src/lib/finance-rules.ts";

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

test("adding months keeps the day or falls back to the last day of the month", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonths("2026-01-31", 2), "2026-03-31");
  assert.equal(addMonths("2026-11-15", 2), "2027-01-15");
  assert.equal(addMonths("2026-10-09", 0), "2026-10-09");
});

test("installments add up to the exact total with the remainder on the first", () => {
  assert.deepEqual(splitInstallments(10_000, 3, "2026-11-30"), [
    { number: 1, amountCents: 3_334, dueOn: "2026-11-30" },
    { number: 2, amountCents: 3_333, dueOn: "2026-12-30" },
    { number: 3, amountCents: 3_333, dueOn: "2027-01-30" },
  ]);
  assert.deepEqual(splitInstallments(12_345, 1, "2026-10-09"), [{ number: 1, amountCents: 12_345, dueOn: "2026-10-09" }]);
  const parts = splitInstallments(100, 7, "2026-01-31");
  assert.equal(parts.reduce((sum, part) => sum + part.amountCents, 0), 100);
  assert.deepEqual(parts.map((part) => part.dueOn), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31"]);
  assert.deepEqual(parts.map((part) => part.amountCents), [16, 14, 14, 14, 14, 14, 14]);
});

test("weekly fixed expenses repeat on the chosen weekday", () => {
  const schedule = { frequency: "weekly", weekday: 5, startsOn: "2026-10-01", endsOn: null };
  assert.deepEqual(recurringOccurrences(schedule, "2026-10-31"), ["2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30"]);
  assert.deepEqual(recurringOccurrences({ ...schedule, startsOn: "2026-10-02" }, "2026-10-09"), ["2026-10-02", "2026-10-09"]);
});

test("monthly fixed expenses fall on the last day when the month is shorter", () => {
  const schedule = { frequency: "monthly", dayOfMonth: 31, startsOn: "2027-01-15", endsOn: null };
  assert.deepEqual(recurringOccurrences(schedule, "2027-04-30"), ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
  assert.deepEqual(recurringOccurrences({ ...schedule, startsOn: "2028-02-01" }, "2028-02-29"), ["2028-02-29"]);
  assert.deepEqual(recurringOccurrences({ frequency: "monthly", dayOfMonth: 10, startsOn: "2026-10-15", endsOn: null }, "2026-12-31"), ["2026-11-10", "2026-12-10"]);
});

test("yearly fixed expenses move 29/02 to 28/02 in common years", () => {
  const schedule = { frequency: "yearly", dayOfMonth: 29, month: 2, startsOn: "2027-01-01", endsOn: null };
  assert.deepEqual(recurringOccurrences(schedule, "2029-12-31"), ["2027-02-28", "2028-02-29", "2029-02-28"]);
});

test("fixed expenses respect the end date and skip occurrences that already exist", () => {
  const schedule = { frequency: "monthly", dayOfMonth: 5, startsOn: "2026-08-01", endsOn: "2026-10-04" };
  assert.deepEqual(recurringOccurrences(schedule, "2026-12-31"), ["2026-08-05", "2026-09-05"]);
  assert.deepEqual(recurringOccurrences(schedule, "2026-12-31", ["2026-08-05"]), ["2026-09-05"]);
  assert.deepEqual(recurringOccurrences(schedule, "2026-07-31"), []);
});
