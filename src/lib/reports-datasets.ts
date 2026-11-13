// Datasets de servidor dos Relatórios para as exportações/documentos (Prisma). Complementam reports-server.ts sem alterar as
// respostas existentes. TODA query leva o clinicId da sessão (ctx.clinicId); agregação no banco (groupBy/count/aggregate) e
// listas limitadas (MAX_TABLE_ROWS) com o total real; nenhum dado de paciente ou clínico (só contagens, valores e rótulos).
import type { Prisma } from "@prisma/client";
import { clinicToday, dateOnly } from "./clinic-time";
import { addDays } from "./finance-rules";
import { prisma } from "./prisma";
import { MAX_TABLE_ROWS } from "./reports-document";
import { appointmentStats, doneSeries, executionSeries, procedureProfessionals, professionalExtras, quoteFunnel, visitDistribution } from "./reports-extra-rules";
import { doneInRange, type ReportRange } from "./reports-rules";
import { dayStart, loadAppointments, loadCatalog, loadQuotes, span, windowOf, type ReportContext } from "./reports-server";
import { consumptionByProcedure, consumptionByProduct, movementNote, stockPosition, summarizeMovements, type MovementProduct } from "./reports-stock-rules";
import { clinicWarningDays, lotBalances } from "./stock";

// Datas de calendário (Expense.dueOn/paidOn) são meia-noite UTC.
const calendarBounds = (range: ReportRange) => ({ gte: new Date(`${range.start}T00:00:00Z`), lte: new Date(`${range.end}T00:00:00Z`) });

// ---------- Agendamentos ----------

export async function appointmentsReport(ctx: ReportContext) {
  const rows = await loadAppointments(ctx, span(ctx));
  const stats = appointmentStats({ rows, range: ctx.range, previous: ctx.previous, granularity: ctx.granularity, today: ctx.today });
  return { range: ctx.range, previousRange: ctx.previous, appliedProfessional: ctx.professional, granularity: ctx.granularity, ...stats };
}

// ---------- Procedimentos / Profissionais / Orçamentos / Clientes (complementos) ----------

export async function proceduresExtras(ctx: ReportContext) {
  const [rows, catalog] = await Promise.all([loadAppointments(ctx, span(ctx)), loadCatalog(ctx)]);
  return {
    professionals: procedureProfessionals(doneInRange(rows, ctx.range)),
    series: executionSeries({ rows, catalog, range: ctx.range, previous: ctx.previous, granularity: ctx.granularity }),
    granularity: ctx.granularity,
  };
}

export async function professionalsExtras(ctx: ReportContext) {
  const rows = await loadAppointments(ctx, span(ctx));
  const inRange = rows.filter((row) => row.day >= ctx.range.start && row.day <= ctx.range.end);
  return {
    byProfessional: [...professionalExtras(inRange).entries()].map(([name, extra]) => ({ name, ...extra })),
    doneSeries: doneSeries(rows, ctx.range, ctx.previous, ctx.granularity),
    granularity: ctx.granularity,
  };
}

export async function quotesExtras(ctx: ReportContext) {
  const rows = await loadQuotes(ctx, span(ctx));
  return { funnel: quoteFunnel(rows, ctx.range, ctx.today), previousFunnel: ctx.previous ? quoteFunnel(rows, ctx.previous, ctx.today) : null };
}

// Total cadastrado até o fim do período (com profissional: pacientes com algum agendamento com ele, como a evolução da base)
// e distribuição de pacientes por nº de atendimentos realizados no período.
export async function clientsExtras(ctx: ReportContext) {
  const baseWhere = { clinicId: ctx.clinicId, ...(ctx.professional ? { appointments: { some: { clinicId: ctx.clinicId, professional: ctx.professional } } } : {}) };
  const [totalRegistered, rows] = await Promise.all([
    prisma.patient.count({ where: { ...baseWhere, createdAt: { lt: dayStart(addDays(ctx.range.end, 1)) } } }),
    loadAppointments(ctx, ctx.range),
  ]);
  return { totalRegistered, visits: visitDistribution(doneInRange(rows, ctx.range)) };
}

// ---------- Financeiro (previsto x recebido x pago) ----------

