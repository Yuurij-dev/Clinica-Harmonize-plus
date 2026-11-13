// Pacotes de exportação (documento + especificação de planilha) montados com os builders reais a partir de dados sintéticos. Sem banco.
import { buildProceduresDocument, buildProfessionalsDocument, buildAppointmentsDocument, buildQuotesDocument, buildClientsDocument, buildFinanceDocument, buildStockDocument, buildOverviewDocument } from "../src/lib/reports-documents/index.ts";
import { appointmentStats, executionSeries, procedureProfessionals, professionalExtras, quoteFunnel, doneSeries, visitDistribution } from "../src/lib/reports-extra-rules.ts";
import { changePct, clientStats, doneInRange, procedureStats, professionalStats, quoteStats, reportBuckets, tableDistribution, cumulativeSeries } from "../src/lib/reports-rules.ts";
import { stockPosition, summarizeMovements } from "../src/lib/reports-stock-rules.ts";
import { buildAppointmentsSpec, buildClientsSpec, buildFinanceSpec, buildGenericSpec, buildProceduresSpec, buildProfessionalsSpec, buildQuotesSpec, buildStockSpec } from "../src/lib/reports-xlsx-specs/index.ts";

export const range = { period: "custom", start: "2026-10-15", end: "2026-11-13", days: 30 };
export const input = (over = {}) => ({ clinicName: "Clinica", range, previous: null, professional: null, granularityLabel: "Diário", generatedAt: "2026-11-13T15:45:00.000Z", ...over });

export const catalog = [
  { name: "Bioestimulador", priceCents: 220000, materialCostCents: 90000, materialCostReason: null },
  { name: "Microagulhamento", priceCents: 38000, materialCostCents: 7000, materialCostReason: null },
  { name: "Peeling químico", priceCents: 45000, materialCostCents: 9000, materialCostReason: null },
  { name: "Preenchimento labial", priceCents: 150000, materialCostCents: 52000, materialCostReason: null },
  { name: "Toxina botulínica", priceCents: 120000, materialCostCents: 28000, materialCostReason: null },
  { name: "Limpeza de pele", priceCents: 28000, materialCostCents: null, materialCostReason: "no_sheet" },
];
const professionals = ["Dr. Bruno Souza", "Dra. Carla Mendes", "Dra. Elisa Prado"];
const statuses = ["Atendido", "Finalizado", "Atendido", "Faltou", "Cancelado", "Atendido", "Agendado", "Atendido"];

// 40 agendamentos; os realizados (32 no modelo do usuário) viram as execuções do relatório de Procedimentos.
export function appointmentRows(count = 40) {
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(Date.UTC(2026, 9, 15 + (index % 30))).toISOString().slice(0, 10);
    return { day, patientId: `p${index % 9}`, procedure: catalog[index % catalog.length].name, professional: professionals[index % 3], status: statuses[index % statuses.length], time: `${String(8 + (index % 9)).padStart(2, "0")}:00` };
  });
}
export const doneRows = (count = 40) => appointmentRows(count).map((row) => ({ ...row, status: "Atendido" }));

export function proceduresBundle({ rows = doneRows(32), cat = catalog, inp = input(), previous = null } = {}) {
  const done = doneInRange(rows, range);
  const stats = procedureStats(done, cat);
  const { distribution, totalCents } = tableDistribution(stats.rows);
  const report = { range, appliedProfessional: null, valueLabel: "x", totalExecutions: stats.totalExecutions, tableTotalCents: stats.tableTotalCents, pricedExecutions: stats.pricedExecutions, rows: stats.rows, distribution, totalCents, categories: null, limitation: "category_not_registered" };
  const extras = { professionals: procedureProfessionals(done), series: executionSeries({ rows, catalog: cat, range, previous, granularity: "day" }), granularity: "day" };
  const doc = buildProceduresDocument(inp, { report, extras });
  return { doc, spec: buildProceduresSpec(doc, { rows, catalog: cat }), report };
}

