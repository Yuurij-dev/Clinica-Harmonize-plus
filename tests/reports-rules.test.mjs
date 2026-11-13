import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INACTIVE_DAYS, alignSeries, averageTicket, comparisonRange, bucketIndex, changePct, changePp, clientStats, consumptionStats, cumulativeSeries, defaultGranularity, doneInRange, financeSummary,
  isDoneStatus, isQuoteExpired, previousReportRange, procedureStats, professionalStats, quoteStats, reportBuckets, resolveReportRange, returnRate, sumByBucket, tableDistribution, weekdayCounts,
} from "../src/lib/reports-rules.ts";

const today = "2026-11-12";
const ok = (input) => { const r = resolveReportRange(input, today); assert.ok(r.ok, r.message); return r.range; };

test("presets are resolved in the clinic calendar", () => {
  assert.deepEqual(ok({ period: "today" }), { period: "today", start: today, end: today, days: 1 });
  assert.equal(ok({ period: "last7" }).start, "2026-11-06");
  assert.equal(ok({ period: "last30" }).start, "2026-10-14");
  assert.deepEqual(ok({}).period, "last30");
  assert.deepEqual(ok({ period: "month" }), { period: "month", start: "2026-11-01", end: today, days: 12 });
  assert.deepEqual(ok({ period: "prevMonth" }), { period: "prevMonth", start: "2026-10-01", end: "2026-10-31", days: 31 });
  assert.equal(ok({ period: "year" }).start, "2026-01-01");
  assert.equal(resolveReportRange({ period: "prevMonth" }, "2026-01-15").range.start, "2025-12-01");
  assert.equal(resolveReportRange({ period: "prevMonth" }, "2024-03-10").range.end, "2024-02-29");
});

test("custom range validates dates, order and max 366 days", () => {
  assert.deepEqual(ok({ from: "2026-01-01", to: "2026-01-31" }).days, 31);
  assert.equal(resolveReportRange({ period: "custom", from: "2026-02-30", to: "2026-03-01" }, today).ok, false);
  assert.equal(resolveReportRange({ from: "2026-02-10", to: "2026-02-01" }, today).ok, false);
  assert.equal(resolveReportRange({ from: "2026-01-01" }, today).ok, false);
  assert.equal(resolveReportRange({ period: "bogus" }, today).ok, false);
  assert.equal(resolveReportRange({ from: "2025-01-01", to: "2025-12-31" }, today).ok, true);
  assert.equal(resolveReportRange({ from: "2025-01-01", to: "2026-01-02" }, today).ok, false);
});

test("previous range has the same length right before the start", () => {
  assert.deepEqual(previousReportRange({ start: "2026-11-01", end: "2026-11-12" }), { start: "2026-10-20", end: "2026-10-31" });
  assert.deepEqual(previousReportRange({ start: "2026-11-12", end: "2026-11-12" }), { start: "2026-11-11", end: "2026-11-11" });
});

test("variation: null when previous is zero, pp for rates", () => {
  assert.equal(changePct(150, 100), 50);
  assert.equal(changePct(50, 100), -50);
  assert.equal(changePct(10, 0), null);
  assert.equal(changePct(null, 10), null);
  assert.equal(changePp(40, 25), 15);
  assert.equal(changePp(null, 25), null);
});

test("default granularity follows period size", () => {
  assert.equal(defaultGranularity(31), "day");
  assert.equal(defaultGranularity(32), "week");
  assert.equal(defaultGranularity(120), "week");
  assert.equal(defaultGranularity(121), "month");
});

test("buckets: day, 7-day blocks and clipped months; alignment by position", () => {
  const range = { start: "2026-10-20", end: "2026-11-12" };
  assert.equal(reportBuckets(range, "day").length, 24);
  const weeks = reportBuckets(range, "week");
  assert.deepEqual(weeks.map((b) => [b.start, b.end]), [["2026-10-20", "2026-10-26"], ["2026-10-27", "2026-11-02"], ["2026-11-03", "2026-11-09"], ["2026-11-10", "2026-11-12"]]);
  const months = reportBuckets(range, "month");
  assert.deepEqual(months.map((b) => [b.key, b.start, b.end]), [["2026-10", "2026-10-20", "2026-10-31"], ["2026-11", "2026-11-01", "2026-11-12"]]);
  assert.equal(bucketIndex(weeks, "2026-11-02"), 1);
  assert.equal(bucketIndex(weeks, "2026-11-13"), -1);
  assert.deepEqual(sumByBucket(weeks, [{ day: "2026-10-20", value: 2 }, { day: "2026-11-11", value: 5 }, { day: "2027-01-01", value: 9 }]), [2, 0, 0, 5]);
  const aligned = alignSeries(weeks, [1, 2, 3, 4], [9, 8]);
  assert.deepEqual(aligned.map((p) => p.previous), [9, 8, null, null]);
  assert.deepEqual(alignSeries(weeks, [1, 2, 3, 4], null).map((p) => p.previous), [null, null, null, null]);
});

