// Regras financeiras puras (sem banco). Importadas direto pelo node:test,
// por isso não usam o atalho "@/" nem sintaxe que exija compilação.
// Datas no formato YYYY-MM-DD, já no fuso da clínica. Despesas em centavos;
// pagamentos de pacientes também em centavos.

export const financePeriods = ["today", "week", "month"] as const;
export type FinancePeriod = (typeof financePeriods)[number];
export type DateRange = { start: string; end: string };
export type ExpenseStatus = "open" | "paid" | "cancelled";

export const expenseCategories = [
  "Estoque",
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

type PaymentInput = { valueCents: number; status: string; date: string };
type ExpenseInput = { amountCents: number; status: string; dueOn: string; paidOn: string | null };

export function financeTotals({ range, payments, expenses }: { range: DateRange; payments: PaymentInput[]; expenses: ExpenseInput[] }) {
  const paymentsInRange = payments.filter((payment) => inRange(payment.date, range));
  const receivedCents = paymentsInRange.filter((payment) => payment.status === "Pago").reduce((sum, payment) => sum + payment.valueCents, 0);
  const pendingReceivableCents = paymentsInRange.filter((payment) => payment.status !== "Pago").reduce((sum, payment) => sum + payment.valueCents, 0);
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

export const recurringFrequencies = ["weekly", "monthly", "yearly"] as const;
export type RecurringFrequency = (typeof recurringFrequencies)[number];
export type RecurringSchedule = { frequency: string; weekday?: number | null; dayOfMonth?: number | null; month?: number | null; startsOn: string; endsOn: string | null };

function cycleKey(frequency: string, date: string) {
  if (frequency === "monthly") return date.slice(0, 7);
  if (frequency === "yearly") return date.slice(0, 4);
  return periodRange("week", date).start;
}

// Datas de vencimento de uma despesa fixa entre o início e min(fim, até), sem as que já existem.
// Semanal: dia da semana (0 = domingo). Mensal: dia do mês, ou o último dia se o mês for menor.
// Anual: dia e mês; 29/02 vira 28/02 nos anos sem esse dia.
export function recurringOccurrences(schedule: RecurringSchedule, until: string, existing: string[] = []) {
  const last = schedule.endsOn && schedule.endsOn < until ? schedule.endsOn : until;
  const dates: string[] = [];
  if (schedule.frequency === "weekly") {
    const startWeekday = new Date(toUtc(schedule.startsOn)).getUTCDay();
    for (let date = addDays(schedule.startsOn, ((schedule.weekday ?? 0) - startWeekday + 7) % 7); date <= last; date = addDays(date, 7)) dates.push(date);
  } else if (schedule.frequency === "monthly") {
    const monthStart = `${schedule.startsOn.slice(0, 7)}-01`;
    for (let index = 0; ; index += 1) {
      const date = addMonths(monthStart, index, schedule.dayOfMonth ?? 1);
      if (date > last) break;
      if (date >= schedule.startsOn) dates.push(date);
    }
  } else if (schedule.frequency === "yearly") {
    const month = String(schedule.month ?? 1).padStart(2, "0");
    for (let year = Number(schedule.startsOn.slice(0, 4)); ; year += 1) {
      const date = addMonths(`${year}-${month}-01`, 0, schedule.dayOfMonth ?? 1);
      if (date > last) break;
      if (date >= schedule.startsOn) dates.push(date);
    }
  }
  // Uma ocorrência por ciclo (mês, ano ou semana seg–dom): se o ciclo já tem uma, de qualquer status,
  // não gera outra (evita duplicar depois de mudar a agenda).
  const cycles = new Set(existing.map((date) => cycleKey(schedule.frequency, date)));
  return dates.filter((date) => !cycles.has(cycleKey(schedule.frequency, date)));
}

// Período imediatamente anterior ao selecionado, do mesmo tipo (dia, semana seg–dom ou mês cheio).
export function previousRange(period: FinancePeriod, range: DateRange): DateRange {
  if (period === "today") return { start: addDays(range.start, -1), end: addDays(range.start, -1) };
  if (period === "week") return { start: addDays(range.start, -7), end: addDays(range.start, -1) };
  return periodRange("month", addDays(range.start, -1));
}

// Contagens que acompanham financeTotals: pendências a receber e despesas a pagar no período.
export function financeCounts({ range, payments, expenses }: { range: DateRange; payments: PaymentInput[]; expenses: ExpenseInput[] }) {
  return {
    pendingReceivable: payments.filter((payment) => payment.status !== "Pago" && inRange(payment.date, range)).length,
    payable: expenses.filter((expense) => expense.status === "open" && inRange(expense.dueOn, range)).length,
  };
}

export const flowGranularities = ["day", "week", "month"] as const;
export type FlowGranularity = (typeof flowGranularities)[number];

export function isFlowGranularity(value: unknown): value is FlowGranularity {
  return typeof value === "string" && (flowGranularities as readonly string[]).includes(value);
}

const monthLabels = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dayLabel = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

// Intervalos do gráfico de fluxo: dias do período; semanas (seg–dom) que cobrem o período;
// ou 6 meses terminando no mês da referência.
export function flowBuckets(granularity: FlowGranularity, range: DateRange, reference: string) {
  const buckets: Array<{ key: string; label: string; start: string; end: string }> = [];
  if (granularity === "day") {
    for (let date = range.start; date <= range.end; date = addDays(date, 1)) buckets.push({ key: date, label: dayLabel(date), start: date, end: date });
  } else if (granularity === "week") {
    const weekday = new Date(toUtc(range.start)).getUTCDay();
    for (let start = addDays(range.start, -((weekday + 6) % 7)); start <= range.end; start = addDays(start, 7)) {
      const end = addDays(start, 6);
      buckets.push({ key: start, label: `${dayLabel(start)} – ${dayLabel(end)}`, start, end });
    }
  } else {
    for (let offset = -5; offset <= 0; offset += 1) {
      const first = addMonths(`${reference.slice(0, 7)}-01`, offset, 1);
      const monthRange = periodRange("month", first);
      buckets.push({ key: first.slice(0, 7), label: `${monthLabels[Number(first.slice(5, 7)) - 1]}/${first.slice(2, 4)}`, ...monthRange });
    }
  }
  return buckets;
}

// Série do fluxo financeiro com o mesmo critério de caixa de financeTotals:
// receita = pagamento "Pago" na data; despesa = despesa "paid" na data do pagamento.
export function financeSeries({ granularity, range, reference, payments, expenses }: { granularity: FlowGranularity; range: DateRange; reference: string; payments: PaymentInput[]; expenses: ExpenseInput[] }) {
  return flowBuckets(granularity, range, reference).map((bucket) => {
    const window = { start: bucket.start, end: bucket.end };
    return {
      key: bucket.key,
      label: bucket.label,
      revenueCents: payments.filter((payment) => payment.status === "Pago" && inRange(payment.date, window)).reduce((sum, payment) => sum + payment.valueCents, 0),
      expensesCents: expenses.filter((expense) => expense.status === "paid" && inRange(expense.paidOn, window)).reduce((sum, expense) => sum + expense.amountCents, 0),
    };
  });
}

// Intervalo total coberto pela série (para buscar os dados de uma vez).
export function flowWindow(granularity: FlowGranularity, range: DateRange, reference: string): DateRange {
  const buckets = flowBuckets(granularity, range, reference);
  return { start: buckets[0].start, end: buckets[buckets.length - 1].end };
}

// Valor mensal equivalente de uma despesa fixa: semanal ×52/12, anual ÷12, mensal igual.
export function monthlyEquivalentCents(frequency: string, amountCents: number) {
  if (frequency === "weekly") return Math.round((amountCents * 52) / 12);
  if (frequency === "yearly") return Math.round(amountCents / 12);
  return amountCents;
}

// Próximo vencimento (>= hoje) de uma despesa fixa; null se encerrada antes ou sem agenda válida.
export function nextRecurringDue(schedule: RecurringSchedule, today: string) {
  if (schedule.endsOn && schedule.endsOn < today) return null;
  const startsOn = schedule.startsOn > today ? schedule.startsOn : today;
  const dates = recurringOccurrences({ ...schedule, startsOn }, addDays(startsOn, 400));
  return dates[0] ?? null;
}

// Início do ciclo (mês, ano ou semana seg–dom) que contém a data.
export function recurringCycleStart(frequency: string, date: string) {
  if (frequency === "monthly") return `${date.slice(0, 7)}-01`;
  if (frequency === "yearly") return `${date.slice(0, 4)}-01-01`;
  return periodRange("week", date).start;
}

export function isRecurringActive(endsOn: string | null, today: string) {
  return !endsOn || endsOn >= today;
}

export type AccountStatus = "open" | "overdue" | "settled";

// Situação de uma conta: quitada, vencida (em aberto antes de hoje) ou em aberto.
export function accountStatus(settled: boolean, dueOn: string, today: string): AccountStatus {
  if (settled) return "settled";
  return dueOn < today ? "overdue" : "open";
}

export function recurringScheduleChanged(current: { frequency: string; weekday: number | null; dayOfMonth: number | null; month: number | null }, next: { frequency: string; weekday: number | null; dayOfMonth: number | null; month: number | null }) {
  return current.frequency !== next.frequency || current.weekday !== next.weekday || current.dayOfMonth !== next.dayOfMonth || current.month !== next.month;
}

export type MovementItem = { kind: "revenue" | "expense"; date: string };

// Junta duas listas já ordenadas (cada uma na ordem do banco) pela data e devolve a janela [offset, offset+limit).
// Em empate de data, receitas primeiro; a ordem interna de cada lista é preservada.
export function mergeMovements<R extends MovementItem, E extends MovementItem>(revenues: R[], expenses: E[], sort: "asc" | "desc", offset: number, limit: number) {
  const merged: Array<R | E> = [];
  let r = 0;
  let e = 0;
  while (merged.length < offset + limit && (r < revenues.length || e < expenses.length)) {
    const takeRevenue = e >= expenses.length || (r < revenues.length && (sort === "desc" ? revenues[r].date >= expenses[e].date : revenues[r].date <= expenses[e].date));
    merged.push(takeRevenue ? revenues[r++] : expenses[e++]);
  }
  return merged.slice(offset, offset + limit);
}
