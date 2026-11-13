import assert from "node:assert/strict";
import { test } from "node:test";
import { appointmentStats, quoteFunnel, visitDistribution, procedureProfessionals, professionalExtras } from "../src/lib/reports-extra-rules.ts";
import { cellDisplay, isUnknown } from "../src/lib/reports-document.ts";
import {
  buildAllDocument, buildAppointmentsDocument, buildClientsDocument, buildFinanceDocument, buildOverviewDocument, buildProceduresDocument, buildProfessionalsDocument, buildQuotesDocument, buildStockDocument,
} from "../src/lib/reports-documents/index.ts";
import { stockPosition, summarizeMovements } from "../src/lib/reports-stock-rules.ts";

const input = { clinicName: "Clínica Ação", range: { start: "2026-11-01", end: "2026-11-07" }, previous: null, professional: null, granularityLabel: "Diário", generatedAt: "2026-11-13T13:00:00.000Z" };
const section = (doc, id) => doc.sections.find((item) => item.id === id);
const cellsOf = (tableSection) => tableSection.rows.map((item) => item.cells);
const point = (label, current, previous = null) => ({ label, date: label, current, previous });

// Nenhuma chave/valor de documento pode identificar paciente.
function assertNoPatientData(doc) {
  const text = JSON.stringify(doc);
  for (const forbidden of ["cpf", "phone", "telefone", "email", "e-mail", "patientName", "patientId", "birthDate", "socialName"]) assert.ok(!new RegExp(`"${forbidden}"`, "i").test(text), `chave proibida: ${forbidden}`);
  assert.ok(!/@/.test(text), "sem e-mail");
}

// ---------- Agendamentos ----------

const row = (day, patientId, procedure, professional, status) => ({ day, patientId, procedure, professional, status });
const appointmentRows = [
  row("2026-11-02", "p1", "Botox", "Dra. Ana", "Atendido"),
  row("2026-11-02", "p2", "Botox", "Dra. Ana", "Finalizado"),
  row("2026-11-03", "p1", "Peeling", "Dra. Bia", "Faltou"),
  row("2026-11-03", "p3", "Botox", "Dra. Ana", "Cancelado"),
  row("2026-11-04", "p4", "Botox", "Dra. Ana", "Agendado"),
  row("2026-11-06", "p5", "Botox", "Dra. Bia", "Agendado"),
  row("2026-11-06", "p6", "Botox", "Dra. Bia", "Em atendimento"),
  row("2026-10-30", "p7", "Botox", "Dra. Bia", "Atendido"), // fora do período
];

test("appointmentStats: status buckets, rates (attendance excludes cancellations) and breakdowns", () => {
  const stats = appointmentStats({ rows: appointmentRows, range: input.range, previous: null, granularity: "day", today: "2026-11-05" });
  const t = stats.totals;
  assert.deepEqual([t.total, t.done, t.cancelled, t.missed, t.scheduled, t.inProgress, t.pending, t.overdueOpen, t.other], [7, 2, 1, 1, 2, 1, 3, 1, 0]);
  assert.ok(Math.abs(t.attendanceRatePct - 200 / 3) < 1e-9); // 2 ÷ (2 + 1 falta)
  assert.ok(Math.abs(t.cancellationRatePct - 100 / 7) < 1e-9); // 1 ÷ 7 total
  assert.equal(stats.previous, null);
  const ana = stats.byProfessional.find((item) => item.name === "Dra. Ana");
  assert.deepEqual([ana.total, ana.done, ana.cancelled, ana.pending], [4, 2, 1, 1]);
  assert.equal(stats.byProfessional[0].name, "Dra. Ana"); // ordem por total
  const monday = stats.byWeekday[1];
  assert.deepEqual([monday.name, monday.total, monday.done], ["Segunda-feira", 2, 2]);
  assert.equal(stats.byWeekday.reduce((sum, day) => sum + day.total, 0), 7);
  assert.equal(stats.seriesTotal.reduce((sum, p) => sum + p.current, 0), 7);
  assert.equal(stats.seriesDone.reduce((sum, p) => sum + p.current, 0), 2);
  assert.ok(stats.seriesTotal.every((p) => p.previous === null));
});

test("appointmentStats: rates are null without a base, and unknown statuses go to other", () => {
  const stats = appointmentStats({ rows: [row("2026-11-02", "p1", "Botox", "Ana", "Agendado"), row("2026-11-02", "p2", "Botox", "Ana", "Reagendado")], range: input.range, previous: null, granularity: "day", today: "2026-11-05" });
  assert.equal(stats.totals.attendanceRatePct, null);
  assert.equal(stats.totals.cancellationRatePct, 0);
  assert.equal(stats.totals.other, 1);
  const empty = appointmentStats({ rows: [], range: input.range, previous: null, granularity: "day", today: "2026-11-05" });
  assert.equal(empty.totals.total, 0);
  assert.equal(empty.totals.cancellationRatePct, null);
});

