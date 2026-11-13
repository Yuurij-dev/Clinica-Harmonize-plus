// Camada de dados dos Relatórios (Prisma). TODA query leva o clinicId da sessão. Agrega no banco quando possível
// (groupBy/count) e carrega só linhas leves quando a regra precisa do dia no fuso da clínica. Regras em reports-rules.ts.
import { clinicToday, dateOnly } from "./clinic-time";
import { addDays } from "./finance-rules";
import { prisma } from "./prisma";
import type { ReportAccess } from "./reports-access";
import { buildInsights } from "./reports-insights";
import {
  alignSeries, averageTicket, changePct, changePp, clientStats, consumptionStats, cumulativeSeries, doneInRange, doneStatuses, financeSummary,
  procedureStats, professionalStats, quoteStats, reportBuckets, returnRate, sumByBucket, tableDistribution, weekdayCounts,
  type AppointmentRow, type Bucket, type ProcedureCatalogEntry, type QuoteRow, type ReportGranularity, type ResolvedRange, type ReportRange,
} from "./reports-rules";

// Início do dia na clínica (America/Sao_Paulo, sem horário de verão desde 2019, igual a appointmentInstant).
export const dayStart = (day: string) => new Date(`${day}T00:00:00-03:00`);
export const windowOf = (range: ReportRange) => ({ gte: dayStart(range.start), lt: dayStart(addDays(range.end, 1)) });

export type ReportContext = {
  clinicId: string;
  access: ReportAccess;
  range: ResolvedRange;
  previous: ReportRange | null;
  professional: string | null;
  requestedProfessional: string | null;
  granularity: ReportGranularity;
  today: string;
};

// ---------- Consultas ----------

export function span(ctx: ReportContext): ReportRange {
  return { start: ctx.previous ? ctx.previous.start : ctx.range.start, end: ctx.range.end };
}

// Memoização por requisição: o ReportContext é criado a cada requisição (reportContext), então o cache vive só nela. Evita reler
// os mesmos agendamentos/catálogo/orçamentos 6–7 vezes no consolidado (all). Os resultados são somente leitura para quem chama.
const memoStore = new WeakMap<ReportContext, Map<string, Promise<unknown>>>();
function memo<T>(ctx: ReportContext, key: string, load: () => Promise<T>): Promise<T> {
  let store = memoStore.get(ctx);
  if (!store) { store = new Map(); memoStore.set(ctx, store); }
  const cached = store.get(key);
  if (cached) return cached as Promise<T>;
  const pending = load();
  store.set(key, pending);
  pending.catch(() => store.delete(key)); // falha não fica em cache
  return pending;
}

export function loadAppointments(ctx: ReportContext, window: ReportRange): Promise<AppointmentRow[]> {
  return memo(ctx, `appointments:${window.start}:${window.end}`, () => queryAppointments(ctx, window));
}

async function queryAppointments(ctx: ReportContext, window: ReportRange): Promise<AppointmentRow[]> {
  const rows = await prisma.appointment.findMany({
    where: { clinicId: ctx.clinicId, date: windowOf(window), ...(ctx.professional ? { professional: ctx.professional } : {}) },
    select: { date: true, time: true, patientId: true, procedure: true, professional: true, status: true },
  });
  return rows.map((row) => ({ day: clinicToday(row.date), patientId: row.patientId, procedure: row.procedure, professional: row.professional, status: row.status, time: row.time }));
}

// Pacientes (entre os dados) que já tinham atendimento realizado antes do início do período.
async function priorDonePatients(ctx: ReportContext, patientIds: string[], before: string) {
  if (patientIds.length === 0) return new Set<string>();
  const rows = await prisma.appointment.findMany({
    where: { clinicId: ctx.clinicId, status: { in: [...doneStatuses] }, patientId: { in: patientIds }, date: { lt: dayStart(before) }, ...(ctx.professional ? { professional: ctx.professional } : {}) },
    distinct: ["patientId"],
    select: { patientId: true },
  });
  return new Set(rows.map((row) => row.patientId));
}

