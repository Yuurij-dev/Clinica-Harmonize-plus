// Documento de Orçamentos: indicadores, funil (criados → enviados → aprovados/recusados/expirados) e valor por status.
import type { quotesExtras } from "../reports-datasets";
import {
  baseDocument, chart, col, compact, decimalOr, EMPTY_NOTE, int, kpis, money, note, row, table, text, unknownReasons,
  type DocumentInput, type ReportDocument,
} from "../reports-document.ts";
import type { quotesReport } from "../reports-server";
import { countKpi, kpisHaveData, kpi, moneyKpi, rateKpi } from "./common.ts";

type Quotes = Awaited<ReturnType<typeof quotesReport>>;
type Extras = Awaited<ReturnType<typeof quotesExtras>>;

export function buildQuotesDocument(input: DocumentInput, data: { report: Quotes; extras: Extras }): ReportDocument {
  const { report, extras } = data;
  const { stats, previous } = report;
  const funnel = extras.funnel;
  const compare = Boolean(input.previous);

  const summary = kpis("summary", [
    countKpi("created", "Criados", stats.created, previous?.created),
    countKpi("approved", "Aprovados", stats.approved, previous?.approved),
    countKpi("refused", "Recusados", stats.refused, previous?.refused),
    countKpi("expired", "Expirados", stats.expired, previous?.expired, "Abertos com validade vencida dentro do período."),
    rateKpi("conversion", "Conversão", stats.conversionPct, previous ? previous.conversionPct : undefined, "Dos criados no período, % hoje Aprovado ou Pago."),
    moneyKpi("approvedValue", "Valor aprovado", stats.approvedValueCents, previous?.approvedValueCents, unknownReasons.noData, "Aprovado não significa recebido."),
    kpi("approvalDays", "Tempo médio de aprovação (dias)", decimalOr(stats.averageApprovalDays, unknownReasons.noData), { hint: "Da data de envio (ou criação) até a aprovação." }),
  ]);

  // Vazio = nenhum dado exibido: nem as bases do relatório nem os KPIs (um KPI diferente de zero nunca é "vazio").
  const hasData = funnel.created + funnel.sent + funnel.approved + funnel.refused + funnel.expired > 0 || kpisHaveData(summary.items);
  if (!hasData) return baseDocument("quotes", input, { hasData, sections: [summary, note("empty", EMPTY_NOTE)] });

  const stages = [
    { label: "Criados", now: funnel.created, before: extras.previousFunnel?.created },
    { label: "Enviados", now: funnel.sent, before: extras.previousFunnel?.sent },
    { label: "Aprovados", now: funnel.approved, before: extras.previousFunnel?.approved },
    { label: "Recusados", now: funnel.refused, before: extras.previousFunnel?.refused },
    { label: "Expirados", now: funnel.expired, before: extras.previousFunnel?.expired },
  ];
  const funnelTable = table({
    id: "funnel",
    title: compare ? "Funil de orçamentos (atual x anterior)" : "Funil de orçamentos",
    columns: compact([col("stage", "Etapa", "text", { width: 22 }), col("count", "Orçamentos", "int"), compare && col("countPrev", "Orçamentos (anterior)", "int")]),
    rows: stages.map((stage) => row(compact([text(stage.label), int(stage.now), compare && (stage.before === undefined ? text("") : int(stage.before))]))),
    notes: ["Cada etapa conta pela data do evento no período (criação, envio, aprovação, recusa, validade); as etapas não são uma coorte estrita."],
  });
  const funnelChart = chart({ id: "funnel-chart", title: "Funil de orçamentos", kind: "bar", unit: "int", categories: stages.map((stage) => stage.label), series: [{ name: "Orçamentos", values: stages.map((stage) => stage.now) }] });

  const byStatus = table({
    id: "by-status",
    title: "Valor por status (orçamentos criados no período)",
    columns: [col("status", "Status", "text", { width: 20 }), col("count", "Orçamentos", "int", { total: "sum" }), col("value", "Valor", "money", { total: "sum" })],
    rows: funnel.valueByStatus.map((item) => row([text(item.status), int(item.count), money(item.totalCents)])),
    withTotal: true,
    notes: [report.professionalNote],
  });

  const evolution = table({
    id: "evolution",
    title: "Orçamentos por período",
    columns: [col("period", "Período", "text", { width: 18 }), col("created", "Criados", "int", { total: "sum" }), col("approved", "Aprovados", "int", { total: "sum" })],
    rows: report.series.created.map((point, index) => row([text(point.label), int(point.value), int(report.series.approved[index]?.value ?? 0)])),
    withTotal: true,
  });

  return baseDocument("quotes", input, {
    hasData,
    subtitle: "Funil de orçamentos, conversão e valor por status.",
    sections: compact([summary, funnelChart, funnelTable, byStatus, evolution]),
  });
}