export function professionalsBundle({ rows = appointmentRows(40), inp = input() } = {}) {
  const inRange = rows.filter((row) => row.day >= range.start && row.day <= range.end);
  const report = { range, appliedProfessional: null, rows: professionalStats(inRange, catalog), cancellationRateNote: "n", revenue: null, limitation: "payment_without_professional" };
  const extras = { byProfessional: [...professionalExtras(inRange).entries()].map(([name, extra]) => ({ name, ...extra })), doneSeries: doneSeries(rows, range, null, "day"), granularity: "day" };
  const doc = buildProfessionalsDocument(inp, { report, extras });
  return { doc, spec: buildProfessionalsSpec(doc, { rows, catalog }) };
}

export function appointmentsBundle({ rows = appointmentRows(40), inp = input() } = {}) {
  const stats = appointmentStats({ rows, range, previous: null, granularity: "day", today: "2026-11-13" });
  const doc = buildAppointmentsDocument(inp, { range, previousRange: null, appliedProfessional: null, granularity: "day", ...stats });
  return { doc, spec: buildAppointmentsSpec(doc, { rows }) };
}

export function quotesBundle({ inp = input(), rows } = {}) {
  const quoteRows = rows ?? Array.from({ length: 8 }, (_, index) => ({ status: ["Aprovado", "Pendente", "Recusado", "Enviado", "Pago"][index % 5], totalCents: 100000 + index * 5000, createdDay: `2026-10-${String(16 + index).padStart(2, "0")}`, sentDay: index % 2 ? "2026-10-20" : null, approvedDay: index % 5 === 0 ? "2026-10-25" : null, refusedDay: index % 5 === 2 ? "2026-10-26" : null, expiresDay: "2026-12-01", createdAtMs: Date.UTC(2026, 9, 16 + index), sentAtMs: null, approvedAtMs: null }));
  const stats = quoteStats(quoteRows, range, "2026-11-13");
  const buckets = reportBuckets(range, "day");
  const funnel = quoteFunnel(quoteRows, range, "2026-11-13");
  const point = (label) => ({ label, date: label, value: 0 });
  const report = { range, previousRange: null, appliedProfessional: null, professionalNote: null, stats, previous: null, changes: null, series: { granularity: "day", created: buckets.map((b) => ({ label: b.label, date: b.start, value: 0 })), approved: buckets.map((b) => ({ label: b.label, date: b.start, value: 0 })) }, links: {} };
  void point;
  const doc = buildQuotesDocument(inp, { report, extras: { funnel, previousFunnel: null } });
  return { doc, spec: buildQuotesSpec(doc, { rows: quoteRows }) };
}

export function clientsBundle({ inp = input(), rows = appointmentRows(40), registered = 25, newPatients = 3 } = {}) {
  const done = doneInRange(rows, range);
  const buckets = reportBuckets(range, "week");
  const points = cumulativeSeries(buckets, 20, newPatients > 0 ? ["2026-10-16", "2026-10-30", "2026-11-05"] : []);
  const stats = clientStats({ range, today: "2026-11-13", periodDone: done, cumulative: [], priorPatientIds: new Set(), newPatients });
  const report = { range, previousRange: null, appliedProfessional: null, stats, previous: null, baseSeries: { granularity: "week", points } };
  const doc = buildClientsDocument(inp, { report, extras: { totalRegistered: registered, visits: visitDistribution(done) } });
  return { doc, spec: buildClientsSpec(doc, { points, granularity: "week", rows }) };
}

