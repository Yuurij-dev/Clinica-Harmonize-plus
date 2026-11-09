import assert from "node:assert/strict";
import { test } from "node:test";
import { accountStatus, expenseCategories, financeCounts, financeSeries, flowBuckets, flowWindow, isRecurringActive, mergeMovements, monthlyEquivalentCents, nextRecurringDue, previousRange, recurringCycleStart, recurringOccurrences, recurringScheduleChanged, addMonths, financeTotals, periodRange, splitInstallments } from "../src/lib/finance-rules.ts";

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
      { valueCents: 50_000, status: "Pago", date: "2026-10-01" },
      { valueCents: 25_050, status: "Pago", date: "2026-10-31" },
      { valueCents: 99_900, status: "Pago", date: "2026-09-30" },
      { valueCents: 30_000, status: "Pendente", date: "2026-10-15" },
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
    revenueCents: 75_050,
    receivedCents: 75_050,
    pendingReceivableCents: 30_000,
    expensesCents: 12_050,
    resultCents: 63_000,
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

test("stock expenses use the Estoque category", () => {
  assert.equal(expenseCategories[0], "Estoque");
  assert.equal(expenseCategories.includes("Materiais/Estoque"), false);
});

test("previous range matches the selected period type", () => {
  assert.deepEqual(previousRange("today", { start: "2026-10-01", end: "2026-10-01" }), { start: "2026-09-30", end: "2026-09-30" });
  assert.deepEqual(previousRange("week", { start: "2026-10-05", end: "2026-10-11" }), { start: "2026-09-28", end: "2026-10-04" });
  assert.deepEqual(previousRange("month", { start: "2026-03-01", end: "2026-03-31" }), { start: "2026-02-01", end: "2026-02-28" });
  assert.deepEqual(previousRange("month", { start: "2026-01-01", end: "2026-01-31" }), { start: "2025-12-01", end: "2025-12-31" });
});

test("finance counts pending receivables and payables in the period", () => {
  const range = { start: "2026-10-01", end: "2026-10-31" };
  assert.deepEqual(financeCounts({
    range,
    payments: [
      { valueCents: 1, status: "Pendente", date: "2026-10-02" },
      { valueCents: 1, status: "Parcial", date: "2026-10-03" },
      { valueCents: 1, status: "Pago", date: "2026-10-03" },
      { valueCents: 1, status: "Pendente", date: "2026-11-03" },
    ],
    expenses: [
      { amountCents: 1, status: "open", dueOn: "2026-10-10", paidOn: null },
      { amountCents: 1, status: "paid", dueOn: "2026-10-10", paidOn: "2026-10-11" },
      { amountCents: 1, status: "open", dueOn: "2026-11-10", paidOn: null },
    ],
  }), { pendingReceivable: 2, payable: 1 });
});