export async function financeExtras(ctx: ReportContext) {
  const current = ctx.range;
  const bounds = windowOf(current);
  const pending = (range: ReportRange) => prisma.payment.aggregate({ where: { clinicId: ctx.clinicId, status: { not: "Pago" }, date: windowOf(range) }, _sum: { valueCents: true }, _count: { _all: true } });
  const payable = (range: ReportRange) => prisma.expense.aggregate({ where: { clinicId: ctx.clinicId, status: "open", dueOn: calendarBounds(range) }, _sum: { amountCents: true }, _count: { _all: true } });
  // Pagos e pendentes/parciais (despesas pagas e em aberto) são consultados separados, cada um com o seu limite e a sua contagem:
  // assim o aviso "exibindo N de M" e o total de cada tabela ficam corretos mesmo quando uma das listas é bem maior.
  const paidPaymentWhere: Prisma.PaymentWhereInput = { clinicId: ctx.clinicId, status: "Pago", date: bounds };
  const pendingPaymentWhere: Prisma.PaymentWhereInput = { clinicId: ctx.clinicId, status: { not: "Pago" }, date: bounds };
  const paidExpenseWhere: Prisma.ExpenseWhereInput = { clinicId: ctx.clinicId, status: "paid", paidOn: calendarBounds(current) };
  const openExpenseWhere: Prisma.ExpenseWhereInput = { clinicId: ctx.clinicId, status: "open", dueOn: calendarBounds(current) };
  // Sem paciente: só data, forma, parcelas, status e valor.
  const paymentList = (where: Prisma.PaymentWhereInput) => prisma.payment.findMany({ where, orderBy: [{ date: "desc" }, { id: "asc" }], take: MAX_TABLE_ROWS, select: { date: true, method: true, installments: true, status: true, valueCents: true } });
  const expenseList = (where: Prisma.ExpenseWhereInput) => prisma.expense.findMany({ where, orderBy: [{ dueOn: "desc" }, { id: "asc" }], take: MAX_TABLE_ROWS, select: { dueOn: true, paidOn: true, category: true, status: true, amountCents: true } });
  const [byMethod, pendingNow, pendingPrev, payableNow, payablePrev, paidRows, paidCount, pendingRows, pendingCount, paidExpenseRows, paidExpenseCount, openExpenseRows, openExpenseCount] = await Promise.all([
    prisma.payment.groupBy({ by: ["method"], where: paidPaymentWhere, _sum: { valueCents: true }, _count: { _all: true } }),
    pending(current),
    ctx.previous ? pending(ctx.previous) : Promise.resolve(null),
    payable(current),
    ctx.previous ? payable(ctx.previous) : Promise.resolve(null),
    paymentList(paidPaymentWhere),
    prisma.payment.count({ where: paidPaymentWhere }),
    paymentList(pendingPaymentWhere),
    prisma.payment.count({ where: pendingPaymentWhere }),
    expenseList(paidExpenseWhere),
    prisma.expense.count({ where: paidExpenseWhere }),
    expenseList(openExpenseWhere),
    prisma.expense.count({ where: openExpenseWhere }),
  ]);
  const paymentRows = (rows: typeof paidRows) => rows.map((row) => ({ date: clinicToday(row.date), method: row.method, installments: row.installments, status: row.status, valueCents: row.valueCents }));
  const expenseRows = (rows: typeof paidExpenseRows) => rows.map((row) => ({ dueOn: dateOnly(row.dueOn), paidOn: row.paidOn ? dateOnly(row.paidOn) : null, category: row.category, status: row.status, amountCents: row.amountCents }));
  const receivedByMethod = byMethod.map((group) => ({ method: group.method, count: group._count._all, valueCents: group._sum.valueCents ?? 0 })).sort((a, b) => b.valueCents - a.valueCents || a.method.localeCompare(b.method, "pt-BR"));
  return {
    receivedByMethod,
    receivable: { cents: pendingNow._sum.valueCents ?? 0, count: pendingNow._count._all, previousCents: pendingPrev ? (pendingPrev._sum.valueCents ?? 0) : null },
    payable: { cents: payableNow._sum.amountCents ?? 0, count: payableNow._count._all, previousCents: payablePrev ? (payablePrev._sum.amountCents ?? 0) : null },
    payments: { paid: { total: paidCount, rows: paymentRows(paidRows) }, pending: { total: pendingCount, rows: paymentRows(pendingRows) } },
    expenses: { paid: { total: paidExpenseCount, rows: expenseRows(paidExpenseRows) }, open: { total: openExpenseCount, rows: expenseRows(openExpenseRows) } },
  };
}

