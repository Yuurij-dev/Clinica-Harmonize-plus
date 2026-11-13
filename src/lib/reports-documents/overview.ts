// Documento da Visão geral (indicadores gerais): mesmas definições dos cards da tela.
import {
  baseDocument, chart, col, compact, int, kpis, money, note, row, table, text, unknown, unknownReasons,
  type DocumentInput, type KpiItem, type ReportDocument,
} from "../reports-document.ts";
import type { overviewReport } from "../reports-server";
import { limitationText } from "../reports-ui-rules.ts";
import { kpi, kpisHaveData, moneyKpi, previousCell, rateKpi } from "./common.ts";

type Overview = Awaited<ReturnType<typeof overviewReport>>;

export function buildOverviewDocument(input: DocumentInput, report: Overview): ReportDocument {
  const { cards, series } = report;
  const compare = Boolean(input.previous);

  const count = (key: string, label: string, card: { value: number | null; previous: number | null; changePct: number | null }, hint?: string): KpiItem =>
    kpi(key, label, card.value === null ? unknown(unknownReasons.noData) : int(card.value), { previous: compare && card.previous !== null ? int(card.previous) : null, change: card.changePct, hint });
  const items = compact<KpiItem>([
    count("appointments", "Atendimentos realizados", cards.appointments),
    cards.revenue ? moneyKpi("revenue", "Receita recebida", cards.revenue.value, compare ? cards.revenue.previous : undefined, unknownReasons.noData, "Pagamentos com status Pago no período.") : kpi("revenue", "Receita recebida", unknown(cards.revenueLimitation === "forbidden" ? unknownReasons.notApplicable : "pagamento sem profissional"), { hint: limitationText(cards.revenueLimitation) ?? undefined }),
    count("newPatients", "Novos pacientes", cards.newPatients),
    rateKpi("returnRate", "Taxa de retorno", cards.returnRate.value, compare ? cards.returnRate.previous : undefined, "Dos pacientes atendidos, % que já tinham atendimento antes do período."),
    cards.avgTicket ? moneyKpi("ticket", "Ticket médio", cards.avgTicket.value, compare ? cards.avgTicket.previous : undefined, unknownReasons.noData, cards.avgTicketNote) : null,
  ]);

  const hasData = (cards.appointments.value ?? 0) > 0 || (cards.newPatients.value ?? 0) > 0 || (cards.revenue?.value ?? 0) > 0 || kpisHaveData(items);
  if (!hasData) return baseDocument("overview", input, { hasData, sections: [kpis("summary", items), note("empty", "Nenhuma movimentação no período.")] });

  const labels = series.appointments.map((point) => point.label);
  const evolution = table({
    id: "evolution",
    title: compare ? "Atendimentos por período (atual x anterior)" : "Atendimentos por período",
    columns: compact([col("period", "Período", "text", { width: 18 }), col("done", "Realizados", "int", { total: "sum" }), compare && col("donePrev", "Realizados (anterior)", "int", { total: "sum" })]),
    rows: series.appointments.map((point) => row(compact([text(point.label), int(point.current), compare && previousCell(point, int)]))),
    withTotal: true,
  });
  const revenueRows = series.revenue;
  const revenueTable = revenueRows
    ? table({
        id: "revenue-evolution",
        title: compare ? "Receita recebida por período (atual x anterior)" : "Receita recebida por período",
        columns: compact([col("period", "Período", "text", { width: 18 }), col("revenue", "Receita recebida", "money", { total: "sum" }), compare && col("revenuePrev", "Receita (anterior)", "money", { total: "sum" })]),
        rows: revenueRows.map((point) => row(compact([text(point.label), money(point.current), compare && previousCell(point, money)]))),
        withTotal: true,
      })
    : null;
  const insights = report.insights.filter((insight) => insight.available);

  return baseDocument("overview", input, {
    hasData,
    subtitle: "Indicadores gerais do período.",
    sections: compact([
      kpis("summary", items),
      chart({ id: "appointments-chart", title: "Atendimentos realizados", kind: "bar", unit: "int", categories: labels, series: [{ name: "Atual", values: series.appointments.map((point) => point.current), style: "current" }] }),
      evolution,
      revenueTable,
      insights.length ? table({ id: "insights", title: "Insights do período", columns: [col("insight", "Insight", "text", { width: 90 })], rows: insights.map((insight) => row([text(insight.message)])) }) : null,
    ]),
  });
}
