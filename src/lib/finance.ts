import type { Expense } from "@prisma/client";
import { clinicToday, dateOnly } from "./clinic-time";
import { expenseCategories, isFinancePeriod, periodRange, recurringFrequencies, recurringOccurrences, type FinancePeriod } from "./finance-rules";
import { prisma } from "./prisma";

export function requestedPeriod(request: Request): FinancePeriod {
  const value = new URL(request.url).searchParams.get("period");
  return isFinancePeriod(value) ? value : "month";
}

export function rangeFor(period: FinancePeriod) {
  return periodRange(period, clinicToday());
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
export async function ensureRecurringOccurrences(clinicId: string) {
  const until = periodRange("month", clinicToday()).end;
  const recurring = await prisma.recurringExpense.findMany({
    where: { clinicId, startsOn: { lte: new Date(`${until}T00:00:00Z`) } },
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
  if (data.length) await prisma.expense.createMany({ data, skipDuplicates: true });
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