// ---------- Estoque ----------

// Posição ATUAL (hoje, não ao fim do período): saldo por item = soma das movimentações dos lotes (lotBalances).
export async function stockPositionDataset(ctx: ReportContext) {
  const [products, lots, balances, warningDays] = await Promise.all([
    prisma.product.findMany({ where: { clinicId: ctx.clinicId }, select: { id: true, name: true, kind: true, unit: true, costCents: true, minStock: true, archivedAt: true } }),
    prisma.stockLot.findMany({ where: { clinicId: ctx.clinicId }, select: { id: true, productId: true, expiresOn: true } }),
    lotBalances(ctx.clinicId),
    clinicWarningDays(ctx.clinicId),
  ]);
  const position = stockPosition({
    products: products.map((product) => ({ id: product.id, name: product.name, kind: product.kind, unit: product.unit, costCents: product.costCents, minStock: product.minStock, archived: Boolean(product.archivedAt) })),
    lots: lots.map((lot) => ({ productId: lot.productId, expiresOn: dateOnly(lot.expiresOn), balance: balances.get(lot.id) ?? 0 })),
    today: ctx.today,
    warningDays,
  });
  // PROFESSIONAL (escopo forçado) não vê custo: zera custo unitário/valor aqui, no dado, e sinaliza costHidden.
  if (ctx.access.forcedProfessional) {
    const items = position.items.map((item) => ({ ...item, unitCostCents: null, valueCents: null }));
    return { asOf: ctx.today, warningDays, ...position, items, summary: { ...position.summary, totalValueCents: null, itemsWithoutCost: 0 }, costHidden: true };
  }
  return { asOf: ctx.today, warningDays, ...position, costHidden: false };
}

const PROCEDURE_ROWS_LIMIT = 20_000;

// Sem texto livre (notes) nem paciente: o histórico lê só o necessário para os rótulos padronizados.
const historySelect = {
  type: true, quantity: true, reason: true, userName: true, createdAt: true, attendanceDate: true, attendanceName: true, reversesId: true,
  reversedBy: { select: { id: true } },
  product: { select: { id: true, name: true, unit: true, kind: true, costCents: true } },
  lot: { select: { code: true } },
} satisfies Prisma.StockMovementSelect;