export function loadCatalog(ctx: ReportContext): Promise<ProcedureCatalogEntry[]> {
  return memo(ctx, "catalog", () => queryCatalog(ctx));
}

async function queryCatalog(ctx: ReportContext): Promise<ProcedureCatalogEntry[]> {
  const procedures = await prisma.procedure.findMany({
    where: { clinicId: ctx.clinicId },
    select: { name: true, price: true, technicalSheet: { where: { product: { clinicId: ctx.clinicId } }, select: { quantity: true, product: { select: { costCents: true } } } } },
  });
  return procedures.map((procedure): ProcedureCatalogEntry => {
    // Custo de material só é conhecido com ficha técnica E custo cadastrado em todos os itens (costCents 0 = sem custo, não R$ 0,00).
    const sheet = procedure.technicalSheet;
    // PROFESSIONAL (escopo forçado) nunca recebe custo de material nem margem (derivam do custo de estoque): aplicado aqui, no dado.
    const reason = ctx.access.forcedProfessional ? "restricted" : sheet.length === 0 ? "no_sheet" : sheet.some((item) => item.product.costCents <= 0) ? "item_without_cost" : null;
    return {
      name: procedure.name,
      priceCents: Math.round(procedure.price * 100),
      // Custo unitário de material arredondado ao centavo: cada execução vale um número inteiro de centavos e o total do
      // procedimento (execuções × custo) bate exatamente com a soma das execuções (planilha de detalhe).
      materialCostCents: reason ? null : Math.round(sheet.reduce((sum, item) => sum + item.quantity * item.product.costCents, 0)),
      materialCostReason: reason,
    };
  });
}

async function loadPayments(ctx: ReportContext, window: ReportRange) {
  const rows = await prisma.payment.findMany({ where: { clinicId: ctx.clinicId, status: "Pago", date: windowOf(window) }, select: { valueCents: true, date: true } });
  return rows.map((row) => ({ day: clinicToday(row.date), value: row.valueCents }));
}

async function loadExpenses(ctx: ReportContext, window: ReportRange) {
  const rows = await prisma.expense.findMany({
    where: { clinicId: ctx.clinicId, status: "paid", paidOn: { gte: new Date(`${window.start}T00:00:00Z`), lte: new Date(`${window.end}T00:00:00Z`) } },
    select: { amountCents: true, category: true, paidOn: true },
  });
  return rows.flatMap((row) => (row.paidOn ? [{ day: dateOnly(row.paidOn), value: row.amountCents, category: row.category }] : []));
}

export function loadQuotes(ctx: ReportContext, window: ReportRange): Promise<QuoteRow[]> {
  return memo(ctx, `quotes:${window.start}:${window.end}`, () => queryQuotes(ctx, window));
}

async function queryQuotes(ctx: ReportContext, window: ReportRange): Promise<QuoteRow[]> {
  const bounds = windowOf(window);
  // Quote.expires é data de calendário (meia-noite UTC): limites em UTC, sem o deslocamento da clínica.
  const expiresBounds = { gte: new Date(`${window.start}T00:00:00Z`), lt: new Date(`${addDays(window.end, 1)}T00:00:00Z`) };
  const rows = await prisma.quote.findMany({
    where: { clinicId: ctx.clinicId, ...(ctx.professional ? { createdBy: ctx.professional } : {}), OR: [{ createdAt: bounds }, { approvedAt: bounds }, { refusedAt: bounds }, { expires: expiresBounds }] },
    select: { status: true, totalCents: true, createdAt: true, sentAt: true, approvedAt: true, refusedAt: true, expires: true },
  });
  return rows.map((row) => ({
    status: row.status,
    totalCents: row.totalCents,
    createdDay: clinicToday(row.createdAt),
    sentDay: row.sentAt ? clinicToday(row.sentAt) : null,
    approvedDay: row.approvedAt ? clinicToday(row.approvedAt) : null,
    refusedDay: row.refusedAt ? clinicToday(row.refusedAt) : null,
    expiresDay: row.expires ? dateOnly(row.expires) : null,
    createdAtMs: row.createdAt.getTime(),
    sentAtMs: row.sentAt ? row.sentAt.getTime() : null,
    approvedAtMs: row.approvedAt ? row.approvedAt.getTime() : null,
  }));
}