test("appointmentStats with comparison aligns the previous period by position", () => {
  const stats = appointmentStats({ rows: [...appointmentRows, row("2026-10-27", "p9", "Botox", "Dra. Ana", "Atendido")], range: input.range, previous: { start: "2026-10-25", end: "2026-10-31" }, granularity: "day", today: "2026-11-05" });
  assert.equal(stats.previous.total, 2); // 10-27 e 10-30
  assert.equal(stats.seriesTotal[2].previous, 1); // 10-27 é a posição 3
});

test("buildAppointmentsDocument: kpis, empty state and privacy", () => {
  const report = { range: input.range, previousRange: null, appliedProfessional: null, granularity: "day", ...appointmentStats({ rows: appointmentRows, range: input.range, previous: null, granularity: "day", today: "2026-11-05" }) };
  const doc = buildAppointmentsDocument(input, report);
  assert.equal(doc.kind, "appointments");
  assert.equal(doc.hasData, true);
  const kpis = section(doc, "summary").items;
  assert.equal(kpis.find((item) => item.key === "total").value.value, 7);
  assert.equal(cellDisplay(kpis.find((item) => item.key === "attendanceRate").value), "66,7%");
  assert.match(kpis.find((item) => item.key === "pending").hint, /1 agendado/);
  assert.equal(section(doc, "by-professional").total.cells[1].value, 7);
  assert.ok(section(doc, "status-chart"));
  assertNoPatientData(doc);
  const emptyReport = { ...report, ...appointmentStats({ rows: [], range: input.range, previous: null, granularity: "day", today: "2026-11-05" }) };
  const empty = buildAppointmentsDocument(input, emptyReport);
  assert.equal(empty.hasData, false);
  assert.deepEqual(empty.sections.map((item) => item.type), ["kpis", "note"]); // o vazio ainda traz os KPIs (zerados) da tela
  assert.equal(empty.sections[1].text, "Nenhuma movimentação no período.");
});

// ---------- Orçamentos, clientes, procedimentos ----------

test("quoteFunnel counts events in the period and value by status of quotes created in it", () => {
  const q = (over) => ({ status: "Pendente", totalCents: 1000, createdDay: "2026-11-02", sentDay: null, approvedDay: null, refusedDay: null, expiresDay: null, createdAtMs: 0, sentAtMs: null, approvedAtMs: null, ...over });
  const funnel = quoteFunnel(
    [q({}), q({ status: "Enviado", sentDay: "2026-11-03", totalCents: 2000 }), q({ status: "Aprovado", sentDay: "2026-11-03", approvedDay: "2026-11-04", totalCents: 3000, approvedAtMs: 86_400_000 }), q({ status: "Recusado", refusedDay: "2026-11-05" }), q({ status: "Enviado", expiresDay: "2026-11-03" }), q({ createdDay: "2026-10-01" })],
    input.range,
    "2026-11-13",
  );
  assert.deepEqual([funnel.created, funnel.sent, funnel.approved, funnel.refused, funnel.expired], [5, 2, 1, 1, 1]);
  assert.equal(funnel.createdValueCents, 8000);
  assert.deepEqual(funnel.valueByStatus.map((item) => [item.status, item.count, item.totalCents]), [["Pendente", 1, 1000], ["Enviado", 2, 3000], ["Aprovado", 1, 3000], ["Recusado", 1, 1000]]);
});

test("buildQuotesDocument: empty funnel gives only the empty note; filled keeps cohort note", () => {
  const stats = { created: 0, approved: 0, refused: 0, expired: 0, conversionPct: null, approvedValueCents: 0, averageApprovalDays: null };
  const report = { range: input.range, previousRange: null, appliedProfessional: null, professionalNote: null, stats, previous: null, changes: null, series: { granularity: "day", created: [], approved: [] }, links: {} };
  const extras = { funnel: { created: 0, sent: 0, approved: 0, refused: 0, expired: 0, createdValueCents: 0, valueByStatus: [] }, previousFunnel: null };
  assert.equal(buildQuotesDocument(input, { report, extras }).hasData, false);
  const filled = buildQuotesDocument(input, {
    report: { ...report, stats: { ...stats, created: 2, approved: 1, conversionPct: 50, approvedValueCents: 3000 }, series: { granularity: "day", created: [{ label: "02/11", date: "2026-11-02", value: 2 }], approved: [{ label: "02/11", date: "2026-11-02", value: 1 }] } },
    extras: { funnel: { created: 2, sent: 1, approved: 1, refused: 0, expired: 0, createdValueCents: 4000, valueByStatus: [{ status: "Aprovado", count: 1, totalCents: 3000 }, { status: "Pendente", count: 1, totalCents: 1000 }] }, previousFunnel: null },
  });
  const kpis = section(filled, "summary").items;
  assert.equal(cellDisplay(kpis.find((item) => item.key === "conversion").value), "50%");
  assert.ok(isUnknown(kpis.find((item) => item.key === "approvalDays").value)); // sem aprovados com tempo: desconhecido, não 0
  assert.equal(cellDisplay(kpis.find((item) => item.key === "refused").value), "0"); // zero real
  assert.deepEqual(section(filled, "by-status").total.cells.slice(1).map((cell) => cell.value), [2, 4000]);
});

