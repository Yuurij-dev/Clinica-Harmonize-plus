// Regras puras dos Relatórios (sem banco). Importadas direto pelo node:test.
// Datas em YYYY-MM-DD no fuso da clínica. Valores em centavos. Definições completas em docs/reports.md.
import { addDays, addMonths, lastDayOfMonth } from "./finance-rules.ts";
import { parseDateOnly } from "./clinic-time.ts";

export const MAX_RANGE_DAYS = 366;
// Datas aceitas em from/to (e no período anterior calculado): anos 2000 a 2100.
export const MIN_REPORT_DAY = "2000-01-01";
export const MAX_REPORT_DAY = "2100-12-31";
// Paciente "inativo": já foi atendido alguma vez e não tem atendimento realizado nos últimos 90 dias até o fim do período.
export const INACTIVE_DAYS = 90;

export const reportPeriods = ["today", "last7", "last30", "month", "prevMonth", "year", "custom"] as const;
export type ReportPeriod = (typeof reportPeriods)[number];
export type ReportRange = { start: string; end: string };
export type ResolvedRange = ReportRange & { period: ReportPeriod; days: number };

export const reportGranularities = ["day", "week", "month"] as const;
export type ReportGranularity = (typeof reportGranularities)[number];

export function isReportGranularity(value: unknown): value is ReportGranularity {
  return typeof value === "string" && (reportGranularities as readonly string[]).includes(value);
}

export function isReportPeriod(value: unknown): value is ReportPeriod {
  return typeof value === "string" && (reportPeriods as readonly string[]).includes(value);
}

const dayMs = 86_400_000;

export function daysBetween(start: string, end: string) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / dayMs);
}

export function rangeDays(range: ReportRange) {
  return daysBetween(range.start, range.end) + 1;
}

// Resolve o período no servidor. Com from+to (ou period=custom) usa as datas; senão o preset (padrão last30).
//  today: hoje; last7/last30: últimos 7/30 dias terminando hoje; month: dia 1 do mês até hoje;
//  prevMonth: mês calendário anterior inteiro; year: 1º de janeiro até hoje.
export function resolveReportRange(input: { period?: string | null; from?: string | null; to?: string | null }, today: string): { ok: true; range: ResolvedRange } | { ok: false; message: string } {
  const period = input.period || (input.from || input.to ? "custom" : "last30");
  if (!isReportPeriod(period)) return { ok: false, message: "Período inválido." };
  let start: string;
  let end: string;
  if (period === "custom") {
    if (!input.from || !input.to || !parseDateOnly(input.from) || !parseDateOnly(input.to)) return { ok: false, message: "Datas inválidas (use AAAA-MM-DD)." };
    start = input.from;
    end = input.to;
    if (start > end) return { ok: false, message: "A data inicial deve ser anterior ou igual à final." };
    if (start < MIN_REPORT_DAY || end > MAX_REPORT_DAY) return { ok: false, message: "Use datas entre os anos 2000 e 2100." };
  } else if (period === "today") {
    start = today;
    end = today;
  } else if (period === "last7") {
    start = addDays(today, -6);
    end = today;
  } else if (period === "last30") {
    start = addDays(today, -29);
    end = today;
  } else if (period === "month") {
    start = `${today.slice(0, 7)}-01`;
    end = today;
  } else if (period === "prevMonth") {
    const first = addMonths(`${today.slice(0, 7)}-01`, -1, 1);
    start = first;
    end = `${first.slice(0, 7)}-${String(lastDayOfMonth(Number(first.slice(0, 4)), Number(first.slice(5, 7)))).padStart(2, "0")}`;
  } else {
    start = `${today.slice(0, 4)}-01-01`;
    end = today;
  }
  const days = daysBetween(start, end) + 1;
  if (days > MAX_RANGE_DAYS) return { ok: false, message: `O período pode ter no máximo ${MAX_RANGE_DAYS} dias.` };
  return { ok: true, range: { period, start, end, days } };
}

// Período anterior equivalente: mesma duração em dias, imediatamente antes do início.
export function previousReportRange(range: ReportRange): ReportRange {
  const days = rangeDays(range);
  return { start: addDays(range.start, -days), end: addDays(range.start, -1) };
}