// Pacientes novos no período. Sem profissional: cadastrados no período. Com profissional: cadastrados no período
// que tiveram atendimento realizado com ele no período.
async function newPatientDays(ctx: ReportContext, range: ReportRange, doneRows: AppointmentRow[]) {
  const where = { clinicId: ctx.clinicId, createdAt: windowOf(range) };
  if (!ctx.professional) return (await prisma.patient.findMany({ where, select: { createdAt: true } })).map((row) => clinicToday(row.createdAt));
  const ids = [...new Set(doneRows.map((row) => row.patientId))];
  if (ids.length === 0) return [];
  return (await prisma.patient.findMany({ where: { ...where, id: { in: ids } }, select: { createdAt: true } })).map((row) => clinicToday(row.createdAt));
}

async function periodMetrics(ctx: ReportContext, range: ReportRange, rows: AppointmentRow[], payments: Array<{ day: string; value: number }> | null) {
  const done = doneInRange(rows, range);
  const patientIds = [...new Set(done.map((row) => row.patientId))];
  const [prior, newDays] = await Promise.all([priorDonePatients(ctx, patientIds, range.start), newPatientDays(ctx, range, done)]);
  const revenueCents = payments ? payments.filter((payment) => payment.day >= range.start && payment.day <= range.end).reduce((sum, payment) => sum + payment.value, 0) : null;
  return { done, rate: returnRate(patientIds, prior), newPatients: newDays.length, revenueCents, avgTicketCents: averageTicket(revenueCents, done.length) };
}

const limitations = { revenueByProfessional: "payment_without_professional", categories: "category_not_registered" } as const;

// ---------- Visão geral ----------

export async function overviewReport(ctx: ReportContext) {
  const window = span(ctx);
  const revenueAllowed = ctx.access.capabilities.finance && !ctx.professional;
  const [rows, payments, teamRows, quoteRows] = await Promise.all([
    loadAppointments(ctx, window),
    revenueAllowed ? loadPayments(ctx, window) : Promise.resolve(null),
    ctx.access.canChooseProfessional ? prisma.appointment.groupBy({ by: ["professional"], where: { clinicId: ctx.clinicId } }) : Promise.resolve([]),
    ctx.access.capabilities.quotes ? loadQuotes(ctx, window) : Promise.resolve(null),
  ]);
  const [current, previous] = await Promise.all([periodMetrics(ctx, ctx.range, rows, payments), ctx.previous ? periodMetrics(ctx, ctx.previous, rows, payments) : Promise.resolve(null)]);

  const buckets = reportBuckets(ctx.range, ctx.granularity);
  const previousBuckets = ctx.previous ? reportBuckets(ctx.previous, ctx.granularity) : null;
  const countSeries = (list: Bucket[], range: ReportRange) => sumByBucket(list, doneInRange(rows, range).map((row) => ({ day: row.day, value: 1 })));
  const moneySeries = (list: Bucket[]) => sumByBucket(list, payments ?? []);
  const appointmentsSeries = alignSeries(buckets, countSeries(buckets, ctx.range), previousBuckets && ctx.previous ? countSeries(previousBuckets, ctx.previous) : null);
  const revenueSeries = payments ? alignSeries(buckets, moneySeries(buckets), previousBuckets ? moneySeries(previousBuckets) : null) : null;

  const catalog = await loadCatalog(ctx);
  const procedures = procedureStats(current.done, catalog);
  const quoteNow = quoteRows ? quoteStats(quoteRows, ctx.range, ctx.today) : null;
  const quotePrev = quoteRows && ctx.previous ? quoteStats(quoteRows, ctx.previous, ctx.today) : null;
  const insights = buildInsights({
    revenue: payments && previous ? { current: current.revenueCents, previous: previous.revenueCents } : null,
    procedures: procedures.rows.map((row) => ({ name: row.name, executions: row.executions })),
    professionals: ctx.professional ? null : professionalStats(current.done, catalog).map((row) => ({ name: row.name, done: row.done })),
    weekdayCounts: weekdayCounts(current.done),
    returnRate: { current: current.rate.value, previous: previous ? previous.rate.value : null },
    quoteConversion: quoteNow && quotePrev ? { current: quoteNow.conversionPct, previous: quotePrev.conversionPct } : null,
  });

  const withChange = (value: number | null, prev: number | null | undefined) => ({ value, previous: prev ?? null, changePct: changePct(value, prev ?? null) });
  return {
    range: ctx.range,
    previousRange: ctx.previous,
    appliedProfessional: ctx.professional,
    capabilities: ctx.access.capabilities,
    cards: {
      appointments: withChange(current.done.length, previous?.done.length),
      revenue: revenueAllowed ? withChange(current.revenueCents, previous?.revenueCents) : null,
      revenueLimitation: !ctx.access.capabilities.finance ? "forbidden" : ctx.professional ? limitations.revenueByProfessional : null,
      newPatients: withChange(current.newPatients, previous?.newPatients),
      returnRate: { value: current.rate.value, previous: previous ? previous.rate.value : null, changePp: changePp(current.rate.value, previous ? previous.rate.value : null) },
      avgTicket: revenueAllowed ? withChange(current.avgTicketCents, previous?.avgTicketCents) : null,
      avgTicketNote: "Aproximação gerencial: receita recebida no período ÷ atendimentos realizados; pagamento não é vinculado ao atendimento.",
    },
    series: { granularity: ctx.granularity, appointments: appointmentsSeries, revenue: revenueSeries },
    insights,
    professionals: teamRows.map((row) => row.professional).sort((a, b) => a.localeCompare(b, "pt-BR")),
  };
}