test("only Atendido/Finalizado count as done", () => {
  for (const status of ["Atendido", "Finalizado"]) assert.equal(isDoneStatus(status), true);
  for (const status of ["Agendado", "Em atendimento", "Faltou", "Cancelado", ""]) assert.equal(isDoneStatus(status), false);
  const rows = ["Agendado", "Em atendimento", "Faltou", "Cancelado", "Atendido", "Finalizado"].map((status) => ({ day: "2026-11-01", patientId: "p", procedure: "X", professional: "A", status }));
  assert.equal(doneInRange(rows, { start: "2026-11-01", end: "2026-11-30" }).length, 2);
  assert.equal(doneInRange(rows, { start: "2026-12-01", end: "2026-12-30" }).length, 0);
});

test("return rate and average ticket", () => {
  assert.deepEqual(returnRate(["a", "b", "b", "c", "d"], new Set(["a", "c", "z"])), { value: 50, returning: 2, total: 4 });
  assert.equal(returnRate([], new Set(["a"])).value, null);
  assert.equal(averageTicket(10_000, 4), 2500);
  assert.equal(averageTicket(10_000, 0), null);
  assert.equal(averageTicket(null, 4), null);
});

const row = (day, patientId, procedure, professional, status = "Atendido") => ({ day, patientId, procedure, professional, status });
const catalog = [{ name: "Botox", priceCents: 100_000, materialCostCents: 20_000 }, { name: "Peeling", priceCents: 30_000, materialCostCents: null }];

test("procedure stats: table value, share, cost and margin only with technical sheet", () => {
  const done = [row("d", "1", "Botox", "A"), row("d", "2", "Botox", "A"), row("d", "3", "Peeling", "B"), row("d", "4", "Antigo", "B")];
  const stats = procedureStats(done, catalog);
  assert.equal(stats.totalExecutions, 4);
  assert.equal(stats.tableTotalCents, 230_000);
  const [botox, old, peeling] = stats.rows;
  assert.equal(botox.name, "Botox");
  assert.equal(botox.tableValueCents, 200_000);
  assert.equal(botox.materialCostCents, 40_000);
  assert.equal(botox.marginCents, 160_000);
  assert.equal(botox.marginPct, 80);
  assert.equal(peeling.materialCostCents, null);
  assert.equal(peeling.marginCents, null);
  assert.equal(old.matched, false);
  assert.equal(old.tableValueCents, null);
  assert.equal(old.tableSharePct, null);
  assert.ok(Math.abs(botox.tableSharePct - (200_000 / 230_000) * 100) < 1e-9);
});

test("table distribution: top 5 plus Others", () => {
  const rows = [10, 9, 8, 7, 6, 5, 4].map((v, i) => ({ name: `P${i}`, tableValueCents: v * 100 }));
  rows.push({ name: "SemPreco", tableValueCents: null });
  const { distribution, totalCents } = tableDistribution(rows);
  assert.equal(totalCents, 4900);
  assert.equal(distribution.length, 6);
  assert.equal(distribution[5].name, "Outros");
  assert.equal(distribution[5].valueCents, 900);
  assert.ok(Math.abs(distribution.reduce((s, d) => s + d.pct, 0) - 100) < 1e-9);
  assert.deepEqual(tableDistribution(rows.slice(0, 3)).distribution.map((d) => d.name), ["P0", "P1", "P2"]);
  assert.deepEqual(tableDistribution([]), { distribution: [], totalCents: 0 });
});