// Período anterior para comparação; null se sairia do intervalo aceito (sem comparação em vez de erro).
export function comparisonRange(range: ReportRange): ReportRange | null {
  const previous = previousReportRange(range);
  return previous.start < MIN_REPORT_DAY ? null : previous;
}

// Variação percentual; anterior 0 (ou ausente) -> null. Divide por |anterior|: com anterior negativo
// (ex.: resultado), -100 -> 50 dá +150% (melhora), não -150%.
export function changePct(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

// Diferença em pontos percentuais (para taxas).
export function changePp(current: number | null, previous: number | null) {
  if (current === null || previous === null) return null;
  return current - previous;
}

export function defaultGranularity(days: number): ReportGranularity {
  if (days <= 31) return "day";
  if (days <= 120) return "week";
  return "month";
}

// ---------- Séries ----------

const monthLabels = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dayLabel = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
export type Bucket = { index: number; key: string; label: string; start: string; end: string };

// Intervalos do período: dia a dia; blocos de 7 dias a partir do início (o último pode ser menor,
// para a série anterior alinhar por posição); ou meses calendário que o período toca (recortados ao período).
export function reportBuckets(range: ReportRange, granularity: ReportGranularity): Bucket[] {
  const buckets: Bucket[] = [];
  const push = (key: string, label: string, start: string, end: string) => buckets.push({ index: buckets.length, key, label, start, end });
  if (granularity === "day") {
    for (let date = range.start; date <= range.end; date = addDays(date, 1)) push(date, dayLabel(date), date, date);
  } else if (granularity === "week") {
    for (let start = range.start; start <= range.end; start = addDays(start, 7)) {
      const end = addDays(start, 6) > range.end ? range.end : addDays(start, 6);
      push(start, `${dayLabel(start)} – ${dayLabel(end)}`, start, end);
    }
  } else {
    for (let first = `${range.start.slice(0, 7)}-01`; first <= range.end; first = addMonths(first, 1, 1)) {
      const last = `${first.slice(0, 7)}-${String(lastDayOfMonth(Number(first.slice(0, 4)), Number(first.slice(5, 7)))).padStart(2, "0")}`;
      push(first.slice(0, 7), `${monthLabels[Number(first.slice(5, 7)) - 1]}/${first.slice(2, 4)}`, first < range.start ? range.start : first, last > range.end ? range.end : last);
    }
  }
  return buckets;
}

// Índice do intervalo que contém o dia (busca binária); -1 fora do período.
export function bucketIndex(buckets: Bucket[], day: string) {
  let low = 0;
  let high = buckets.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (day < buckets[mid].start) high = mid - 1;
    else if (day > buckets[mid].end) low = mid + 1;
    else return mid;
  }
  return -1;
}

// Soma valores por intervalo. Itens fora do período são ignorados.
export function sumByBucket(buckets: Bucket[], items: Array<{ day: string; value: number }>) {
  const totals = buckets.map(() => 0);
  for (const item of items) {
    const index = bucketIndex(buckets, item.day);
    if (index >= 0) totals[index] += item.value;
  }
  return totals;
}

export type SeriesPoint = { label: string; date: string; current: number; previous: number | null };

// Alinha a série atual com a anterior pela posição do intervalo; sem anterior (ou posição inexistente) -> null.
export function alignSeries(current: Bucket[], currentValues: number[], previousValues: number[] | null): SeriesPoint[] {
  return current.map((bucket, index) => ({ label: bucket.label, date: bucket.start, current: currentValues[index] ?? 0, previous: previousValues ? (previousValues[index] ?? null) : null }));
}

// ---------- Atendimentos ----------

export const doneStatuses = ["Atendido", "Finalizado"] as const;
export const cancelledStatus = "Cancelado";
export const missedStatus = "Faltou";

// Realizado = Atendido ou Finalizado (mesma regra de appointment-list-rules e patient-list-server).
export function isDoneStatus(status: string) {
  return status === "Atendido" || status === "Finalizado";
}