// ---------- Procedimentos ----------

export async function proceduresReport(ctx: ReportContext) {
  const [rows, catalog] = await Promise.all([loadAppointments(ctx, ctx.range), loadCatalog(ctx)]);
  const stats = procedureStats(doneInRange(rows, ctx.range), catalog);
  const { distribution, totalCents } = tableDistribution(stats.rows);
  return {
    range: ctx.range,
    appliedProfessional: ctx.professional,
    valueLabel: "Valor de tabela (execuções × preço cadastrado; não é receita)",
    totalExecutions: stats.totalExecutions,
    tableTotalCents: stats.tableTotalCents,
    pricedExecutions: stats.pricedExecutions,
    rows: stats.rows,
    distribution,
    totalCents,
    categories: null,
    limitation: limitations.categories,
  };
}

// ---------- Profissionais ----------

export async function professionalsReport(ctx: ReportContext) {
  const [rows, catalog] = await Promise.all([loadAppointments(ctx, ctx.range), loadCatalog(ctx)]);
  const inRange = rows.filter((row) => row.day >= ctx.range.start && row.day <= ctx.range.end);
  return {
    range: ctx.range,
    appliedProfessional: ctx.professional,
    rows: professionalStats(inRange, catalog),
    cancellationRateNote: "Cancelados ÷ (realizados + cancelados + faltas); agendamentos ainda em aberto não entram.",
    revenue: null,
    limitation: limitations.revenueByProfessional,
  };
}

// ---------- Clientes ----------

async function clientMetrics(ctx: ReportContext, range: ReportRange, rows: AppointmentRow[]) {
  const done = doneInRange(rows, range);
  const patientIds = [...new Set(done.map((row) => row.patientId))];
  const effectiveEnd = range.end > ctx.today ? ctx.today : range.end;
  const [prior, newDays, groups] = await Promise.all([
    priorDonePatients(ctx, patientIds, range.start),
    newPatientDays(ctx, range, done),
    prisma.appointment.groupBy({
      by: ["patientId"],
      where: { clinicId: ctx.clinicId, status: { in: [...doneStatuses] }, date: { lt: dayStart(addDays(effectiveEnd, 1)) }, ...(ctx.professional ? { professional: ctx.professional } : {}) },
      _count: { _all: true },
      _max: { date: true },
    }),
  ]);
  const cumulative = groups.flatMap((group) => (group._max.date ? [{ patientId: group.patientId, doneCount: group._count._all, lastDay: clinicToday(group._max.date) }] : []));
  return clientStats({ range, today: ctx.today, periodDone: done, cumulative, priorPatientIds: prior, newPatients: newDays.length });
}

