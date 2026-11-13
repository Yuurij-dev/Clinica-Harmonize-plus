// Documento de Agendamentos: status reais (Agendado, Em atendimento, Atendido/Finalizado, Faltou, Cancelado), taxas e distribuições.
import type { appointmentsReport } from "../reports-datasets";
import {
  baseDocument, chart, col, compact, EMPTY_NOTE, int, kpis, note, percentOr, row, table, text, unknownReasons,
  type DocumentInput, type ReportDocument,
} from "../reports-document.ts";
import { countKpi, kpisHaveData, previousCell, rateKpi } from "./common.ts";

type Appointments = Awaited<ReturnType<typeof appointmentsReport>>;

export function buildAppointmentsDocument(input: DocumentInput, report: Appointments): ReportDocument {
  const { totals, previous } = report;
  const compare = Boolean(input.previous);

  const summary = kpis("summary", [
    countKpi("total", "Agendamentos no período", totals.total, previous?.total),
    countKpi("done", "Concluídos", totals.done, previous?.done, "Atendido ou Finalizado."),
    countKpi("cancelled", "Cancelados", totals.cancelled, previous?.cancelled),
    countKpi("missed", "Faltas", totals.missed, previous?.missed),
    countKpi("pending", "Pendentes", totals.pending, previous?.pending, totals.overdueOpen > 0 ? `Agendado ou Em atendimento; ${totals.overdueOpen} agendado(s) com data já passada.` : "Agendado ou Em atendimento."),
    rateKpi("attendanceRate", "Taxa de comparecimento", totals.attendanceRatePct, previous ? previous.attendanceRatePct : undefined, "Concluídos ÷ (concluídos + faltas); cancelamento fora do denominador."),
    rateKpi("cancellationRate", "Cancelamento (÷ agendamentos do período)", totals.cancellationRatePct, previous ? previous.cancellationRatePct : undefined, "Cancelados ÷ total de agendamentos do período."),
  ]);

  // Vazio = nenhum dado exibido: nem as bases do relatório nem os KPIs (um KPI diferente de zero nunca é "vazio").
  const hasData = totals.total > 0 || kpisHaveData(summary.items);
  if (!hasData) return baseDocument("appointments", input, { hasData, sections: [summary, note("empty", EMPTY_NOTE)] });

  const statusChart = chart({
    id: "status-chart",
    title: "Distribuição por situação",
    kind: "donut",
    unit: "int",
    categories: ["Concluídos", "Cancelados", "Faltas", "Pendentes"],
    series: [{ name: "Agendamentos", values: [totals.done, totals.cancelled, totals.missed, totals.pending] }],
  });

  const byProfessional = table({
    id: "by-professional",
    title: "Por profissional",
    columns: [
      col("name", "Profissional", "text", { width: 28 }),
      col("total", "Total", "int", { total: "sum" }),
      col("done", "Concluídos", "int", { total: "sum" }),
      col("cancelled", "Cancelados", "int", { total: "sum" }),
      col("missed", "Faltas", "int", { total: "sum" }),
      col("pending", "Pendentes", "int", { total: "sum" }),
      col("attendance", "Taxa de comparecimento", "percent"),
      col("cancellation", "Cancelamento (÷ agendamentos do período)", "percent"),
    ],
    rows: report.byProfessional.map((item) => row([text(item.name), int(item.total), int(item.done), int(item.cancelled), int(item.missed), int(item.pending), percentOr(item.attendanceRatePct, unknownReasons.noData), percentOr(item.cancellationRatePct, unknownReasons.noData)])),
    withTotal: true,
  });

  const byWeekday = table({
    id: "by-weekday",
    title: "Por dia da semana",
    columns: [col("weekday", "Dia da semana", "text", { width: 18 }), col("total", "Agendamentos", "int", { total: "sum" }), col("done", "Concluídos", "int", { total: "sum" })],
    rows: report.byWeekday.map((item) => row([text(item.name), int(item.total), int(item.done)])),
    withTotal: true,
  });

  const labels = report.seriesTotal.map((point) => point.label);
  const evolutionChart = chart({
    id: "evolution-chart",
    title: "Agendamentos por período",
    kind: "bar",
    unit: "int",
    categories: labels,
    series: compact([
      { name: "Agendamentos", values: report.seriesTotal.map((point) => point.current), style: "current" as const },
      { name: "Concluídos", values: report.seriesDone.map((point) => point.current), style: "current" as const },
      compare ? { name: "Agendamentos (anterior)", values: report.seriesTotal.map((point) => point.previous), style: "previous" as const } : null,
    ]),
  });
  const evolution = table({
    id: "evolution",
    title: compare ? "Evolução por período (atual x anterior)" : "Evolução por período",
    columns: compact([
      col("period", "Período", "text", { width: 18 }),
      col("total", "Agendamentos", "int", { total: "sum" }),
      compare && col("totalPrev", "Agendamentos (anterior)", "int", { total: "sum" }),
      col("done", "Concluídos", "int", { total: "sum" }),
      compare && col("donePrev", "Concluídos (anterior)", "int", { total: "sum" }),
    ]),
    rows: report.seriesTotal.map((point, index) => {
      const done = report.seriesDone[index];
      return row(compact([text(point.label), int(point.current), compare && previousCell(point, int), int(done?.current ?? 0), compare && done && previousCell(done, int)]));
    }),
    withTotal: true,
  });

  return baseDocument("appointments", input, {
    hasData,
    subtitle: "Concluídos, cancelados, faltas e pendentes, com taxas de comparecimento e cancelamento.",
    sections: compact([
      summary,
      totals.other > 0 ? note("other-status", `${totals.other} agendamento(s) com situação não reconhecida entram só no total.`, "warning") : null,
      statusChart,
      byProfessional,
      byWeekday,
      evolutionChart,
      evolution,
    ]),
  });
}