test("visitDistribution and procedureProfessionals aggregate without identifying people", () => {
  const done = [row("2026-11-02", "p1", "Botox", "Ana", "Atendido"), row("2026-11-03", "p1", "Peeling", "Ana", "Atendido"), row("2026-11-04", "p1", "Botox", "Bia", "Atendido"), row("2026-11-04", "p1", "Botox", "Bia", "Atendido"), row("2026-11-05", "p2", "Botox", "Ana", "Atendido")];
  const visits = visitDistribution(done);
  assert.deepEqual(visits.groups.map((g) => [g.patients, g.appointments]), [[1, 1], [0, 0], [1, 4]]);
  assert.equal(visits.totalPatients, 2);
  assert.ok(!JSON.stringify(visits).includes("p1"));
  assert.deepEqual(procedureProfessionals(done).map((item) => [item.procedure, item.professional, item.executions]), [["Botox", "Ana", 2], ["Botox", "Bia", 2], ["Peeling", "Ana", 1]]);
  const extras = professionalExtras([...done, row("2026-11-06", "p3", "Botox", "Ana", "Faltou")]);
  assert.deepEqual(extras.get("Ana"), { distinctProcedures: 2, attendanceRatePct: 75, appointments: 4 });
});

test("buildClientsDocument: counts only, null average is unknown and zero is zero", () => {
  const stats = { newPatients: 0, attendedPatients: 0, recurring: 0, inactive: 3, inactiveDays: 90, averageFrequency: null, returnRate: { value: null, returning: 0, total: 0 } };
  const report = { range: input.range, previousRange: null, appliedProfessional: null, stats, previous: null, baseSeries: { granularity: "day", points: [{ label: "01/11", date: "2026-11-01", newPatients: 0, totalPatients: 10 }] } };
  const doc = buildClientsDocument(input, { report, extras: { totalRegistered: 10, visits: visitDistribution([]) } });
  const kpis = section(doc, "summary").items;
  assert.equal(kpis.find((item) => item.key === "registered").value.value, 10);
  assert.equal(kpis.find((item) => item.key === "new").value.value, 0);
  assert.ok(isUnknown(kpis.find((item) => item.key === "frequency").value));
  assert.ok(isUnknown(kpis.find((item) => item.key === "returnRate").value));
  assert.equal(section(doc, "visits").total, null); // sem atendidos: sem total e com nota
  assert.ok(section(doc, "visits").notes.length > 0);
  assertNoPatientData(doc);
  const zeroStats = { ...stats, inactive: 0 };
  assert.equal(buildClientsDocument(input, { report: { ...report, stats: zeroStats }, extras: { totalRegistered: 0, visits: visitDistribution([]) } }).hasData, false);
  // KPI diferente de zero (ex.: novos pacientes) nunca é "vazio", mesmo sem cadastros/atendimentos nas bases
  assert.equal(buildClientsDocument(input, { report: { ...report, stats: { ...zeroStats, newPatients: 1 } }, extras: { totalRegistered: 0, visits: visitDistribution([]) } }).hasData, true);
});

