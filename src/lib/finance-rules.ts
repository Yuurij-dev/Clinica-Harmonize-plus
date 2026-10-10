// Regras financeiras puras (sem banco). Importadas direto pelo node:test,
// por isso não usam o atalho "@/" nem sintaxe que exija compilação.
// Datas no formato YYYY-MM-DD, já no fuso da clínica. Despesas em centavos;
// pagamentos de pacientes ainda são guardados em reais inteiros.

export const financePeriods = ["today", "week", "month"] as const;
export type FinancePeriod = (typeof financePeriods)[number];
export type DateRange = { start: string; end: string };
export type ExpenseStatus = "open" | "paid" | "cancelled";

export const expenseCategories = [
  "Materiais/Estoque",
  "Aluguel",
  "Salários/Comissões",
  "Marketing",
  "Impostos",
  "Contas (água/luz/internet)",
  "Equipamentos",
  "Outros",
] as const;

const dayMs = 86_400_000;

function toUtc(date: string) {
  return Date.parse(`${date}T00:00:00Z`);
}

function fromUtc(time: number) {
  return new Date(time).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number) {
  return fromUtc(toUtc(date) + days * dayMs);
}

export function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Soma meses mantendo o dia; se o mês não tem esse dia, usa o último dia do mês.
export function addMonths(date: string, months: number, day = Number(date.slice(8, 10))) {
  const [year, month] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const targetYear = target.getUTCFullYear();
  const targetMonth = target.getUTCMonth() + 1;
  const targetDay = Math.min(day, lastDayOfMonth(targetYear, targetMonth));
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

// Divide o total em parcelas mensais que somam exatamente o total; o resto dos centavos vai na primeira.
export function splitInstallments(totalCents: number, count: number, firstDueOn: string) {
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    amountCents: base + (index === 0 ? remainder : 0),
    dueOn: addMonths(firstDueOn, index),
  }));
}

export function isFinancePeriod(value: unknown): value is FinancePeriod {
  return typeof value === "string" && (financePeriods as readonly string[]).includes(value);
}

export function periodRange(period: FinancePeriod, today: string): DateRange {
  if (period === "today") return { start: today, end: today };
  if (period === "week") {
    const weekday = new Date(toUtc(today)).getUTCDay();
    const start = addDays(today, -((weekday + 6) % 7));
    return { start, end: addDays(start, 6) };
  }
  const [year, month] = today.split("-").map(Number);
  const lastDay = lastDayOfMonth(year, month);
  const prefix = today.slice(0, 7);
  return { start: `${prefix}-01`, end: `${prefix}-${String(lastDay).padStart(2, "0")}` };
}

export function inRange(date: string | null | undefined, range: DateRange) {
  return Boolean(date) && (date as string) >= range.start && (date as string) <= range.end;
}

type PaymentInput = { value: number; status: string; date: string };
type ExpenseInput = { amountCents: number; status: string; dueOn: string; paidOn: string | null };

export function financeTotals({ range, payments, expenses }: { range: DateRange; payments: PaymentInput[]; expenses: ExpenseInput[] }) {
  const paymentsInRange = payments.filter((payment) => inRange(payment.date, range));
  const receivedCents = paymentsInRange.filter((payment) => payment.status === "Pago").reduce((sum, payment) => sum + Math.round(payment.value * 100), 0);
  const pendingReceivableCents = paymentsInRange.filter((payment) => payment.status !== "Pago").reduce((sum, payment) => sum + Math.round(payment.value * 100), 0);
  const expensesCents = expenses.filter((expense) => expense.status === "paid" && inRange(expense.paidOn, range)).reduce((sum, expense) => sum + expense.amountCents, 0);
  const payableCents = expenses.filter((expense) => expense.status === "open" && inRange(expense.dueOn, range)).reduce((sum, expense) => sum + expense.amountCents, 0);
  return {
    revenueCents: receivedCents,
    receivedCents,
    pendingReceivableCents,
    expensesCents,
    resultCents: receivedCents - expensesCents,
    payableCents,
  };
}
