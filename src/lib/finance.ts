import type { Expense, Prisma } from "@prisma/client";
import { clinicToday, dateOnly, parseDateOnly } from "./clinic-time";
import { addDays, expenseCategories, isFinancePeriod, nextRecurringDue, periodRange, recurringFrequencies, recurringOccurrences, type FinancePeriod } from "./finance-rules";
import { prisma } from "./prisma";

// Listas de orçamentos e pagamentos: no máximo listLimit linhas por consulta; a tela avisa quando há mais (hasMore)
// e o filtro de datas (?from&to) vai ao servidor, então registros antigos continuam alcançáveis.
export const listLimit = 200;

// Período opcional ?from=AAAA-MM-DD&to=AAAA-MM-DD em dias da clínica (São Paulo); {} sem filtro, null se a data for inválida.
export function listPeriodFilter(searchParams: URLSearchParams) {
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if ((from && !parseDateOnly(from)) || (to && !parseDateOnly(to))) return null;
  return { ...(from ? { gte: new Date(`${from}T00:00:00-03:00`) } : {}), ...(to ? { lt: new Date(`${addDays(to, 1)}T00:00:00-03:00`) } : {}) };
}

export function requestedPeriod(request: Request): FinancePeriod {
  const value = new URL(request.url).searchParams.get("period");
  return isFinancePeriod(value) ? value : "month";
}

export function rangeFor(period: FinancePeriod, date = clinicToday()) {
  return periodRange(period, date);
}

// Data de referência opcional ?date=AAAA-MM-DD (padrão: hoje); null se inválida.
export function requestedReference(searchParams: URLSearchParams) {
  const value = searchParams.get("date");
  if (value === null || value === "") return clinicToday();
  return parseDateOnly(value) ? value : null;
}

// Paginação ?page&pageSize: página >= 1 (até maxPage), tamanho 1..maxPageSize; null se inválido.
export function parsePagination(searchParams: URLSearchParams, { defaultPageSize = 10, maxPageSize = 50, maxPage = 1000 } = {}) {
  const rawPage = searchParams.get("page");
  const rawSize = searchParams.get("pageSize");
  const page = rawPage === null || rawPage === "" ? 1 : Number(rawPage);
  const pageSize = rawSize === null || rawSize === "" ? defaultPageSize : Number(rawSize);
  if (!Number.isInteger(page) || page < 1 || page > maxPage || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > maxPageSize) return null;
  return { page, pageSize, skip: (page - 1) * pageSize };
}

// Limites (timestamptz) de um intervalo de dias da clínica: [início do primeiro dia, início do dia seguinte ao último).
export function paymentDayBounds(range: { start?: string; end?: string }) {
  return { ...(range.start ? { gte: new Date(`${range.start}T00:00:00-03:00`) } : {}), ...(range.end ? { lt: new Date(`${addDays(range.end, 1)}T00:00:00-03:00`) } : {}) };
}

// Limites de um campo DATE com intervalo opcional.
export function optionalDateBounds(range: { start?: string; end?: string }) {
  return { ...(range.start ? { gte: new Date(`${range.start}T00:00:00Z`) } : {}), ...(range.end ? { lte: new Date(`${range.end}T00:00:00Z`) } : {}) };
}

// Intervalo opcional ?from&to (AAAA-MM-DD); null se alguma data for inválida ou from > to.
export function requestedDateRange(searchParams: URLSearchParams) {
  const start = searchParams.get("from") || undefined;
  const end = searchParams.get("to") || undefined;
  if ((start && !parseDateOnly(start)) || (end && !parseDateOnly(end)) || (start && end && start > end)) return null;
  return { start, end };
}

// Limites em UTC de um intervalo de datas do campo DATE (meia-noite UTC).
export function dateBounds(range: { start: string; end: string }) {
  return { gte: new Date(`${range.start}T00:00:00Z`), lte: new Date(`${range.end}T00:00:00Z`) };
}

export function isExpenseCategory(value: unknown): value is (typeof expenseCategories)[number] {
  return typeof value === "string" && (expenseCategories as readonly string[]).includes(value);
}

export function serializeExpense(expense: Pick<Expense, "id" | "description" | "category" | "amountCents" | "dueOn" | "paymentMethod" | "status" | "paidOn" | "source">) {
  return { ...expense, dueOn: dateOnly(expense.dueOn), paidOn: expense.paidOn ? dateOnly(expense.paidOn) : null };
}

export const expenseSelect = { id: true, description: true, category: true, amountCents: true, dueOn: true, paymentMethod: true, status: true, paidOn: true, source: true } as const;