test("buildProceduresDocument: no ficha técnica => cost and margin unknown, totals sum only known", () => {
  const rowOf = (name, executions, tableValueCents, materialCostCents) => ({ name, executions, matched: tableValueCents !== null, unitPriceCents: tableValueCents === null ? null : tableValueCents / executions, tableValueCents, materialCostCents, marginCents: tableValueCents !== null && materialCostCents !== null ? tableValueCents - materialCostCents : null, marginPct: null, tableSharePct: tableValueCents === null ? null : 50 });
  const report = {
    range: input.range, appliedProfessional: null, valueLabel: "x", totalExecutions: 3, tableTotalCents: 30_000,
    rows: [rowOf("Botox", 2, 20_000, 4_000), rowOf("Peeling", 1, 10_000, null), rowOf("Sem cadastro", 0 + 1, null, null)],
    distribution: [{ name: "Botox", valueCents: 20_000, pct: 66.7 }, { name: "Peeling", valueCents: 10_000, pct: 33.3 }], totalCents: 30_000, categories: null, limitation: "category_not_registered",
  };
  report.totalExecutions = 4;
  const extras = { professionals: [{ procedure: "Botox", professional: "Dra. Ana", executions: 2 }], series: { executions: [point("01/11", 4)], tableValueCents: [point("01/11", 30_000)] }, granularity: "day" };
  const doc = buildProceduresDocument(input, { report, extras });
  const ranking = section(doc, "ranking");
  const peeling = cellsOf(ranking)[1];
  assert.ok(isUnknown(peeling[5]) && peeling[5].reason === "sem ficha técnica");
  assert.ok(isUnknown(peeling[6]));
  assert.ok(isUnknown(cellsOf(ranking)[2][2])); // sem cadastro: valor de tabela desconhecido
  assert.deepEqual([ranking.total.cells[1].value, ranking.total.cells[2].value], [4, 30_000]);
  assert.equal(ranking.total.cells[5].value, 4_000);
  assert.equal(ranking.total.cells[6].value, 16_000);
  assert.equal(cellDisplay(section(doc, "summary").items.find((item) => item.key === "materialCost").value), "R$ 40,00");
  assert.ok(ranking.notes.some((noteText) => noteText.includes("sem custo de material conhecido (sem ficha técnica ou com item da ficha sem custo cadastrado): 2")));
  assert.equal(section(doc, "executors").rows.length, 1);
  assert.equal(buildProceduresDocument(input, { report: { ...report, totalExecutions: 0, tableTotalCents: 0, rows: [] }, extras }).hasData, false);
});

test("buildProfessionalsDocument: attendance rate, distinct procedures and the declared limitation", () => {
  const report = {
    range: input.range, appliedProfessional: null, cancellationRateNote: "n", revenue: null, limitation: "payment_without_professional",
    rows: [{ name: "Dra. Ana", done: 2, cancelled: 1, missed: 1, patients: 2, cancellationRatePct: 25, tableValueCents: 20_000, tableTicketCents: 10_000 }],
  };
  const extras = { byProfessional: [{ name: "Dra. Ana", distinctProcedures: 2, attendanceRatePct: 66.7, appointments: 4 }], doneSeries: [point("01/11", 2)], granularity: "day" };
  const doc = buildProfessionalsDocument(input, { report, extras });
  const ana = cellsOf(section(doc, "ranking"))[0];
  assert.equal(cellDisplay(ana[4]), "66,7%"); // 2 ÷ (2 + 1)
  assert.equal(ana[6].value, 2);
  assert.ok(section(doc, "ranking").notes.some((noteText) => noteText.includes("não há receita por profissional")));
  assertNoPatientData(doc);
  assert.equal(buildProfessionalsDocument(input, { report: { ...report, rows: [] }, extras }).hasData, false);
});

// ---------- Financeiro ----------

const financeReport = (over = {}) => ({
  range: input.range, previousRange: null, appliedProfessional: null, limitation: null,
  summary: { revenueCents: 10_000, expensesCents: 3_000, resultCents: 7_000, marginPct: 70 }, previous: null, changes: null,
  series: { granularity: "day", revenue: [point("01/11", 10_000)], expenses: [point("01/11", 3_000)] },
  expensesByCategory: [{ category: "Aluguel", valueCents: 3_000 }], links: {}, ...over,
});
const financeExtras = (over = {}) => ({
  receivedByMethod: [{ method: "Pix", count: 2, valueCents: 7_000 }, { method: "Cartão", count: 1, valueCents: 3_000 }],
  receivable: { cents: 5_000, count: 1, previousCents: null },
  payable: { cents: 9_000, count: 1, previousCents: null },
  payments: {
    paid: { total: 2, rows: [{ date: "2026-11-10", method: "Pix", installments: "1x", status: "Pago", valueCents: 7_000 }, { date: "2026-11-09", method: "Cartão", installments: "3x", status: "Pago", valueCents: 3_000 }] },
    pending: { total: 1, rows: [{ date: "2026-11-11", method: "Pix", installments: "1x", status: "Pendente", valueCents: 5_000 }] },
  },
  expenses: {
    paid: { total: 1, rows: [{ dueOn: "2026-11-12", paidOn: "2026-11-12", category: "Aluguel", description: "Conta", status: "paid", amountCents: 3_000 }] },
    open: { total: 1, rows: [{ dueOn: "2026-11-15", paidOn: null, category: "Luz", description: "Conta de luz", status: "open", amountCents: 9_000 }] },
  },
  ...over,
});