export type AppointmentRow = { day: string; patientId: string; procedure: string; professional: string; status: string; time?: string };

export function inReportRange(day: string, range: ReportRange) {
  return day >= range.start && day <= range.end;
}

export function doneInRange(rows: AppointmentRow[], range: ReportRange) {
  return rows.filter((row) => isDoneStatus(row.status) && inReportRange(row.day, range));
}

// Taxa de retorno: dos pacientes com realizado no período, % que já tinham realizado antes do início.
export function returnRate(periodPatientIds: Iterable<string>, priorPatientIds: ReadonlySet<string>) {
  const unique = new Set(periodPatientIds);
  if (unique.size === 0) return { value: null as number | null, returning: 0, total: 0 };
  let returning = 0;
  for (const id of unique) if (priorPatientIds.has(id)) returning += 1;
  return { value: (returning / unique.size) * 100, returning, total: unique.size };
}

// Ticket médio gerencial: receita recebida ÷ atendimentos realizados (null sem receita conhecida ou sem atendimentos).
export function averageTicket(revenueCents: number | null, doneCount: number) {
  if (revenueCents === null || doneCount <= 0) return null;
  return Math.round(revenueCents / doneCount);
}

// Dia da semana (0 = domingo) de um YYYY-MM-DD.
export function weekdayOf(day: string) {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

export function weekdayCounts(rows: AppointmentRow[]) {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const row of rows) counts[weekdayOf(row.day)] += 1;
  return counts;
}

// materialCostCents = null quando o custo é DESCONHECIDO: sem ficha técnica ou algum item da ficha sem custo cadastrado
// (Product.costCents = 0 significa "sem custo", não R$ 0,00). materialCostReason diz qual dos dois casos.
// "restricted" = PROFESSIONAL (escopo forçado) não recebe custo (nem margem): desconhecido por restrição, não por falta de dado.
export type MaterialCostReason = "no_sheet" | "item_without_cost" | "restricted";
export type ProcedureCatalogEntry = { name: string; priceCents: number; materialCostCents: number | null; materialCostReason?: MaterialCostReason | null };

// Procedimentos: execuções (realizados por nome), valor de tabela (execuções × preço de tabela, NÃO é receita),
// custo de material e margem de contribuição só com ficha técnica.
export function procedureStats(done: AppointmentRow[], catalog: ProcedureCatalogEntry[]) {
  const byName = new Map(catalog.map((entry) => [entry.name, entry]));
  const counts = new Map<string, number>();
  for (const row of done) counts.set(row.procedure, (counts.get(row.procedure) ?? 0) + 1);
  const rows = [...counts.entries()].map(([name, executions]) => {
    const entry = byName.get(name);
    const tableValueCents = entry ? executions * entry.priceCents : null;
    const materialCostCents = entry && entry.materialCostCents !== null ? Math.round(executions * entry.materialCostCents) : null;
    const marginCents = tableValueCents !== null && materialCostCents !== null ? tableValueCents - materialCostCents : null;
    return {
      name,
      executions,
      matched: Boolean(entry),
      costKnown: materialCostCents !== null,
      materialCostReason: (materialCostCents !== null ? null : (entry?.materialCostReason ?? "no_sheet")) as MaterialCostReason | null,
      unitPriceCents: entry ? entry.priceCents : null,
      tableValueCents,
      materialCostCents,
      marginCents,
      marginPct: marginCents !== null && tableValueCents ? (marginCents / tableValueCents) * 100 : null,
    };
  });
  // Total de tabela: null (desconhecido, "sem preço cadastrado") quando há execuções e NENHUMA linha tem valor conhecido;
  // parcial (só as conhecidas) quando algumas não têm preço. Sem execuções = 0 real. `pricedExecutions` = execuções com preço.
  const knownRows = rows.filter((row) => row.tableValueCents !== null);
  const tableTotalCents: number | null = rows.length === 0 ? 0 : knownRows.length === 0 ? null : knownRows.reduce((sum, row) => sum + (row.tableValueCents ?? 0), 0);
  const pricedExecutions = knownRows.reduce((sum, row) => sum + row.executions, 0);
  const withShare = rows
    .map((row) => ({ ...row, tableSharePct: row.tableValueCents !== null && tableTotalCents !== null && tableTotalCents > 0 ? (row.tableValueCents / tableTotalCents) * 100 : null }))
    .sort((a, b) => b.executions - a.executions || a.name.localeCompare(b.name, "pt-BR"));
  return { rows: withShare, totalExecutions: done.length, tableTotalCents, pricedExecutions };
}

