import type { Expense } from "@prisma/client";
import { clinicToday, dateOnly } from "./clinic-time";
import { expenseCategories, isFinancePeriod, periodRange, type FinancePeriod } from "./finance-rules";

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