test("professional stats: cancellation rate ignores open appointments", () => {
  const rows = [row("d", "1", "Botox", "Ana"), row("d", "2", "Botox", "Ana"), row("d", "3", "Botox", "Ana", "Cancelado"), row("d", "4", "Botox", "Ana", "Faltou"), row("d", "5", "Botox", "Ana", "Agendado"), row("d", "6", "Peeling", "Bia", "Em atendimento")];
  const stats = professionalStats(rows, catalog);
  assert.equal(stats.length, 1);
  assert.deepEqual([stats[0].name, stats[0].done, stats[0].cancelled, stats[0].missed], ["Ana", 2, 1, 1]);
  assert.equal(stats[0].cancellationRatePct, 25);
  assert.equal(stats[0].tableValueCents, 200_000);
  assert.equal(stats[0].tableTicketCents, 100_000);
});

test("client stats: recurring, inactive (90 days) and frequency", () => {
  const range = { start: "2026-11-01", end: "2026-11-30" };
  const periodDone = [row("2026-11-03", "a", "x", "A"), row("2026-11-04", "a", "x", "A"), row("2026-11-05", "b", "x", "A")];
  const cumulative = [
    { patientId: "a", doneCount: 5, lastDay: "2026-11-04" },
    { patientId: "b", doneCount: 1, lastDay: "2026-11-05" },
    { patientId: "old", doneCount: 3, lastDay: "2026-08-04" },
    { patientId: "edge", doneCount: 1, lastDay: "2026-08-14" }, // 90 dias antes de 12/11 -> inativo
    { patientId: "ok", doneCount: 1, lastDay: "2026-08-15" }, // 89 dias -> ativo
  ];
  const stats = clientStats({ range, today: "2026-11-12", periodDone, cumulative, priorPatientIds: new Set(["a"]), newPatients: 2 });
  assert.equal(stats.recurring, 1);
  assert.equal(stats.inactive, 2);
  assert.equal(stats.inactiveDays, INACTIVE_DAYS);
  assert.equal(stats.averageFrequency, 1.5);
  assert.equal(stats.returnRate.value, 50);
  assert.equal(clientStats({ range, today: "2026-11-12", periodDone: [], cumulative: [], priorPatientIds: new Set(), newPatients: 0 }).averageFrequency, null);
});

test("patient base evolution accumulates from the base count", () => {
  const buckets = reportBuckets({ start: "2026-11-01", end: "2026-11-14" }, "week");
  const points = cumulativeSeries(buckets, 100, ["2026-11-02", "2026-11-09", "2026-11-10", "2026-10-31"]);
  assert.deepEqual(points.map((p) => [p.newPatients, p.totalPatients]), [[1, 101], [2, 103]]);
});

const quote = (over) => ({ status: "Pendente", totalCents: 1000, createdDay: "2026-11-02", sentDay: null, approvedDay: null, refusedDay: null, expiresDay: null, createdAtMs: Date.parse("2026-11-02T12:00:00Z"), sentAtMs: null, approvedAtMs: null, ...over });

test("quote stats: cohort conversion, approved value, expiry and average time", () => {
  const range = { start: "2026-11-01", end: "2026-11-30" };
  const quotes = [
    quote({ status: "Aprovado", totalCents: 5000, approvedDay: "2026-11-04", approvedAtMs: Date.parse("2026-11-04T12:00:00Z") }),
    quote({ status: "Pago", totalCents: 3000, createdDay: "2026-10-20", approvedDay: "2026-11-05", sentAtMs: Date.parse("2026-11-03T12:00:00Z"), approvedAtMs: Date.parse("2026-11-05T12:00:00Z") }),
    quote({ status: "Recusado", refusedDay: "2026-11-06" }),
    quote({ status: "Enviado", expiresDay: "2026-11-10" }),
    quote({ status: "Enviado", expiresDay: "2026-11-20" }),
    quote({ status: "Cancelado", expiresDay: "2026-11-10" }),
  ];
  const stats = quoteStats(quotes, range, "2026-11-12");
  assert.equal(stats.created, 5);
  assert.equal(stats.approved, 2);
  assert.equal(stats.refused, 1);
  assert.equal(stats.expired, 1);
  assert.equal(stats.approvedValueCents, 8000);
  assert.equal(stats.conversionPct, 20);
  assert.equal(stats.averageApprovalDays, 2);
  assert.equal(isQuoteExpired({ status: "Rascunho", expiresDay: "2026-11-11" }, "2026-11-12"), true);
  assert.equal(isQuoteExpired({ status: "Aprovado", expiresDay: "2026-11-11" }, "2026-11-12"), false);
  const empty = quoteStats([], range, "2026-11-12");
  assert.equal(empty.conversionPct, null);
  assert.equal(empty.averageApprovalDays, null);
});