export async function clientsReport(ctx: ReportContext) {
  const window = span(ctx);
  const rows = await loadAppointments(ctx, window);
  const [stats, previousStats] = await Promise.all([clientMetrics(ctx, ctx.range, rows), ctx.previous ? clientMetrics(ctx, ctx.previous, rows) : Promise.resolve(null)]);
  // Evolução da base: pacientes cadastrados (com filtro de profissional: os que têm algum agendamento com ele).
  const baseWhere = { clinicId: ctx.clinicId, ...(ctx.professional ? { appointments: { some: { clinicId: ctx.clinicId, professional: ctx.professional } } } : {}) };
  const buckets = reportBuckets(ctx.range, ctx.granularity);
  const [baseCount, created] = await Promise.all([
    prisma.patient.count({ where: { ...baseWhere, createdAt: { lt: dayStart(ctx.range.start) } } }),
    prisma.patient.findMany({ where: { ...baseWhere, createdAt: windowOf(ctx.range) }, select: { createdAt: true } }),
  ]);
  return {
    range: ctx.range,
    previousRange: ctx.previous,
    appliedProfessional: ctx.professional,
    stats,
    previous: previousStats ? { newPatients: previousStats.newPatients, returnRate: previousStats.returnRate.value, returnRateChangePp: changePp(stats.returnRate.value, previousStats.returnRate.value), newPatientsChangePct: changePct(stats.newPatients, previousStats.newPatients) } : null,
    baseSeries: { granularity: ctx.granularity, points: cumulativeSeries(buckets, baseCount, created.map((row) => clinicToday(row.createdAt))) },
  };
}

// ---------- Orçamentos ----------

export async function quotesReport(ctx: ReportContext) {
  const rows = await loadQuotes(ctx, span(ctx));
  const buckets = reportBuckets(ctx.range, ctx.granularity);
  const stats = quoteStats(rows, ctx.range, ctx.today);
  const previousStats = ctx.previous ? quoteStats(rows, ctx.previous, ctx.today) : null;
  return {
    range: ctx.range,
    previousRange: ctx.previous,
    appliedProfessional: ctx.professional,
    professionalNote: ctx.professional ? "Orçamentos criados por este usuário." : null,
    stats,
    previous: previousStats,
    changes: previousStats ? { conversionPp: changePp(stats.conversionPct, previousStats.conversionPct), approvedValuePct: changePct(stats.approvedValueCents, previousStats.approvedValueCents) } : null,
    series: {
      granularity: ctx.granularity,
      created: sumByBucket(buckets, rows.filter((quote) => quote.createdDay >= ctx.range.start && quote.createdDay <= ctx.range.end).map((quote) => ({ day: quote.createdDay, value: 1 }))).map((value, index) => ({ label: buckets[index].label, date: buckets[index].start, value })),
      approved: sumByBucket(buckets, rows.filter((quote) => (quote.status === "Aprovado" || quote.status === "Pago") && quote.approvedDay).map((quote) => ({ day: quote.approvedDay as string, value: 1 }))).map((value, index) => ({ label: buckets[index].label, date: buckets[index].start, value })),
    },
    links: { quotes: "/orcamentos" },
  };
}

// ---------- Financeiro ----------

