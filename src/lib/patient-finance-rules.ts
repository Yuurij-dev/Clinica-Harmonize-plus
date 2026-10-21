// Regras puras da aba Financeiro da ficha do cliente (sem banco, sem React).
// Importadas direto pelo node:test: nada de atalho "@/" aqui.

export const quoteStatusLabels: Record<string, string> = { Rascunho: "Rascunho", Pendente: "Pendente", Enviado: "Enviado", Aprovado: "Aprovado", Pago: "Pago", Recusado: "Recusado", Cancelado: "Cancelado" };

export type QuoteGroup = "open" | "approved" | "paid" | "closed";
export type QuoteGroupFilter = QuoteGroup | "all";
export const quoteGroupFilters: Array<{ id: QuoteGroupFilter; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "open", label: "Em aberto" },
  { id: "approved", label: "Aprovados" },
  { id: "paid", label: "Pagos" },
  { id: "closed", label: "Recusados/Cancelados" },
];

export type FinanceQuote = { id: string; journeyId?: string | null; items: string; status: string; total: number; createdAt?: string | null };
export type FinancePayment = { id: string; journeyId?: string | null; value: number; status: string; date?: string | null };
export type SortOrder = "recent" | "oldest";

export function quoteStatusLabel(status: string) {
  return quoteStatusLabels[status] ?? status;
}

// Status desconhecido não entra em nenhum grupo (aparece só em "Todos"): não inventamos status.
export function quoteStatusGroup(status: string): QuoteGroup | null {
  if (status === "Rascunho" || status === "Pendente" || status === "Enviado") return "open";
  if (status === "Aprovado") return "approved";
  if (status === "Pago") return "paid";
  if (status === "Recusado" || status === "Cancelado") return "closed";
  return null;
}

const cents = (value: number) => Math.round(value * 100);

export function financeIndicators(quotes: Array<Pick<FinanceQuote, "status" | "total">>) {
  let approved = 0;
  let paid = 0;
  let open = 0;
  for (const quote of quotes) {
    const group = quoteStatusGroup(quote.status);
    if (group === "approved") approved += cents(quote.total);
    else if (group === "paid") paid += cents(quote.total);
    else if (group === "open") open += 1;
  }
  return { budgetedCents: approved + paid, receivedCents: paid, toReceiveCents: approved, openCount: open };
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function time(value?: string | null) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortByDate<T>(list: T[], read: (item: T) => string | null | undefined, order: SortOrder) {
  return [...list].sort((left, right) => order === "recent" ? time(read(right)) - time(read(left)) : time(read(left)) - time(read(right)));
}

type QuoteScope = { query?: string; journeyId?: string };

function scopeQuotes<T extends FinanceQuote>(quotes: T[], { query = "", journeyId = "" }: QuoteScope) {
  const needle = normalize(query.trim());
  return quotes.filter((quote) => (!journeyId || quote.journeyId === journeyId) && (!needle || normalize(quote.items).includes(needle)));
}

export function filterQuotes<T extends FinanceQuote>(quotes: T[], filters: QuoteScope & { group?: QuoteGroupFilter; sort?: SortOrder }) {
  const group = filters.group ?? "all";
  const scoped = scopeQuotes(quotes, filters).filter((quote) => group === "all" || quoteStatusGroup(quote.status) === group);
  return sortByDate(scoped, (quote) => quote.createdAt, filters.sort ?? "recent");
}

// Contagem de cada chip respeitando busca e tratamento (mas não o próprio chip).
export function quoteGroupCounts(quotes: FinanceQuote[], scope: QuoteScope = {}): Record<QuoteGroupFilter, number> {
  const counts: Record<QuoteGroupFilter, number> = { all: 0, open: 0, approved: 0, paid: 0, closed: 0 };
  for (const quote of scopeQuotes(quotes, scope)) {
    counts.all += 1;
    const group = quoteStatusGroup(quote.status);
    if (group) counts[group] += 1;
  }
  return counts;
}

// Mesma regra do fluxo da jornada: só pagamento já registrado, orçamento recusado ou cancelado bloqueiam o registro.
export function quotePaymentBlockReason(status: string) {
  if (status === "Pago") return "Pagamento já registrado.";
  if (status === "Recusado" || status === "Cancelado") return `Orçamento ${status.toLowerCase()}.`;
  return null;
}

export type PaymentGroup = "paid" | "pending" | "other";
export type PaymentGroupFilter = PaymentGroup | "all";
export const paymentGroupFilters: Array<{ id: PaymentGroupFilter; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "paid", label: "Pagos" },
  { id: "pending", label: "Pendentes" },
  { id: "other", label: "Outros" },
];

export function paymentStatusGroup(status: string): PaymentGroup {
  if (status === "Pago") return "paid";
  if (status === "Pendente") return "pending";
  return "other";
}

type PaymentScope = { query?: string; journeyId?: string; titles?: Map<string, string> };

function scopePayments<T extends FinancePayment>(payments: T[], { query = "", journeyId = "", titles }: PaymentScope) {
  const needle = normalize(query.trim());
  return payments.filter((payment) => (!journeyId || payment.journeyId === journeyId) && (!needle || normalize(titles?.get(payment.id) ?? "pagamento").includes(needle)));
}

export function filterPayments<T extends FinancePayment>(payments: T[], filters: PaymentScope & { group?: PaymentGroupFilter; sort?: SortOrder }) {
  const group = filters.group ?? "all";
  const scoped = scopePayments(payments, filters).filter((payment) => group === "all" || paymentStatusGroup(payment.status) === group);
  return sortByDate(scoped, (payment) => payment.date, filters.sort ?? "recent");
}

export function paymentGroupCounts(payments: FinancePayment[], scope: PaymentScope = {}): Record<PaymentGroupFilter, number> {
  const counts: Record<PaymentGroupFilter, number> = { all: 0, paid: 0, pending: 0, other: 0 };
  for (const payment of scopePayments(payments, scope)) {
    counts.all += 1;
    counts[paymentStatusGroup(payment.status)] += 1;
  }
  return counts;
}

export function receivedCents(payments: FinancePayment[]) {
  return payments.reduce((sum, payment) => sum + (paymentStatusGroup(payment.status) === "paid" ? cents(payment.value) : 0), 0);
}

// O pagamento não guarda o orçamento: associa cada pagamento "Pago" a um orçamento Pago do mesmo tratamento com o mesmo valor (cada orçamento uma vez).
export function matchPaymentQuotes<Q extends FinanceQuote>(payments: FinancePayment[], quotes: Q[]) {
  const matches = new Map<string, Q>();
  const used = new Set<string>();
  const ordered = [...payments].sort((left, right) => time(left.date) - time(right.date));
  for (const payment of ordered) {
    if (paymentStatusGroup(payment.status) !== "paid") continue;
    const quote = quotes.find((item) => !used.has(item.id) && item.status === "Pago" && (item.journeyId ?? null) === (payment.journeyId ?? null) && cents(item.total) === cents(payment.value));
    if (!quote) continue;
    used.add(quote.id);
    matches.set(payment.id, quote);
  }
  return matches;
}

export function paginateList<T>(items: T[], page: number, pageSize: number) {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  return { items: items.slice((current - 1) * pageSize, current * pageSize), page: current, pages };
}

export function formatQuoteTitle(items: string) {
  return items.replace(/\((\d+)x\)/g, "($1X)");
}