// Distribuição para o gráfico de rosca: top N procedimentos por valor de tabela + "Outros" (agregado).
// Procedimentos sem preço de tabela (sem cadastro) ficam de fora; pct sobre o total de tabela.
export function tableDistribution(rows: Array<{ name: string; tableValueCents: number | null }>, topN = 5) {
  const valued = rows.filter((row): row is { name: string; tableValueCents: number } => row.tableValueCents !== null && row.tableValueCents > 0).sort((a, b) => b.tableValueCents - a.tableValueCents || a.name.localeCompare(b.name, "pt-BR"));
  const totalCents = valued.reduce((sum, row) => sum + row.tableValueCents, 0);
  const pct = (value: number) => (totalCents > 0 ? (value / totalCents) * 100 : 0);
  const distribution = valued.slice(0, topN).map((row) => ({ name: row.name, valueCents: row.tableValueCents, pct: pct(row.tableValueCents) }));
  const others = valued.slice(topN).reduce((sum, row) => sum + row.tableValueCents, 0);
  if (valued.length > topN) distribution.push({ name: "Outros", valueCents: others, pct: pct(others) });
  return { distribution, totalCents };
}

// Profissionais: realizados, cancelados, faltas e taxa de cancelamento = cancelados ÷ (realizados + cancelados + faltas).
// Agendado/Em atendimento ficam de fora (ainda não têm desfecho). Produção de tabela como em procedureStats.
export function professionalStats(rows: AppointmentRow[], catalog: ProcedureCatalogEntry[]) {
  const priceByName = new Map(catalog.map((entry) => [entry.name, entry.priceCents]));
  type Acc = { done: number; cancelled: number; missed: number; tableValueCents: number; unpriced: number; patients: Set<string> };
  const byProfessional = new Map<string, Acc>();
  for (const row of rows) {
    const acc = byProfessional.get(row.professional) ?? { done: 0, cancelled: 0, missed: 0, tableValueCents: 0, unpriced: 0, patients: new Set<string>() };
    if (isDoneStatus(row.status)) {
      acc.done += 1;
      const price = priceByName.get(row.procedure);
      if (price === undefined) acc.unpriced += 1; // procedimento sem cadastro: sem preço (desconhecido, não R$ 0,00)
      else acc.tableValueCents += price;
      acc.patients.add(row.patientId);
    } else if (row.status === cancelledStatus) acc.cancelled += 1;
    else if (row.status === missedStatus) acc.missed += 1;
    byProfessional.set(row.professional, acc);
  }
  const result = [...byProfessional.entries()].map(([name, acc]) => {
    const outcomes = acc.done + acc.cancelled + acc.missed;
    return {
      name,
      done: acc.done,
      cancelled: acc.cancelled,
      missed: acc.missed,
      patients: acc.patients.size,
      cancellationRatePct: outcomes > 0 ? (acc.cancelled / outcomes) * 100 : null,
      // Valor parcial quando só parte das execuções tem preço; null quando há execuções e TODAS são sem preço.
      // Ticket = valor ÷ execuções com preço.
      unpricedExecutions: acc.unpriced,
      tableValueCents: acc.done > 0 && acc.unpriced === acc.done ? null : acc.tableValueCents,
      tableTicketCents: acc.done - acc.unpriced > 0 ? Math.round(acc.tableValueCents / (acc.done - acc.unpriced)) : null,
    };
  });
  return result.filter((row) => row.done + row.cancelled + row.missed > 0).sort((a, b) => b.done - a.done || a.name.localeCompare(b.name, "pt-BR"));
}