export async function financeReport(ctx: ReportContext) {
  const window = span(ctx);
  const [payments, expenses] = await Promise.all([loadPayments(ctx, window), loadExpenses(ctx, window)]);
  const within = <T extends { day: string }>(list: T[], range: ReportRange) => list.filter((item) => item.day >= range.start && item.day <= range.end);
  const total = (list: Array<{ value: number }>) => list.reduce((sum, item) => sum + item.value, 0);
  const summaryFor = (range: ReportRange) => financeSummary(total(within(payments, range)), total(within(expenses, range)));
  const summary = summaryFor(ctx.range);
  const previousSummary = ctx.previous ? summaryFor(ctx.previous) : null;
  const buckets = reportBuckets(ctx.range, ctx.granularity);
  const previousBuckets = ctx.previous ? reportBuckets(ctx.previous, ctx.granularity) : null;
  const revenue = alignSeries(buckets, sumByBucket(buckets, payments), previousBuckets ? sumByBucket(previousBuckets, payments) : null);
  const expensesSeries = alignSeries(buckets, sumByBucket(buckets, expenses), previousBuckets ? sumByBucket(previousBuckets, expenses) : null);
  const byCategory = new Map<string, number>();
  for (const expense of within(expenses, ctx.range)) byCategory.set(expense.category, (byCategory.get(expense.category) ?? 0) + expense.value);
  return {
    range: ctx.range,
    previousRange: ctx.previous,
    // Pagamento não tem profissional: o filtro de profissional não se aplica ao financeiro.
    appliedProfessional: null,
    limitation: ctx.requestedProfessional || ctx.professional ? limitations.revenueByProfessional : null,
    summary,
    previous: previousSummary,
    changes: previousSummary ? { revenuePct: changePct(summary.revenueCents, previousSummary.revenueCents), expensesPct: changePct(summary.expensesCents, previousSummary.expensesCents), resultPct: changePct(summary.resultCents, previousSummary.resultCents), marginPp: changePp(summary.marginPct, previousSummary.marginPct) } : null,
    series: { granularity: ctx.granularity, revenue, expenses: expensesSeries },
    expensesByCategory: [...byCategory.entries()].map(([category, valueCents]) => ({ category, valueCents })).sort((a, b) => b.valueCents - a.valueCents),
    links: { finance: "/financeiro", payments: "/pagamentos" },
  };
}

// ---------- Estoque ----------

export async function stockReport(ctx: ReportContext) {
  const bounds = windowOf(ctx.range);
  const movements = await prisma.stockMovement.findMany({
    where: {
      clinicId: ctx.clinicId,
      product: { clinicId: ctx.clinicId },
      // Só saída de consumo de atendimento ainda válida: exclui entradas, ajustes de contagem, saídas manuais e as estornadas.
      type: "attendance",
      reversedBy: null,
      OR: [{ attendanceDate: bounds }, { attendanceDate: null, createdAt: bounds }],
      ...(ctx.professional ? { appointment: { is: { clinicId: ctx.clinicId, professional: ctx.professional } } } : {}),
    },
    select: { quantity: true, createdAt: true, attendanceDate: true, product: { select: { id: true, name: true, unit: true, costCents: true } }, appointment: { select: { procedure: true, status: true } } },
  });
  const buckets = reportBuckets(ctx.range, ctx.granularity);
  const stats = consumptionStats(
    movements.map((movement) => ({
      productId: movement.product.id,
      productName: movement.product.name,
      unit: movement.product.unit,
      costCents: ctx.access.forcedProfessional ? 0 : movement.product.costCents, // PROFESSIONAL não recebe custo
      quantity: -movement.quantity,
      day: clinicToday(movement.attendanceDate ?? movement.createdAt),
      appointmentProcedure: movement.appointment?.procedure ?? null,
      appointmentDone: movement.appointment ? movement.appointment.status === "Atendido" || movement.appointment.status === "Finalizado" : false,
    })),
    buckets,
  );
  return {
    range: ctx.range,
    appliedProfessional: ctx.professional,
    costNote: ctx.access.forcedProfessional ? "Custos não são exibidos para o seu perfil (escopo de profissional)." : stats.movementsWithoutCost > 0 ? `Custo estimado pelo custo atual do item. ${stats.movementsWithoutCost} movimento(s) de itens sem custo cadastrado ficaram fora (custo "—", não R$ 0,00).` : "Custo estimado pelo custo atual do item.",
    granularity: ctx.granularity,
    ...stats,
  };
}