test("buildFinanceDocument: received x pending x paid separated, method pct, totals and no patient data", () => {
  const doc = buildFinanceDocument(input, { report: financeReport(), extras: financeExtras() });
  const kpis = section(doc, "summary").items;
  const value = (key) => cellDisplay(kpis.find((item) => item.key === key).value);
  assert.deepEqual(["received", "expensesPaid", "result", "margin", "receivable", "payable"].map(value), ["R$ 100,00", "R$ 30,00", "R$ 70,00", "70%", "R$ 50,00", "R$ 90,00"]);
  const byMethod = section(doc, "by-method");
  assert.deepEqual(cellsOf(byMethod).map((cells) => cells[3].value), [70, 30]);
  assert.deepEqual(byMethod.total.cells.slice(1).map((cell) => cell.value), [3, 10_000, 100]);
  assert.equal(section(doc, "payments-paid").total.cells[4].value, 10_000);
  assert.equal(section(doc, "payments-pending").rows.length, 1);
  assert.equal(section(doc, "payments-pending").rows[0].tone, "warning");
  assert.equal(section(doc, "payments-pending").total.cells[4].value, 5_000);
  assert.equal(section(doc, "expenses-paid").rows.length, 1);
  assert.equal(section(doc, "expenses-open").rows[0].cells[2].value, "Em aberto");
  assert.ok(section(doc, "evolution-chart"));
  assert.equal(doc.sections.find((item) => item.id === "revenue-previous-chart"), undefined); // sem comparação
  assertNoPatientData(doc);
});

test("buildFinanceDocument: zero margin base is unknown, zero result stays R$ 0,00, negative result is flagged", () => {
  const noRevenue = buildFinanceDocument(input, { report: financeReport({ summary: { revenueCents: 0, expensesCents: 3_000, resultCents: -3_000, marginPct: null } }), extras: financeExtras({ receivedByMethod: [] }) });
  const kpis = section(noRevenue, "summary").items;
  assert.ok(isUnknown(kpis.find((item) => item.key === "margin").value));
  assert.equal(kpis.find((item) => item.key === "result").tone, "negative");
  assert.equal(cellDisplay(kpis.find((item) => item.key === "received").value), "R$ 0,00");
  const zero = buildFinanceDocument(input, { report: financeReport({ summary: { revenueCents: 0, expensesCents: 0, resultCents: 0, marginPct: null } }), extras: financeExtras({ receivable: { cents: 0, count: 0, previousCents: null }, payable: { cents: 0, count: 0, previousCents: null }, payments: { paid: { total: 1, rows: [] }, pending: { total: 0, rows: [] } }, receivedByMethod: [] }) });
  assert.equal(cellDisplay(section(zero, "summary").items.find((item) => item.key === "result").value), "R$ 0,00");
});

test("buildFinanceDocument: no movement = only the empty note; compare adds previous columns and chart; truncation is announced", () => {
  const emptyExtras = { receivedByMethod: [], receivable: { cents: 0, count: 0, previousCents: null }, payable: { cents: 0, count: 0, previousCents: null }, payments: { paid: { total: 0, rows: [] }, pending: { total: 0, rows: [] } }, expenses: { paid: { total: 0, rows: [] }, open: { total: 0, rows: [] } } };
  const empty = buildFinanceDocument(input, { report: financeReport({ summary: { revenueCents: 0, expensesCents: 0, resultCents: 0, marginPct: null }, expensesByCategory: [] }), extras: emptyExtras });
  assert.equal(empty.hasData, false);
  assert.deepEqual(empty.sections.map((item) => item.type), ["kpis", "note"]);

  const compareInput = { ...input, previous: { start: "2026-10-25", end: "2026-10-31" } };
  const compared = buildFinanceDocument(compareInput, {
    report: financeReport({ previousRange: compareInput.previous, previous: { revenueCents: 5_000, expensesCents: 1_000, resultCents: 4_000, marginPct: 80 }, series: { granularity: "day", revenue: [point("01/11", 10_000, 5_000), point("02/11", 0, null)], expenses: [point("01/11", 3_000, 1_000), point("02/11", 0, null)] } }),
    extras: financeExtras({ receivable: { cents: 5_000, count: 1, previousCents: 2_500 } }),
  });
  assert.equal(compared.comparePeriod.from, "2026-10-25");
  const evolution = section(compared, "evolution");
  assert.equal(evolution.columns.length, 5);
  assert.ok(isUnknown(cellsOf(evolution)[1][2])); // sem posição correspondente no período anterior
  assert.equal(section(compared, "summary").items.find((item) => item.key === "received").change, 100);
  assert.equal(section(compared, "summary").items.find((item) => item.key === "receivable").change, 100);
  assert.ok(section(compared, "revenue-previous-chart"));

  const big = buildFinanceDocument(input, { report: financeReport(), extras: financeExtras({ payments: { paid: { total: 9000, rows: financeExtras().payments.paid.rows }, pending: financeExtras().payments.pending } }) });
  assert.ok(section(big, "payments-paid").notes.includes("Exibindo 2 de 9.000 linhas."));
  assert.equal(section(big, "payments-paid").total, null);
  // truncamento é por tabela: a de pendentes continua completa, com total
  assert.equal(section(big, "payments-pending").truncated, null);
  assert.equal(section(big, "payments-pending").total.cells[4].value, 5_000);
});