// Clientes. `cumulative` traz, por paciente, o total de realizados e o último realizado ATÉ o fim do período.
export type PatientCumulative = { patientId: string; doneCount: number; lastDay: string };

export function clientStats({ range, today, periodDone, cumulative, priorPatientIds, newPatients }: { range: ReportRange; today: string; periodDone: AppointmentRow[]; cumulative: PatientCumulative[]; priorPatientIds: ReadonlySet<string>; newPatients: number }) {
  const periodPatients = new Set(periodDone.map((row) => row.patientId));
  const cumulativeById = new Map(cumulative.map((entry) => [entry.patientId, entry]));
  let recurring = 0;
  for (const id of periodPatients) if ((cumulativeById.get(id)?.doneCount ?? 0) >= 2) recurring += 1;
  // O fim efetivo nunca passa de hoje: período futuro não pode "inativar" ninguém por dias que ainda não ocorreram.
  const effectiveEnd = range.end > today ? today : range.end;
  const cutoff = addDays(effectiveEnd, -INACTIVE_DAYS);
  const inactive = cumulative.filter((entry) => entry.lastDay <= cutoff).length;
  const rate = returnRate(periodPatients, priorPatientIds);
  return {
    newPatients,
    attendedPatients: periodPatients.size,
    recurring,
    inactive,
    inactiveDays: INACTIVE_DAYS,
    averageFrequency: periodPatients.size > 0 ? periodDone.length / periodPatients.size : null,
    returnRate: rate,
  };
}

// Evolução da base: pacientes cadastrados acumulados no fim de cada intervalo (base = cadastrados antes do período).
export function cumulativeSeries(buckets: Bucket[], baseCount: number, createdDays: string[]) {
  const perBucket = sumByBucket(buckets, createdDays.map((day) => ({ day, value: 1 })));
  let running = baseCount;
  return buckets.map((bucket, index) => {
    running += perBucket[index];
    return { label: bucket.label, date: bucket.start, newPatients: perBucket[index], totalPatients: running };
  });
}

// ---------- Orçamentos ----------

export const openQuoteStatuses = ["Rascunho", "Pendente", "Enviado"] as const;
export const approvedQuoteStatuses = ["Aprovado", "Pago"] as const;

export type QuoteRow = {
  status: string;
  totalCents: number;
  createdDay: string;
  sentDay: string | null;
  approvedDay: string | null;
  refusedDay: string | null;
  expiresDay: string | null;
  // Instantes em ms para o tempo médio (aprovação − envio, ou criação).
  createdAtMs: number;
  sentAtMs: number | null;
  approvedAtMs: number | null;
};

export function isApprovedQuote(status: string) {
  return status === "Aprovado" || status === "Pago";
}

// Expirado (derivado): aberto (Rascunho/Pendente/Enviado) com validade anterior a hoje.
export function isQuoteExpired(quote: Pick<QuoteRow, "status" | "expiresDay">, today: string) {
  return (openQuoteStatuses as readonly string[]).includes(quote.status) && Boolean(quote.expiresDay) && (quote.expiresDay as string) < today;
}

// Orçamentos: criados no período; aprovados (approvedAt no período, status Aprovado|Pago); recusados (refusedAt no período);
// expirados (abertos com validade dentro do período e anterior a hoje); conversão = dos criados no período, % hoje Aprovado|Pago;
// valor aprovado; tempo médio de aprovação em dias (null sem aprovados).
export function quoteStats(quotes: QuoteRow[], range: ReportRange, today: string) {
  const created = quotes.filter((quote) => inReportRange(quote.createdDay, range));
  const approved = quotes.filter((quote) => isApprovedQuote(quote.status) && quote.approvedDay !== null && inReportRange(quote.approvedDay, range));
  const refused = quotes.filter((quote) => quote.refusedDay !== null && inReportRange(quote.refusedDay, range));
  const expired = quotes.filter((quote) => isQuoteExpired(quote, today) && inReportRange(quote.expiresDay as string, range));
  const convertedFromCreated = created.filter((quote) => isApprovedQuote(quote.status)).length;
  const durations = approved
    .map((quote) => (quote.approvedAtMs !== null ? (quote.approvedAtMs - (quote.sentAtMs ?? quote.createdAtMs)) / 86_400_000 : null))
    .filter((value): value is number => value !== null && value >= 0);
  return {
    created: created.length,
    approved: approved.length,
    refused: refused.length,
    expired: expired.length,
    conversionPct: created.length > 0 ? (convertedFromCreated / created.length) * 100 : null,
    approvedValueCents: approved.reduce((sum, quote) => sum + quote.totalCents, 0),
    averageApprovalDays: durations.length > 0 ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null,
  };
}