test("flow series buckets follow day, week (Mon-Sun) and 6-month rules", () => {
  const month = periodRange("month", "2026-10-09");
  assert.equal(flowBuckets("day", month, "2026-10-09").length, 31);
  const weeks = flowBuckets("week", month, "2026-10-09");
  assert.deepEqual(weeks.map((bucket) => bucket.start), ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
  assert.equal(weeks[4].end, "2026-11-01");
  const months = flowBuckets("month", month, "2026-02-10");
  assert.deepEqual(months.map((bucket) => bucket.key), ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.deepEqual(flowWindow("month", month, "2026-02-10"), { start: "2025-09-01", end: "2026-02-28" });
  assert.equal(months[5].label, "fev/26");
});

test("flow series uses cash basis consistent with finance totals", () => {
  const range = periodRange("week", "2026-10-09");
  const payments = [
    { valueCents: 10_000, status: "Pago", date: "2026-10-05" },
    { valueCents: 5_000, status: "Pago", date: "2026-10-05" },
    { valueCents: 7_000, status: "Pendente", date: "2026-10-06" },
    { valueCents: 3_000, status: "Pago", date: "2026-10-12" },
  ];
  const expenses = [
    { amountCents: 2_000, status: "paid", dueOn: "2026-10-01", paidOn: "2026-10-06" },
    { amountCents: 9_000, status: "open", dueOn: "2026-10-06", paidOn: null },
  ];
  const days = financeSeries({ granularity: "day", range, reference: "2026-10-09", payments, expenses });
  assert.equal(days.length, 7);
  assert.deepEqual(days[0], { key: "2026-10-05", label: "05/10", revenueCents: 15_000, expensesCents: 0 });
  assert.deepEqual(days[1], { key: "2026-10-06", label: "06/10", revenueCents: 0, expensesCents: 2_000 });
  const totals = financeTotals({ range, payments, expenses });
  assert.equal(days.reduce((sum, day) => sum + day.revenueCents, 0), totals.revenueCents);
  assert.equal(days.reduce((sum, day) => sum + day.expensesCents, 0), totals.expensesCents);
  const weeksSeries = financeSeries({ granularity: "week", range, reference: "2026-10-09", payments, expenses });
  assert.deepEqual(weeksSeries.map((week) => [week.revenueCents, week.expensesCents]), [[15_000, 2_000]]);
});

test("monthly equivalent converts weekly and yearly amounts", () => {
  assert.equal(monthlyEquivalentCents("monthly", 120_000), 120_000);
  assert.equal(monthlyEquivalentCents("weekly", 12_000), 52_000);
  assert.equal(monthlyEquivalentCents("yearly", 120_000), 10_000);
  assert.equal(monthlyEquivalentCents("yearly", 100), 8);
});

test("next recurring due date respects start, end and frequency", () => {
  const monthly = { frequency: "monthly", dayOfMonth: 10, startsOn: "2026-01-05", endsOn: null };
  assert.equal(nextRecurringDue(monthly, "2026-10-10"), "2026-10-10");
  assert.equal(nextRecurringDue(monthly, "2026-10-11"), "2026-11-10");
  assert.equal(nextRecurringDue({ ...monthly, startsOn: "2027-02-01" }, "2026-10-11"), "2027-02-10");
  assert.equal(nextRecurringDue({ ...monthly, endsOn: "2026-10-09" }, "2026-10-10"), null);
  assert.equal(nextRecurringDue({ ...monthly, endsOn: "2026-10-31" }, "2026-10-11"), null);
  assert.equal(nextRecurringDue({ frequency: "weekly", weekday: 1, startsOn: "2026-01-01", endsOn: null }, "2026-10-09"), "2026-10-12");
  assert.equal(nextRecurringDue({ frequency: "yearly", dayOfMonth: 29, month: 2, startsOn: "2026-01-01", endsOn: null }, "2026-10-09"), "2027-02-28");
  assert.equal(isRecurringActive(null, "2026-10-09"), true);
  assert.equal(isRecurringActive("2026-10-09", "2026-10-09"), true);
  assert.equal(isRecurringActive("2026-10-08", "2026-10-09"), false);
});

test("account status marks overdue only when open and before today", () => {
  assert.equal(accountStatus(true, "2026-01-01", "2026-10-09"), "settled");
  assert.equal(accountStatus(false, "2026-10-08", "2026-10-09"), "overdue");
  assert.equal(accountStatus(false, "2026-10-09", "2026-10-09"), "open");
  assert.equal(accountStatus(false, "2026-10-10", "2026-10-09"), "open");
});

test("schedule change detection ignores identical schedules", () => {
  const base = { frequency: "monthly", weekday: null, dayOfMonth: 10, month: null };
  assert.equal(recurringScheduleChanged(base, { ...base }), false);
  assert.equal(recurringScheduleChanged(base, { ...base, dayOfMonth: 15 }), true);
  assert.equal(recurringScheduleChanged(base, { frequency: "weekly", weekday: 1, dayOfMonth: null, month: null }), true);
});

test("merged movements keep date order and page across both lists", () => {
  const revenues = [{ kind: "revenue", date: "2026-10-09", id: "r1" }, { kind: "revenue", date: "2026-10-05", id: "r2" }];
  const expenses = [{ kind: "expense", date: "2026-10-09", id: "e1" }, { kind: "expense", date: "2026-10-07", id: "e2" }, { kind: "expense", date: "2026-10-01", id: "e3" }];
  assert.deepEqual(mergeMovements(revenues, expenses, "desc", 0, 10).map((item) => item.id), ["r1", "e1", "e2", "r2", "e3"]);
  assert.deepEqual(mergeMovements(revenues, expenses, "desc", 2, 2).map((item) => item.id), ["e2", "r2"]);
  const ascRevenues = [...revenues].reverse();
  const ascExpenses = [...expenses].reverse();
  assert.deepEqual(mergeMovements(ascRevenues, ascExpenses, "asc", 0, 3).map((item) => item.id), ["e3", "r2", "e2"]);
  assert.deepEqual(mergeMovements([], expenses, "desc", 1, 1).map((item) => item.id), ["e2"]);
  assert.deepEqual(mergeMovements(revenues, expenses, "desc", 10, 5), []);
});

test("schedule change generates at most one occurrence per cycle and never backfills", () => {
  // Mensal: início movido para hoje (20/10); o mês corrente já tem a ocorrência do dia 10 (paga ou vencida).
  const monthly = { frequency: "monthly", dayOfMonth: 25, startsOn: "2026-10-20", endsOn: null };
  assert.deepEqual(recurringOccurrences(monthly, "2026-10-31", ["2026-08-10", "2026-09-10", "2026-10-10"]), []);
  assert.deepEqual(recurringOccurrences(monthly, "2026-11-30", ["2026-08-10", "2026-09-10", "2026-10-10"]), ["2026-11-25"]);
  // Sem ocorrência no mês corrente, a nova data de hoje em diante é gerada.
  assert.deepEqual(recurringOccurrences(monthly, "2026-10-31", ["2026-09-10"]), ["2026-10-25"]);
  // Semanal: a segunda (12/10) já existe na semana seg–dom de 12 a 18/10; sexta 16/10 não duplica.
  const weekly = { frequency: "weekly", weekday: 5, startsOn: "2026-10-14", endsOn: null };
  assert.deepEqual(recurringOccurrences(weekly, "2026-10-31", ["2026-10-12"]), ["2026-10-23", "2026-10-30"]);
  // Anual: o ano de 2026 já tem ocorrência em março; a nova data (junho) só vale a partir de 2027.
  const yearly = { frequency: "yearly", dayOfMonth: 10, month: 6, startsOn: "2026-03-01", endsOn: null };
  assert.deepEqual(recurringOccurrences(yearly, "2027-12-31", ["2026-03-20"]), ["2027-06-10"]);
});

test("one occurrence per cycle keeps normal generation unchanged", () => {
  const monthly = { frequency: "monthly", dayOfMonth: 31, startsOn: "2026-01-15", endsOn: null };
  assert.deepEqual(recurringOccurrences(monthly, "2026-03-31", []), ["2026-01-31", "2026-02-28", "2026-03-31"]);
  assert.deepEqual(recurringOccurrences(monthly, "2026-03-31", ["2026-01-31", "2026-02-28"]), ["2026-03-31"]);
  const weekly = { frequency: "weekly", weekday: 0, startsOn: "2026-10-05", endsOn: null };
  assert.deepEqual(recurringOccurrences(weekly, "2026-10-25", ["2026-10-11"]), ["2026-10-18", "2026-10-25"]);
});

test("cycle start moves the schedule start so the current cycle gets the new date", () => {
  assert.equal(recurringCycleStart("monthly", "2026-10-12"), "2026-10-01");
  assert.equal(recurringCycleStart("yearly", "2026-10-12"), "2026-01-01");
  assert.equal(recurringCycleStart("weekly", "2026-10-14"), "2026-10-12");
  // Hoje 12/10, mês corrente sem ocorrência e dia novo 5: gera 05/10 (já passou), sem tocar em meses anteriores.
  const monthly = { frequency: "monthly", dayOfMonth: 5, startsOn: recurringCycleStart("monthly", "2026-10-12"), endsOn: null };
  assert.deepEqual(recurringOccurrences(monthly, "2026-10-31", []), ["2026-10-05"]);
  // Se o mês já tem ocorrência (paga, cancelada ou vencida), não duplica.
  assert.deepEqual(recurringOccurrences(monthly, "2026-10-31", ["2026-10-20"]), []);
  const weekly = { frequency: "weekly", weekday: 1, startsOn: recurringCycleStart("weekly", "2026-10-14"), endsOn: null };
  assert.deepEqual(recurringOccurrences(weekly, "2026-10-18", []), ["2026-10-12"]);
  const yearly = { frequency: "yearly", dayOfMonth: 5, month: 3, startsOn: recurringCycleStart("yearly", "2026-10-12"), endsOn: null };
  assert.deepEqual(recurringOccurrences(yearly, "2026-12-31", []), ["2026-03-05"]);
});
