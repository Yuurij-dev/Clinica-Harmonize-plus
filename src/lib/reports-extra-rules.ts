// Regras puras complementares dos Relatórios (sem banco): agendamentos, funil de orçamentos, distribuição de visitas,
// profissionais por procedimento e evolução. Importado direto pelo node:test. Definições em docs/reports.md.
import {
  alignSeries, inReportRange, isDoneStatus, quoteStats, reportBuckets, sumByBucket, weekdayOf,
  type AppointmentRow, type ProcedureCatalogEntry, type QuoteRow, type ReportGranularity, type ReportRange, type SeriesPoint,
} from "./reports-rules.ts";

// ---------- Agendamentos ----------

export const appointmentStatuses = { scheduled: "Agendado", inProgress: "Em atendimento", cancelled: "Cancelado", missed: "Faltou" } as const;
export const weekdayNames = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"] as const;

type Outcome = { total: number; done: number; cancelled: number; missed: number; scheduled: number; inProgress: number; other: number };
const emptyOutcome = (): Outcome => ({ total: 0, done: 0, cancelled: 0, missed: 0, scheduled: 0, inProgress: 0, other: 0 });

function tally(outcome: Outcome, status: string) {
  outcome.total += 1;
  if (isDoneStatus(status)) outcome.done += 1;
  else if (status === appointmentStatuses.cancelled) outcome.cancelled += 1;
  else if (status === appointmentStatuses.missed) outcome.missed += 1;
  else if (status === appointmentStatuses.scheduled) outcome.scheduled += 1;
  else if (status === appointmentStatuses.inProgress) outcome.inProgress += 1;
  else outcome.other += 1;
}

// Comparecimento = concluídos ÷ (concluídos + faltas); cancelamento fora do denominador. Sem base = null.
export const attendanceRatePct = (outcome: Pick<Outcome, "done" | "missed">) => (outcome.done + outcome.missed > 0 ? (outcome.done / (outcome.done + outcome.missed)) * 100 : null);
// Cancelamento = cancelados ÷ total de agendamentos do período (inclui os ainda em aberto).
export const cancellationRatePct = (outcome: Pick<Outcome, "total" | "cancelled">) => (outcome.total > 0 ? (outcome.cancelled / outcome.total) * 100 : null);

export function appointmentStats(input: { rows: AppointmentRow[]; range: ReportRange; previous: ReportRange | null; granularity: ReportGranularity; today: string }) {
  const inRange = input.rows.filter((row) => inReportRange(row.day, input.range));
  const totals = emptyOutcome();
  const byProfessional = new Map<string, Outcome>();
  const weekdays = weekdayNames.map(() => emptyOutcome());
  let overdueOpen = 0;
  for (const row of inRange) {
    tally(totals, row.status);
    const professional = byProfessional.get(row.professional) ?? emptyOutcome();
    tally(professional, row.status);
    byProfessional.set(row.professional, professional);
    tally(weekdays[weekdayOf(row.day)], row.status);
    if (row.status === appointmentStatuses.scheduled && row.day < input.today) overdueOpen += 1;
  }
  const buckets = reportBuckets(input.range, input.granularity);
  const previousBuckets = input.previous ? reportBuckets(input.previous, input.granularity) : null;
  const countBy = (list: typeof buckets, range: ReportRange, predicate: (row: AppointmentRow) => boolean) =>
    sumByBucket(list, input.rows.filter((row) => inReportRange(row.day, range) && predicate(row)).map((row) => ({ day: row.day, value: 1 })));
  const series = (predicate: (row: AppointmentRow) => boolean): SeriesPoint[] =>
    alignSeries(buckets, countBy(buckets, input.range, predicate), previousBuckets && input.previous ? countBy(previousBuckets, input.previous, predicate) : null);
  const previousRows = input.previous ? input.rows.filter((row) => inReportRange(row.day, input.previous as ReportRange)) : null;
  let previousTotals: Outcome | null = null;
  if (previousRows) {
    previousTotals = emptyOutcome();
    for (const row of previousRows) tally(previousTotals, row.status);
  }
  return {
    totals: { ...totals, pending: totals.scheduled + totals.inProgress, overdueOpen, attendanceRatePct: attendanceRatePct(totals), cancellationRatePct: cancellationRatePct(totals) },
    previous: previousTotals ? { ...previousTotals, pending: previousTotals.scheduled + previousTotals.inProgress, attendanceRatePct: attendanceRatePct(previousTotals), cancellationRatePct: cancellationRatePct(previousTotals) } : null,
    byProfessional: [...byProfessional.entries()]
      .map(([name, outcome]) => ({ name, ...outcome, pending: outcome.scheduled + outcome.inProgress, attendanceRatePct: attendanceRatePct(outcome), cancellationRatePct: cancellationRatePct(outcome) }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "pt-BR")),
    byWeekday: weekdays.map((outcome, index) => ({ weekday: index, name: weekdayNames[index], total: outcome.total, done: outcome.done })),
    seriesTotal: series(() => true),
    seriesDone: series((row) => isDoneStatus(row.status)),
  };
}

// ---------- Funil de orçamentos ----------