// ---------- Financeiro ----------

export function financeSummary(revenueCents: number, expensesCents: number) {
  const resultCents = revenueCents - expensesCents;
  return { revenueCents, expensesCents, resultCents, marginPct: revenueCents > 0 ? (resultCents / revenueCents) * 100 : null };
}

// ---------- Estoque ----------

export type ConsumptionRow = { productId: string; productName: string; unit: string; costCents: number; quantity: number; day: string; appointmentProcedure: string | null; appointmentDone: boolean };

// Consumo por produto e por procedimento. Custo estimado pelo custo ATUAL do item; costCents <= 0 = custo NÃO cadastrado
// (desconhecido): o custo fica `null` (nunca R$ 0,00) e o movimento entra em missingCostMovements. Totais somam só o conhecido.
// Por procedimento: só movimentos ligados a um agendamento realizado.
export function consumptionStats(rows: ConsumptionRow[], buckets: Bucket[]) {
  const known = (row: ConsumptionRow) => row.costCents > 0;
  const costOf = (row: ConsumptionRow) => (known(row) ? row.quantity * row.costCents : 0);
  const byProduct = new Map<string, { productId: string; name: string; unit: string; quantity: number; cost: number; costKnown: boolean }>();
  const byProcedure = new Map<string, { name: string; cost: number; movements: number; missing: number }>();
  for (const row of rows) {
    const product = byProduct.get(row.productId) ?? { productId: row.productId, name: row.productName, unit: row.unit, quantity: 0, cost: 0, costKnown: known(row) };
    product.quantity += row.quantity;
    product.cost += costOf(row);
    byProduct.set(row.productId, product);
    if (row.appointmentProcedure && row.appointmentDone) {
      const entry = byProcedure.get(row.appointmentProcedure) ?? { name: row.appointmentProcedure, cost: 0, movements: 0, missing: 0 };
      entry.cost += costOf(row);
      entry.movements += 1;
      if (!known(row)) entry.missing += 1;
      byProcedure.set(row.appointmentProcedure, entry);
    }
  }
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const byCost = (a: { estimatedCostCents: number | null; name: string }, b: { estimatedCostCents: number | null; name: string }) => (b.estimatedCostCents ?? -1) - (a.estimatedCostCents ?? -1) || a.name.localeCompare(b.name, "pt-BR");
  const movementsWithoutCost = rows.filter((row) => !known(row)).length;
  return {
    byProduct: [...byProduct.values()]
      .map((entry) => ({ productId: entry.productId, name: entry.name, unit: entry.unit, quantity: round(entry.quantity), costKnown: entry.costKnown, estimatedCostCents: entry.costKnown ? Math.round(entry.cost) : null }))
      .sort(byCost),
    byProcedure: [...byProcedure.values()]
      .map((entry) => ({ name: entry.name, movements: entry.movements, missingCostMovements: entry.missing, costKnown: entry.missing < entry.movements, estimatedCostCents: entry.missing < entry.movements ? Math.round(entry.cost) : null }))
      .sort(byCost),
    // Soma só dos movimentos com custo; `null` quando há consumo e nenhum item tem custo cadastrado.
    totalEstimatedCostCents: rows.length > 0 && movementsWithoutCost === rows.length ? null : Math.round(rows.reduce((sum, row) => sum + costOf(row), 0)),
    movementsWithoutCost,
    series: sumByBucket(buckets, rows.map((row) => ({ day: row.day, value: costOf(row) }))).map((value, index) => ({ label: buckets[index].label, date: buckets[index].start, estimatedCostCents: Math.round(value) })),
  };
}