// Cria como "a pagar" as ocorrências que faltam das despesas fixas até o fim do mês atual
// (assim o card "A pagar" já mostra as do mês). O índice único (despesa fixa + data)
// e o skipDuplicates garantem que abrir o Financeiro duas vezes não duplica nada.
export async function ensureRecurringOccurrences(clinicId: string, db: Prisma.TransactionClient | typeof prisma = prisma, recurringExpenseId?: string) {
  const until = periodRange("month", clinicToday()).end;
  const recurring = await db.recurringExpense.findMany({
    where: { clinicId, ...(recurringExpenseId ? { id: recurringExpenseId } : {}), startsOn: { lte: new Date(`${until}T00:00:00Z`) } },
    select: { id: true, description: true, category: true, amountCents: true, paymentMethod: true, frequency: true, weekday: true, dayOfMonth: true, month: true, startsOn: true, endsOn: true, expenses: { select: { occurrenceOn: true } } },
  });
  const data = recurring.flatMap((item) => recurringOccurrences(
    { frequency: item.frequency, weekday: item.weekday, dayOfMonth: item.dayOfMonth, month: item.month, startsOn: dateOnly(item.startsOn), endsOn: item.endsOn ? dateOnly(item.endsOn) : null },
    until,
    item.expenses.flatMap((expense) => expense.occurrenceOn ? [dateOnly(expense.occurrenceOn)] : []),
  ).map((date) => {
    const day = new Date(`${date}T00:00:00Z`);
    return { clinicId, description: item.description, category: item.category, amountCents: item.amountCents, dueOn: day, paymentMethod: item.paymentMethod, status: "open", source: "recurring", recurringExpenseId: item.id, occurrenceOn: day };
  }));
  if (data.length) await db.expense.createMany({ data, skipDuplicates: true });
}

// O banco guarda centavos; a API de pagamentos e orçamentos continua em reais.
// Maior valor em reais que cabe no Int (centavos) do banco.
export const maxPaymentReais = 21_474_836.47;

export function toCents(reais: number) {
  return Math.max(0, Math.round(reais * 100));
}

export function serializePayment<T extends { valueCents: number }>({ valueCents, ...payment }: T) {
  return { ...payment, value: valueCents / 100 };
}

export function serializeQuote<T extends { totalCents: number }>({ totalCents, ...quote }: T) {
  return { ...quote, total: totalCents / 100 };
}

export const recurringSelect = { id: true, description: true, category: true, amountCents: true, paymentMethod: true, frequency: true, weekday: true, dayOfMonth: true, month: true, startsOn: true, endsOn: true } as const;

export function serializeRecurring<T extends { startsOn: Date; endsOn: Date | null }>(item: T) {
  return { ...item, startsOn: dateOnly(item.startsOn), endsOn: item.endsOn ? dateOnly(item.endsOn) : null };
}

// Valida o agendamento: semanal precisa do dia da semana; mensal, do dia; anual, do dia e do mês.
export function parseRecurringSchedule(body: Record<string, unknown> | null) {
  const frequency = body?.frequency;
  if (!(recurringFrequencies as readonly unknown[]).includes(frequency)) return null;
  const weekday = Number(body?.weekday);
  const dayOfMonth = Number(body?.dayOfMonth);
  const month = Number(body?.month);
  if (frequency === "weekly") return Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? { frequency, weekday, dayOfMonth: null, month: null } : null;
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return null;
  if (frequency === "monthly") return { frequency, weekday: null, dayOfMonth, month: null };
  return Number.isInteger(month) && month >= 1 && month <= 12 ? { frequency: frequency as string, weekday: null, dayOfMonth, month } : null;
}

// Próximo vencimento, situação dele e vencidas em aberto de cada despesa fixa (2 consultas no total, sem N+1).
export async function recurringNextInfo(clinicId: string, items: Array<{ id: string; frequency: string; weekday: number | null; dayOfMonth: number | null; month: number | null; startsOn: Date; endsOn: Date | null }>, today = clinicToday()) {
  const info = new Map<string, { nextDueOn: string | null; nextStatus: string | null; overdueCount: number }>();
  if (!items.length) return info;
  const ids = items.map((item) => item.id);
  const todayDate = new Date(`${today}T00:00:00Z`);
  const [upcoming, overdue] = await Promise.all([
    prisma.expense.findMany({ where: { clinicId, recurringExpenseId: { in: ids }, occurrenceOn: { gte: todayDate } }, select: { recurringExpenseId: true, occurrenceOn: true, status: true } }),
    prisma.expense.groupBy({ by: ["recurringExpenseId"], where: { clinicId, recurringExpenseId: { in: ids }, status: "open", dueOn: { lt: todayDate } }, _count: { _all: true } }),
  ]);
  const statuses = new Map(upcoming.flatMap((expense) => expense.recurringExpenseId && expense.occurrenceOn ? [[`${expense.recurringExpenseId}|${dateOnly(expense.occurrenceOn)}`, expense.status] as const] : []));
  const overdueById = new Map(overdue.flatMap((row) => row.recurringExpenseId ? [[row.recurringExpenseId, row._count._all] as const] : []));
  for (const item of items) {
    const nextDueOn = nextRecurringDue({ frequency: item.frequency, weekday: item.weekday, dayOfMonth: item.dayOfMonth, month: item.month, startsOn: dateOnly(item.startsOn), endsOn: item.endsOn ? dateOnly(item.endsOn) : null }, today);
    info.set(item.id, { nextDueOn, nextStatus: nextDueOn ? statuses.get(`${item.id}|${nextDueOn}`) ?? "open" : null, overdueCount: overdueById.get(item.id) ?? 0 });
  }
  return info;
}