test("finance summary and weekday counts", () => {
  assert.deepEqual(financeSummary(10_000, 4_000), { revenueCents: 10_000, expensesCents: 4_000, resultCents: 6_000, marginPct: 60 });
  assert.equal(financeSummary(0, 500).marginPct, null);
  assert.deepEqual(weekdayCounts([row("2026-11-09", "a", "x", "A"), row("2026-11-09", "b", "x", "A"), row("2026-11-15", "c", "x", "A")]), [1, 2, 0, 0, 0, 0, 0]);
});

test("consumption stats by product, procedure (done appointments only) and bucket", () => {
  const buckets = reportBuckets({ start: "2026-11-01", end: "2026-11-02" }, "day");
  const rows = [
    { productId: "p1", productName: "Ácido", unit: "ml", costCents: 1000, quantity: 2, day: "2026-11-01", appointmentProcedure: "Botox", appointmentDone: true },
    { productId: "p1", productName: "Ácido", unit: "ml", costCents: 1000, quantity: 1, day: "2026-11-02", appointmentProcedure: "Botox", appointmentDone: false },
    { productId: "p2", productName: "Agulha", unit: "un", costCents: 50, quantity: 4, day: "2026-11-02", appointmentProcedure: null, appointmentDone: false },
  ];
  const stats = consumptionStats(rows, buckets);
  assert.equal(stats.totalEstimatedCostCents, 3200);
  assert.deepEqual(stats.byProduct.map((p) => [p.name, p.quantity, p.estimatedCostCents]), [["Ácido", 3, 3000], ["Agulha", 4, 200]]);
  assert.deepEqual(stats.byProcedure, [{ name: "Botox", movements: 1, missingCostMovements: 0, costKnown: true, estimatedCostCents: 2000 }]);
  assert.equal(stats.movementsWithoutCost, 0);
  assert.deepEqual(stats.series.map((s) => s.estimatedCostCents), [2000, 1200]);
});

test("consumption stats: item without registered cost (costCents 0) is unknown, never R$ 0,00", () => {
  const buckets = reportBuckets({ start: "2026-11-01", end: "2026-11-02" }, "day");
  const base = { unit: "un", day: "2026-11-01", appointmentProcedure: "Botox", appointmentDone: true };
  const mixed = consumptionStats([
    { ...base, productId: "a", productName: "Ácido", costCents: 1000, quantity: 2 },
    { ...base, productId: "n", productName: "Agulha", costCents: 0, quantity: 4 },
  ], buckets);
  assert.deepEqual(mixed.byProduct.map((p) => [p.name, p.costKnown, p.estimatedCostCents]), [["Ácido", true, 2000], ["Agulha", false, null]]); // desconhecido por último
  assert.deepEqual(mixed.byProcedure, [{ name: "Botox", movements: 2, missingCostMovements: 1, costKnown: true, estimatedCostCents: 2000 }]);
  assert.equal(mixed.totalEstimatedCostCents, 2000); // soma só o conhecido
  assert.equal(mixed.movementsWithoutCost, 1);
  const onlyUnknown = consumptionStats([{ ...base, productId: "n", productName: "Agulha", costCents: 0, quantity: 4 }], buckets);
  assert.equal(onlyUnknown.totalEstimatedCostCents, null);
  assert.deepEqual(onlyUnknown.byProcedure.map((p) => [p.costKnown, p.estimatedCostCents]), [[false, null]]);
  assert.equal(consumptionStats([], buckets).totalEstimatedCostCents, 0); // sem consumo é zero real
});

test("procedure stats: cost reason distinguishes no technical sheet from an item without cost", () => {
  const catalogReasons = [
    { name: "Botox", priceCents: 100, materialCostCents: 20, materialCostReason: null },
    { name: "Peeling", priceCents: 100, materialCostCents: null, materialCostReason: "no_sheet" },
    { name: "Laser", priceCents: 100, materialCostCents: null, materialCostReason: "item_without_cost" },
  ];
  const done = ["Botox", "Peeling", "Laser", "Outro"].map((name, index) => row("d", String(index), name, "A"));
  const byName = Object.fromEntries(procedureStats(done, catalogReasons).rows.map((r) => [r.name, r]));
  assert.deepEqual([byName.Botox.costKnown, byName.Botox.materialCostReason], [true, null]);
  assert.deepEqual([byName.Peeling.costKnown, byName.Peeling.materialCostReason, byName.Peeling.marginCents], [false, "no_sheet", null]);
  assert.deepEqual([byName.Laser.costKnown, byName.Laser.materialCostReason, byName.Laser.marginCents], [false, "item_without_cost", null]);
  assert.deepEqual([byName.Outro.costKnown, byName.Outro.materialCostReason], [false, "no_sheet"]);
});