// ---------- Estoque ----------

const stockProducts = [
  { id: "a", name: "Ácido", kind: "produto", unit: "ml", costCents: 1000, minStock: 10, archived: false },
  { id: "b", name: "Agulha", kind: "material", unit: "unidade", costCents: 0, minStock: 5, archived: false },
];
const stockLots = [{ productId: "a", expiresOn: "2026-11-01", balance: 4 }, { productId: "b", expiresOn: "2027-12-31", balance: 20 }];
const catalog = new Map(stockProducts.map((product) => [product.id, product]));
const stockData = (over = {}) => {
  const position = { asOf: "2026-11-13", warningDays: 30, ...stockPosition({ products: stockProducts, lots: stockLots, today: "2026-11-13", warningDays: 30 }) };
  const summary = summarizeMovements(
    [{ productId: "a", type: "purchase", sign: "in", quantity: 50, count: 1 }, { productId: "a", type: "attendance", sign: "out", quantity: -3, count: 2 }, { productId: "b", type: "manual_out", sign: "out", quantity: -2, count: 1 }],
    catalog,
  );
  return {
    position,
    movements: {
      totalMovements: 4, reversalPairs: 1, summary,
      consumption: { byProduct: [{ name: "Ácido", unit: "ml", quantity: 3, estimatedCostCents: 3000 }, { name: "Agulha", unit: "unidade", quantity: 2, estimatedCostCents: null }], byProcedure: [{ name: "Botox", movements: 2, estimatedCostCents: 3000, missingCostMovements: 0 }] },
      history: [
        { at: "2026-11-05T15:00:00.000Z", type: "purchase", reversesId: null, reversed: false, productName: "Ácido", unit: "ml", quantity: 50, lotCode: "L1", note: "Compra Fornecedor X", userName: "Admin" },
        { at: "2026-11-04T15:00:00.000Z", type: "attendance", reversesId: null, reversed: true, productName: "Ácido", unit: "ml", quantity: -3, lotCode: "L1", note: "", userName: "" },
      ],
      professionalScoped: false,
      ...over,
    },
  };
};

test("buildStockDocument: position and movements are present with signed quantities and unknown costs", () => {
  const doc = buildStockDocument(input, stockData());
  assert.equal(doc.hasData, true);
  const kpis = section(doc, "position-kpis").items;
  assert.equal(kpis.find((item) => item.key === "items").value.value, 2);
  assert.equal(kpis.find((item) => item.key === "outOfStock").value.value, 0); // zero real
  assert.equal(kpis.find((item) => item.key === "expiredLots").value.value, 1);
  assert.equal(cellDisplay(kpis.find((item) => item.key === "stockValue").value), "R$ 40,00"); // só o ácido (4 × 10,00)
  assert.match(kpis.find((item) => item.key === "stockValue").hint, /1 item com saldo sem custo cadastrado ficou fora/);

  const position = section(doc, "position");
  const needle = cellsOf(position)[1];
  assert.ok(isUnknown(needle[6]) && needle[6].reason === "sem custo cadastrado");
  assert.ok(isUnknown(needle[7]));
  assert.equal(position.total.cells[7].value, 4000);
  assert.ok(position.notes.some((noteText) => noteText.includes("Itens sem custo cadastrado: 1")));
  assert.equal(position.rows[0].tone, "warning"); // ácido abaixo do mínimo (4 < 10)

  const history = section(doc, "movements-history");
  assert.equal(history.rows.length, 2);
  assert.equal(history.rows[1].cells[2].value, "Consumo em atendimento (estornado)");
  assert.equal(history.rows[1].cells[3].value, -3);
  assert.ok(isUnknown(history.rows[1].cells[6])); // sem observação
  assert.equal(section(doc, "movements-kpis").items.find((item) => item.key === "movements").value.value, 4);
  assert.ok(section(doc, "movements-by-type").notes.some((noteText) => noteText.includes("estornada")));
  assert.ok(isUnknown(section(doc, "consumption-by-item").rows[1].cells[3]));
  assertNoPatientData(doc);
});