// Funil da coorte do período: criados → enviados → aprovados / recusados / expirados; valor por status dos criados no período.
export function quoteFunnel(quotes: QuoteRow[], range: ReportRange, today: string) {
  const stats = quoteStats(quotes, range, today);
  const sent = quotes.filter((quote) => quote.sentDay !== null && inReportRange(quote.sentDay, range)).length;
  const created = quotes.filter((quote) => inReportRange(quote.createdDay, range));
  const byStatus = new Map<string, { status: string; count: number; totalCents: number }>();
  for (const quote of created) {
    const entry = byStatus.get(quote.status) ?? { status: quote.status, count: 0, totalCents: 0 };
    entry.count += 1;
    entry.totalCents += quote.totalCents;
    byStatus.set(quote.status, entry);
  }
  const order = ["Rascunho", "Pendente", "Enviado", "Aprovado", "Pago", "Recusado"];
  return {
    created: stats.created,
    sent,
    approved: stats.approved,
    refused: stats.refused,
    expired: stats.expired,
    createdValueCents: created.reduce((sum, quote) => sum + quote.totalCents, 0),
    valueByStatus: [...byStatus.values()].sort((a, b) => (order.indexOf(a.status) + 100) % 100 - (order.indexOf(b.status) + 100) % 100 || a.status.localeCompare(b.status, "pt-BR")),
  };
}

// ---------- Clientes ----------

// Pacientes com realizado no período por nº de visitas no período: 1, 2 e 3 ou mais (só contagens, sem identificar pessoa).
export function visitDistribution(periodDone: AppointmentRow[]) {
  const perPatient = new Map<string, number>();
  for (const row of periodDone) perPatient.set(row.patientId, (perPatient.get(row.patientId) ?? 0) + 1);
  const groups = [
    { label: "1 atendimento", patients: 0, appointments: 0 },
    { label: "2 atendimentos", patients: 0, appointments: 0 },
    { label: "3 ou mais atendimentos", patients: 0, appointments: 0 },
  ];
  for (const count of perPatient.values()) {
    const group = groups[Math.min(count, 3) - 1];
    group.patients += 1;
    group.appointments += count;
  }
  return { groups, totalPatients: perPatient.size };
}

// ---------- Procedimentos e profissionais ----------

// Execuções (realizados) por procedimento e profissional.
export function procedureProfessionals(done: AppointmentRow[]) {
  const map = new Map<string, { procedure: string; professional: string; executions: number }>();
  for (const row of done) {
    const key = `${row.procedure}\u0000${row.professional}`;
    const entry = map.get(key) ?? { procedure: row.procedure, professional: row.professional, executions: 0 };
    entry.executions += 1;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => a.procedure.localeCompare(b.procedure, "pt-BR") || b.executions - a.executions || a.professional.localeCompare(b.professional, "pt-BR"));
}

// Evolução de execuções e valor de tabela (preço cadastrado × execuções; execução sem cadastro fica fora do valor e é contada em `unpriced`, como em procedureStats).
export function executionSeries(input: { rows: AppointmentRow[]; catalog: ProcedureCatalogEntry[]; range: ReportRange; previous: ReportRange | null; granularity: ReportGranularity }) {
  const price = new Map(input.catalog.map((entry) => [entry.name, entry.priceCents]));
  const buckets = reportBuckets(input.range, input.granularity);
  const previousBuckets = input.previous ? reportBuckets(input.previous, input.granularity) : null;
  const doneIn = (range: ReportRange) => input.rows.filter((row) => isDoneStatus(row.status) && inReportRange(row.day, range));
  const build = (value: (row: AppointmentRow) => number) =>
    alignSeries(buckets, sumByBucket(buckets, doneIn(input.range).map((row) => ({ day: row.day, value: value(row) }))), previousBuckets && input.previous ? sumByBucket(previousBuckets, doneIn(input.previous).map((row) => ({ day: row.day, value: value(row) }))) : null);
  // Sem preço cadastrado = fora do valor (não R$ 0,00); `unpriced` conta essas execuções por intervalo para a nota/célula "—".
  return { executions: build(() => 1), tableValueCents: build((row) => price.get(row.procedure) ?? 0), unpriced: build((row) => (price.has(row.procedure) ? 0 : 1)) };
}

// Por profissional (rows já no período): procedimentos distintos realizados e taxa de comparecimento.
export function professionalExtras(rows: AppointmentRow[]) {
  const map = new Map<string, { procedures: Set<string>; outcome: Outcome }>();
  for (const row of rows) {
    const entry = map.get(row.professional) ?? { procedures: new Set<string>(), outcome: emptyOutcome() };
    tally(entry.outcome, row.status);
    if (isDoneStatus(row.status)) entry.procedures.add(row.procedure);
    map.set(row.professional, entry);
  }
  return new Map([...map.entries()].map(([name, entry]) => [name, { distinctProcedures: entry.procedures.size, attendanceRatePct: attendanceRatePct(entry.outcome), appointments: entry.outcome.total }]));
}

// Evolução de realizados por intervalo (atual e anterior).
export function doneSeries(rows: AppointmentRow[], range: ReportRange, previous: ReportRange | null, granularity: ReportGranularity): SeriesPoint[] {
  const buckets = reportBuckets(range, granularity);
  const previousBuckets = previous ? reportBuckets(previous, granularity) : null;
  const count = (list: typeof buckets, window: ReportRange) => sumByBucket(list, rows.filter((row) => isDoneStatus(row.status) && inReportRange(row.day, window)).map((row) => ({ day: row.day, value: 1 })));
  return alignSeries(buckets, count(buckets, range), previousBuckets && previous ? count(previousBuckets, previous) : null);
}