export function financeBundle({ inp = input(), empty = false } = {}) {
  const pay = (date, method, status, valueCents) => ({ date, method, installments: "1x", status, valueCents });
  const exp = (dueOn, paidOn, category, status, amountCents) => ({ dueOn, paidOn, category, description: "SEGREDO-DESCRICAO", status, amountCents });
  const paid = empty ? [] : [pay("2026-11-01", "Pix", "Pago", 150000), pay("2026-11-03", "Cartão", "Pago", 80000), pay("2026-11-05", "Pix", "Pago", 20000)];
  const pending = empty ? [] : [pay("2026-11-10", "Pix", "Pendente", 30000)];
  const paidExp = empty ? [] : [exp("2026-11-02", "2026-11-02", "Aluguel", "paid", 60000)];
  const openExp = empty ? [] : [exp("2026-11-20", null, "Luz", "open", 15000)];
  const extras = {
    receivedByMethod: empty ? [] : [{ method: "Pix", count: 2, valueCents: 170000 }, { method: "Cartão", count: 1, valueCents: 80000 }],
    receivable: { cents: pending.reduce((s, r) => s + r.valueCents, 0), count: pending.length, previousCents: null },
    payable: { cents: openExp.reduce((s, r) => s + r.amountCents, 0), count: openExp.length, previousCents: null },
    payments: { paid: { total: paid.length, rows: paid }, pending: { total: pending.length, rows: pending } },
    expenses: { paid: { total: paidExp.length, rows: paidExp }, open: { total: openExp.length, rows: openExp } },
  };
  const revenue = paid.reduce((s, r) => s + r.valueCents, 0);
  const expenses = paidExp.reduce((s, r) => s + r.amountCents, 0);
  const report = { range, previousRange: null, appliedProfessional: null, limitation: null, summary: { revenueCents: revenue, expensesCents: expenses, resultCents: revenue - expenses, marginPct: revenue > 0 ? ((revenue - expenses) / revenue) * 100 : null }, previous: null, changes: null, series: { granularity: "day", revenue: [], expenses: [] }, expensesByCategory: empty ? [] : [{ category: "Aluguel", valueCents: 60000 }], links: {} };
  const doc = buildFinanceDocument(inp, { report, extras });
  return { doc, spec: buildFinanceSpec(doc, extras) };
}

export function stockBundle({ inp = input(), costHidden = false, empty = false } = {}) {
  const products = empty ? [] : [{ id: "a", name: "Ácido hialurônico", kind: "produto", unit: "ml", costCents: 12000, minStock: 10, archived: false }, { id: "b", name: "Agulha 30G", kind: "material", unit: "unidade", costCents: 0, minStock: 50, archived: false }, { id: "c", name: "Gaze", kind: "material", unit: "pacote", costCents: 800, minStock: 0, archived: false }];
  const lots = empty ? [] : [{ productId: "a", expiresOn: "2026-11-30", balance: 4 }, { productId: "b", expiresOn: "2027-12-31", balance: 120 }];
  const position = { asOf: "2026-11-13", warningDays: 30, ...stockPosition({ products, lots, today: "2026-11-13", warningDays: 30 }), costHidden };
  if (costHidden) position.items = position.items.map((item) => ({ ...item, unitCostCents: null, valueCents: null }));
  const catalogMap = new Map(products.map((p) => [p.id, p]));
  const summary = summarizeMovements(empty ? [] : [{ productId: "a", type: "purchase", sign: "in", quantity: 20, count: 1 }, { productId: "a", type: "attendance", sign: "out", quantity: -3, count: 2 }], catalogMap);
  const history = empty ? [] : [{ at: "2026-11-05T15:00:00.000Z", type: "purchase", reversesId: null, reversed: false, productName: "Ácido hialurônico", unit: "ml", quantity: 20, lotCode: "L1", note: "" }, { at: "2026-11-06T15:00:00.000Z", type: "manual_out", reversesId: null, reversed: false, productName: "Gaze", unit: "pacote", quantity: -2, lotCode: "L2", note: "Perda/quebra" }];
  const data = { position, movements: { totalMovements: history.length, reversalPairs: 0, summary, consumption: { byProduct: [], byProcedure: [] }, history, professionalScoped: false } };
  const doc = buildStockDocument(inp, data);
  return { doc, spec: buildStockSpec(doc, data) };
}

export function overviewBundle({ inp = input() } = {}) {
  const point = (label, current) => ({ label, date: label, current, previous: null });
  const withChange = (value) => ({ value, previous: null, changePct: null });
  const overview = { cards: { appointments: withChange(5), revenue: withChange(10000), revenueLimitation: null, newPatients: withChange(1), returnRate: { value: 50, previous: null, changePp: null }, avgTicket: withChange(2000), avgTicketNote: "aprox." }, series: { granularity: "day", appointments: [point("01/11", 5)], revenue: [point("01/11", 10000)] }, insights: [] };
  const doc = buildOverviewDocument(inp, overview);
  return { doc, spec: buildGenericSpec(doc) };
}

export const allBundles = () => ({ procedures: proceduresBundle(), professionals: professionalsBundle(), appointments: appointmentsBundle(), quotes: quotesBundle(), clients: clientsBundle(), finance: financeBundle(), stock: stockBundle(), overview: overviewBundle() });
void changePct;