test("buildStockDocument: no movements keeps the position and says so; nothing at all is an empty document", () => {
  const noMovements = buildStockDocument(input, stockData({ totalMovements: 0, history: [], summary: summarizeMovements([], catalog), consumption: { byProduct: [], byProcedure: [] }, reversalPairs: 0 }));
  assert.equal(noMovements.hasData, true);
  assert.ok(section(noMovements, "position"));
  assert.equal(section(noMovements, "no-movements").text, "Nenhuma movimentação no período.");
  assert.equal(section(noMovements, "movements-history"), undefined);
  assert.equal(section(noMovements, "consumption-by-item"), undefined);

  const base = stockData({ totalMovements: 0, history: [], summary: summarizeMovements([], catalog), consumption: { byProduct: [], byProcedure: [] } });
  const emptyPosition = { asOf: "2026-11-13", warningDays: 30, ...stockPosition({ products: [], lots: [], today: "2026-11-13", warningDays: 30 }) };
  const nothing = buildStockDocument(input, { position: emptyPosition, movements: base.movements });
  assert.equal(nothing.hasData, false);
  assert.deepEqual(nothing.sections.map((item) => item.type), ["kpis", "note", "note"]);
});

test("buildStockDocument: truncated history announces 'exibindo N de M' and a professional filter is explained", () => {
  const data = stockData({ totalMovements: 12_000, professionalScoped: true });
  const doc = buildStockDocument({ ...input, professional: "Dra. Ana" }, data);
  assert.ok(section(doc, "movements-history").notes.includes("Exibindo 2 de 12.000 linhas."));
  assert.equal(section(doc, "professional-scope").tone, "warning");
  assert.deepEqual(doc.filters[0], { label: "Profissional", value: "Dra. Ana" });
});

// ---------- Visão geral e consolidado ----------

test("buildOverviewDocument and buildAllDocument: cover + one summary per permitted report", () => {
  const withChange = (value, previous = null) => ({ value, previous, changePct: null });
  const overview = {
    cards: { appointments: withChange(5), revenue: withChange(10_000), revenueLimitation: null, newPatients: withChange(0), returnRate: { value: null, previous: null, changePp: null }, avgTicket: withChange(2_000), avgTicketNote: "aprox." },
    series: { granularity: "day", appointments: [point("01/11", 5)], revenue: [point("01/11", 10_000)] }, insights: [{ id: "x", available: true, tone: "neutral", message: "Procedimento mais realizado: Botox" }, { id: "y", available: false, tone: "neutral", message: "n/d" }],
  };
  const overviewDoc = buildOverviewDocument(input, overview);
  assert.equal(overviewDoc.hasData, true);
  assert.ok(isUnknown(section(overviewDoc, "summary").items.find((item) => item.key === "returnRate").value));
  assert.equal(section(overviewDoc, "insights").rows.length, 1);
  const hidden = buildOverviewDocument(input, { ...overview, cards: { ...overview.cards, revenue: null, avgTicket: null, revenueLimitation: "forbidden" } });
  assert.ok(isUnknown(section(hidden, "summary").items.find((item) => item.key === "revenue").value));

  const finance = buildFinanceDocument(input, { report: financeReport(), extras: financeExtras() });
  const stock = buildStockDocument(input, stockData());
  const emptyAppointments = buildAppointmentsDocument(input, { range: input.range, previousRange: null, appliedProfessional: null, granularity: "day", ...appointmentStats({ rows: [], range: input.range, previous: null, granularity: "day", today: "2026-11-05" }) });
  const all = buildAllDocument(input, [overviewDoc, finance, stock, emptyAppointments]);
  assert.equal(all.kind, "all");
  assert.equal(all.title, "Consolidado");
  assert.equal(all.hasData, true);
  assert.equal(all.sections[0].type, "note");
  assert.ok(section(all, "finance-summary") && section(all, "stock-summary") && section(all, "overview-summary"));
  assert.equal(section(all, "finance-summary").title, "Financeiro");
  assert.equal(section(all, "appointments-empty").text, "Agendamentos: Nenhuma movimentação no período.");
  assert.equal(buildAllDocument(input, [emptyAppointments]).hasData, false);
  assertNoPatientData(all);
});

// ---------- Correções pós-revisão ----------