// Movimentações do período (todos os tipos) e consumo por item/procedimento. Data do movimento = attendanceDate ?? createdAt.
// Totais ignoram pares estornados (movimentação original estornada + seu estorno). Com filtro de profissional: só consumo
// em atendimentos dele (as demais movimentações são da clínica e não têm profissional).
export async function stockMovementsDataset(ctx: ReportContext) {
  const bounds = windowOf(ctx.range);
  const base: Prisma.StockMovementWhereInput = {
    clinicId: ctx.clinicId,
    product: { clinicId: ctx.clinicId },
    lot: { clinicId: ctx.clinicId },
    OR: [{ attendanceDate: bounds }, { attendanceDate: null, createdAt: bounds }],
    ...(ctx.professional ? { type: "attendance", appointment: { is: { clinicId: ctx.clinicId, professional: ctx.professional } } } : {}),
  };
  const counted = { reversedBy: null, reversesId: null } as const;
  const grouped = (sign: "gt" | "lt") => prisma.stockMovement.groupBy({ by: ["productId", "type"], where: { ...base, ...counted, quantity: { [sign]: 0 } }, _sum: { quantity: true }, _count: { _all: true } });
  const [groupsIn, groupsOut, total, reversals, history, procedureRows] = await Promise.all([
    grouped("gt"),
    grouped("lt"),
    prisma.stockMovement.count({ where: base }),
    prisma.stockMovement.count({ where: { ...base, reversesId: { not: null } } }),
    // A data exibida é attendanceDate ?? createdAt, que o banco não ordena de uma vez: busca os N mais recentes de cada grupo
    // (com e sem attendanceDate) e junta; o corte final por data exibida é feito abaixo, então os "N mais recentes" são exatos.
    Promise.all([
      prisma.stockMovement.findMany({ where: { ...base, attendanceDate: { not: null } }, orderBy: [{ attendanceDate: "desc" }, { id: "asc" }], take: MAX_TABLE_ROWS, select: historySelect }),
      prisma.stockMovement.findMany({ where: { ...base, attendanceDate: null }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: MAX_TABLE_ROWS, select: historySelect }),
    ]).then(([dated, undated]) => [...dated, ...undated]),
    // Limitado (os mais recentes): o agrupamento por procedimento precisa do nome do agendamento, que o banco não agrupa aqui.
    prisma.stockMovement.findMany({
      where: { ...base, ...counted, type: "attendance", appointment: { is: { clinicId: ctx.clinicId, status: { in: ["Atendido", "Finalizado"] }, ...(ctx.professional ? { professional: ctx.professional } : {}) } } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: PROCEDURE_ROWS_LIMIT + 1,
      select: { productId: true, quantity: true, appointment: { select: { procedure: true } } },
    }),
  ]);
  const procedureRowsTruncated = procedureRows.length > PROCEDURE_ROWS_LIMIT;
  if (procedureRowsTruncated) procedureRows.length = PROCEDURE_ROWS_LIMIT;
  const ids = [...new Set([...groupsIn, ...groupsOut].map((group) => group.productId).concat(procedureRows.map((row) => row.productId)))];
  const productRows = ids.length ? await prisma.product.findMany({ where: { clinicId: ctx.clinicId, id: { in: ids } }, select: { id: true, name: true, unit: true, kind: true, costCents: true } }) : [];
  // PROFESSIONAL (escopo forçado) não recebe custo derivado: o custo unitário some aqui, no dado (todos os custos de
  // movimentação e consumo ficam desconhecidos) e o documento omite colunas, KPIs e gráfico de custo (costHidden).
  const costHidden = Boolean(ctx.access.forcedProfessional);
  const products = new Map<string, MovementProduct>(productRows.map((product) => [product.id, costHidden ? { ...product, costCents: 0 } : product]));
  const groups = [
    ...groupsIn.map((group) => ({ productId: group.productId, type: group.type, sign: "in" as const, quantity: group._sum.quantity ?? 0, count: group._count._all })),
    ...groupsOut.map((group) => ({ productId: group.productId, type: group.type, sign: "out" as const, quantity: group._sum.quantity ?? 0, count: group._count._all })),
  ];
  const summary = summarizeMovements(groups, products);
  const consumedGroups = groupsOut.filter((group) => group.type === "attendance").map((group) => ({ productId: group.productId, quantity: group._sum.quantity ?? 0 }));
  return {
    costHidden,
    totalMovements: total,
    reversalPairs: reversals,
    summary,
    consumption: {
      byProcedureTruncated: procedureRowsTruncated ? PROCEDURE_ROWS_LIMIT : null,
      byProduct: consumptionByProduct(consumedGroups, products),
      byProcedure: consumptionByProcedure(procedureRows.flatMap((row) => (row.appointment ? [{ productId: row.productId, quantity: row.quantity, procedure: row.appointment.procedure }] : [])), products),
    },
    history: history
      .map((row) => ({
        at: (row.attendanceDate ?? row.createdAt).toISOString(),
        type: row.type,
        reversesId: row.reversesId,
        reversed: Boolean(row.reversedBy),
        productName: row.product.name,
        unit: row.product.unit,
        quantity: row.quantity,
        lotCode: row.lot.code,
        note: movementNote({ type: row.type, reason: row.reason, attendanceName: row.attendanceName }),
        userName: row.userName,
      }))
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, MAX_TABLE_ROWS),
    professionalScoped: Boolean(ctx.professional),
  };
}

export async function stockDataset(ctx: ReportContext) {
  // Em sequência: consultas independentes, mas a exportação não deve disputar conexões do banco.
  const position = await stockPositionDataset(ctx);
  const movements = await stockMovementsDataset(ctx);
  return { position, movements };
}