test("changePct divides by the absolute previous value", () => {
  assert.equal(changePct(50, -100), 150);
  assert.equal(changePct(-150, -100), -50);
});

test("custom dates are limited to years 2000-2100 and comparison drops out of range", () => {
  assert.equal(resolveReportRange({ from: "1999-12-31", to: "2000-01-10" }, today).ok, false);
  assert.equal(resolveReportRange({ from: "2100-12-01", to: "2101-01-01" }, today).ok, false);
  assert.equal(resolveReportRange({ from: "2000-01-01", to: "2000-01-10" }, today).ok, true);
  assert.equal(comparisonRange({ start: "2000-01-01", end: "2000-01-10" }), null);
  assert.deepEqual(comparisonRange({ start: "2000-01-11", end: "2000-01-20" }), { start: "2000-01-01", end: "2000-01-10" });
  assert.equal(comparisonRange({ start: "2026-11-01", end: "2026-11-12" }).start, "2026-10-20");
});

test("quote expiring today is not expired; expiring yesterday is", () => {
  assert.equal(isQuoteExpired({ status: "Pendente", expiresDay: "2026-11-12" }, "2026-11-12"), false);
  assert.equal(isQuoteExpired({ status: "Pendente", expiresDay: "2026-11-11" }, "2026-11-12"), true);
});

test("professional stats: execution of a procedure without price is unknown, not R$ 0,00 (partial value, ticket over priced ones)", async () => {
  const { executionSeries } = await import("../src/lib/reports-extra-rules.ts");
  const cat = [{ name: "Botox", priceCents: 100_000, materialCostCents: null }];
  const rows = [row("2026-11-02", "1", "Botox", "Ana"), row("2026-11-02", "2", "Antigo", "Ana"), row("2026-11-03", "3", "Antigo", "Bia"), row("2026-11-03", "4", "Antigo", "Bia")];
  const byName = Object.fromEntries(professionalStats(rows, cat).map((r) => [r.name, r]));
  assert.deepEqual([byName.Ana.tableValueCents, byName.Ana.unpricedExecutions, byName.Ana.tableTicketCents], [100_000, 1, 100_000]); // parcial; ticket só das com preço
  assert.deepEqual([byName.Bia.tableValueCents, byName.Bia.unpricedExecutions, byName.Bia.tableTicketCents], [null, 2, null]); // todas sem preço
  const nobody = professionalStats([row("2026-11-02", "1", "Botox", "Cai", "Faltou")], cat)[0];
  assert.deepEqual([nobody.tableValueCents, nobody.tableTicketCents], [0, null]); // sem execuções: zero real
  const series = executionSeries({ rows, catalog: cat, range: { start: "2026-11-02", end: "2026-11-03" }, previous: null, granularity: "day" });
  assert.deepEqual(series.unpriced.map((p) => p.current), [1, 2]);
  assert.deepEqual(series.executions.map((p) => p.current), [2, 2]);
  assert.deepEqual(series.tableValueCents.map((p) => p.current), [100_000, 0]); // o dia 3 só tem execuções sem preço: o documento mostra "—"
});

test("procedure stats: table total is unknown (null) when no execution has a price, partial when some do, real zero without executions", () => {
  const cat = [{ name: "Botox", priceCents: 100_000, materialCostCents: null }];
  const none = procedureStats([row("d", "1", "Antigo", "A"), row("d", "2", "Outro", "A")], cat);
  assert.deepEqual([none.tableTotalCents, none.pricedExecutions, none.totalExecutions], [null, 0, 2]);
  assert.ok(none.rows.every((r) => r.tableValueCents === null && r.tableSharePct === null));
  const partial = procedureStats([row("d", "1", "Botox", "A"), row("d", "2", "Antigo", "A")], cat);
  assert.deepEqual([partial.tableTotalCents, partial.pricedExecutions], [100_000, 1]);
  const empty = procedureStats([], cat);
  assert.deepEqual([empty.tableTotalCents, empty.pricedExecutions], [0, 0]);
});