test("professionals document: unpriced executions give partial value with a note, and unknown when all are unpriced; distinct cancellation label", () => {
  const base = { cancellationRatePct: 25, patients: 1, cancelled: 0, missed: 0 };
  const report = {
    range: input.range, appliedProfessional: null, cancellationRateNote: "n", revenue: null, limitation: null,
    rows: [{ name: "Ana", done: 2, ...base, tableValueCents: 100_000, unpricedExecutions: 1, tableTicketCents: 100_000 }, { name: "Bia", done: 2, ...base, tableValueCents: null, unpricedExecutions: 2, tableTicketCents: null }],
  };
  const extras = { byProfessional: [], doneSeries: [point("01/11", 4)], granularity: "day" };
  const doc = buildProfessionalsDocument(input, { report, extras });
  const ranking = section(doc, "ranking");
  const [ana, bia] = cellsOf(ranking);
  assert.equal(ana[8].value, 100_000);
  assert.ok(isUnknown(bia[8]) && bia[8].reason === "procedimento sem preço cadastrado");
  assert.ok(isUnknown(bia[9]));
  assert.equal(ranking.total.cells[8].value, 100_000);
  assert.equal(ranking.total.cells[0].value, "Total (parcial)");
  assert.ok(ranking.notes.some((noteText) => noteText.includes("Execuções sem preço cadastrado: 3")));
  const kpi = section(doc, "summary").items.find((item) => item.key === "tableValue");
  assert.equal(kpi.value.value, 100_000);
  assert.ok(kpi.hint.startsWith("Parcial: 3 execução"));
  assert.ok(ranking.columns.some((column) => column.label === "Cancelamento (÷ desfechos)"));
  const allUnpriced = buildProfessionalsDocument(input, { report: { ...report, rows: [report.rows[1]] }, extras });
  assert.ok(isUnknown(section(allUnpriced, "summary").items.find((item) => item.key === "tableValue").value));
});

test("appointments document: cancellation label says what it divides by", () => {
  const doc = buildAppointmentsDocument(input, { range: input.range, previousRange: null, appliedProfessional: null, granularity: "day", ...appointmentStats({ rows: appointmentRows, range: input.range, previous: null, granularity: "day", today: "2026-11-05" }) });
  assert.ok(section(doc, "summary").items.some((item) => item.label === "Cancelamento (÷ agendamentos do período)"));
  assert.ok(section(doc, "by-professional").columns.some((column) => column.label === "Cancelamento (÷ agendamentos do período)"));
});

test("stock document: forced professional gets no unit cost, no stock value and no value chart, with a note; others keep them", () => {
  const data = stockData();
  const normal = buildStockDocument(input, data);
  assert.ok(section(normal, "position").columns.some((column) => column.key === "cost"));
  const hidden = buildStockDocument(input, { ...data, position: { ...data.position, costHidden: true, items: data.position.items.map((item) => ({ ...item, unitCostCents: null, valueCents: null })) } });
  const position = section(hidden, "position");
  assert.deepEqual(position.columns.filter((column) => column.key === "cost" || column.key === "value"), []);
  assert.ok(position.rows.every((r) => r.cells.length === position.columns.length));
  assert.ok(position.notes.some((noteText) => noteText.includes("não são exibidos")));
  assert.ok(!section(hidden, "position-kpis").items.some((item) => item.key === "stockValue"));
  assert.equal(section(hidden, "value-chart"), undefined);
  assert.ok(section(hidden, "position").columns.some((column) => column.key === "balance")); // saldo, mínimo, situação e validade seguem
});

test("procedures document: table value and ticket are unknown (not R$ 0,00) when no execution has a price; partial is labelled", () => {
  const unpricedRow = (name, executions) => ({ name, executions, matched: false, costKnown: false, materialCostReason: "no_sheet", unitPriceCents: null, tableValueCents: null, materialCostCents: null, marginCents: null, marginPct: null, tableSharePct: null });
  const base = { range: input.range, appliedProfessional: null, valueLabel: "x", distribution: [], totalCents: 0, categories: null, limitation: "category_not_registered" };
  const extras = { professionals: [], series: { executions: [point("01/11", 3)], tableValueCents: [point("01/11", 0)], unpriced: [point("01/11", 3)] }, granularity: "day" };
  const none = buildProceduresDocument(input, { report: { ...base, totalExecutions: 3, tableTotalCents: null, pricedExecutions: 0, rows: [unpricedRow("A", 2), unpricedRow("B", 1)] }, extras });
  const items = section(none, "summary").items;
  assert.ok(isUnknown(items.find((item) => item.key === "tableValue").value));
  assert.ok(isUnknown(items.find((item) => item.key === "tableTicket").value));
  assert.ok(items.find((item) => item.key === "tableValue").hint.includes("Nenhum procedimento"));
  assert.ok(isUnknown(cellsOf(section(none, "evolution"))[0][2])); // evolução também "—"
  const partial = buildProceduresDocument(input, { report: { ...base, totalExecutions: 3, tableTotalCents: 30_000, pricedExecutions: 1, rows: [{ ...unpricedRow("A", 1), tableValueCents: 30_000, matched: true, unitPriceCents: 30_000 }, unpricedRow("B", 2)] }, extras });
  const partialItems = section(partial, "summary").items;
  assert.equal(partialItems.find((item) => item.key === "tableValue").value.value, 30_000);
  assert.ok(partialItems.find((item) => item.key === "tableValue").hint.startsWith("Parcial: 2 execução"));
  assert.equal(partialItems.find((item) => item.key === "tableTicket").value.value, 30_000); // ÷ execuções com preço
});
