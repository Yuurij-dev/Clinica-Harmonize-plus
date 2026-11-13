// Documento de Procedimentos: ranking, distribuição, evolução e quem executa. "Valor de tabela" NÃO é receita.
import type { proceduresExtras } from "../reports-datasets";
import {
  baseDocument, chart, col, compact, EMPTY_NOTE, int, kpis, limitRows, money, moneyOr, note, percentOr, row, table, text, unknown, unknownReasons,
  type DocumentInput, type ReportDocument,
} from "../reports-document.ts";
import type { proceduresReport } from "../reports-server";
import { limitationText } from "../reports-ui-rules.ts";
import { countKpi, kpisHaveData, kpi, previousCell } from "./common.ts";

type Procedures = Awaited<ReturnType<typeof proceduresReport>>;
type Extras = Awaited<ReturnType<typeof proceduresExtras>>;

const reasonText = (reason: string | null | undefined) => (reason === "restricted" ? unknownReasons.restricted : reason === "item_without_cost" ? unknownReasons.noCost : unknownReasons.noSheet);

export function buildProceduresDocument(input: DocumentInput, data: { report: Procedures; extras: Extras }): ReportDocument {
  const { report, extras } = data;
  const compare = Boolean(input.previous);

  const pricedExecutions = report.pricedExecutions ?? (report.tableTotalCents === null ? 0 : report.totalExecutions);
  const unpricedExecutions = report.totalExecutions - pricedExecutions;
  const withSheet = report.rows.filter((item) => item.materialCostCents !== null);
  const withoutSheet = report.rows.length - withSheet.length;
  const restricted = report.rows.some((item) => item.materialCostReason === "restricted");
  const unmatched = report.rows.filter((item) => !item.matched).length;
  const materialCost = withSheet.reduce((sum, item) => sum + (item.materialCostCents ?? 0), 0);
  const margin = report.rows.filter((item) => item.marginCents !== null).reduce((sum, item) => sum + (item.marginCents ?? 0), 0);
  const summary = kpis("summary", [
    countKpi("executions", "Procedimentos realizados", report.totalExecutions),
    // Sem nenhuma execução com preço: desconhecido ("—"), nunca R$ 0,00; parcial quando só parte tem preço.
    kpi("tableValue", "Valor de tabela", moneyOr(report.tableTotalCents, unknownReasons.noPrice), { hint: report.tableTotalCents === null ? "Nenhum procedimento do período tem preço cadastrado." : unpricedExecutions > 0 ? `Parcial: ${unpricedExecutions} execução(ões) sem preço cadastrado ficaram fora. Não é receita recebida.` : "Execuções × preço cadastrado. Não é receita recebida." }),
    kpi("tableTicket", "Ticket de tabela", moneyOr(report.tableTotalCents !== null && pricedExecutions > 0 ? Math.round(report.tableTotalCents / pricedExecutions) : null, report.tableTotalCents === null ? unknownReasons.noPrice : unknownReasons.noData), { hint: "Valor de tabela ÷ execuções com preço." }),
    kpi("materialCost", "Custo de material", withSheet.length > 0 ? money(materialCost) : unknown(restricted ? unknownReasons.restricted : unknownReasons.noSheet), { hint: withoutSheet > 0 ? `${withoutSheet} procedimento(s) sem custo de material conhecido ficaram fora.` : "Custo atual dos itens × ficha técnica." }),
    kpi("margin", "Margem de contribuição", report.rows.some((item) => item.marginCents !== null) ? money(margin) : unknown(restricted ? unknownReasons.restricted : unknownReasons.noSheet), { hint: "Valor de tabela − custo de material, só com ficha técnica." }),
  ]);

  // Vazio = nenhum dado exibido: nem as bases do relatório nem os KPIs (um KPI diferente de zero nunca é "vazio").
  const hasData = report.totalExecutions > 0 || kpisHaveData(summary.items);
  if (!hasData) return baseDocument("procedures", input, { hasData, sections: [summary, note("empty", EMPTY_NOTE)] });

  const ranking = table({
    id: "ranking",
    title: "Ranking de procedimentos",
    columns: [
      col("name", "Procedimento", "text", { width: 30 }),
      col("executions", "Execuções", "int", { total: "sum" }),
      col("tableValue", "Valor de tabela", "money", { total: "sum" }),
      col("share", "% do valor de tabela", "percent"),
      col("ticket", "Ticket de tabela", "money"),
      col("materialCost", "Custo de material", "money", { total: "sum" }),
      col("margin", "Margem de contribuição", "money", { total: "sum" }),
    ],
    rows: report.rows.map((item) => row([
      text(item.name),
      int(item.executions),
      moneyOr(item.tableValueCents, unknownReasons.noPrice),
      percentOr(item.tableSharePct, unknownReasons.noPrice),
      moneyOr(item.unitPriceCents, unknownReasons.noPrice),
      moneyOr(item.materialCostCents, reasonText(item.materialCostReason)),
      moneyOr(item.marginCents, reasonText(item.materialCostReason)),
    ])),
    withTotal: true,
    notes: [
      "Valor de tabela = execuções × preço cadastrado; não é receita (o pagamento não é vinculado ao procedimento).",
      restricted ? "Custo de material e margem não são exibidos para o seu perfil (escopo de profissional)." : null,
      !restricted && withoutSheet > 0 ? `Procedimentos sem custo de material conhecido (sem ficha técnica ou com item da ficha sem custo cadastrado): ${withoutSheet}. Custo e margem ficam "—" (desconhecidos, não R$ 0,00) e os totais de custo/margem somam só os que têm ficha.` : null,
      unmatched > 0 ? `Procedimentos sem cadastro com esse nome: ${unmatched}. Valor de tabela fica "—".` : null,
      limitationText(report.limitation),
    ],
  });

  const distribution = table({
    id: "distribution",
    title: "Distribuição por valor de tabela (top 5 + Outros)",
    columns: [col("name", "Procedimento", "text", { width: 30 }), col("value", "Valor de tabela", "money", { total: "sum" }), col("pct", "% do total", "percent", { total: "sum" })],
    rows: report.distribution.map((item) => row([text(item.name), money(item.valueCents), percentOr(item.pct, unknownReasons.noData)])),
    withTotal: report.distribution.length > 0,
  });
  const distributionChart = chart({ id: "distribution-chart", title: "Distribuição por valor de tabela", kind: "donut", unit: "money", categories: report.distribution.map((item) => item.name), series: [{ name: "Valor de tabela", values: report.distribution.map((item) => item.valueCents) }] });

  const unpricedTotal = (extras.series.unpriced ?? []).reduce((sum, point) => sum + point.current, 0);
  const evolution = table({
    id: "evolution",
    title: compare ? "Evolução por período (atual x anterior)" : "Evolução por período",
    columns: compact([
      col("period", "Período", "text", { width: 18 }),
      col("executions", "Execuções", "int", { total: "sum" }),
      compare && col("executionsPrev", "Execuções (anterior)", "int", { total: "sum" }),
      col("tableValue", "Valor de tabela", "money", { total: "sum" }),
      compare && col("tableValuePrev", "Valor de tabela (anterior)", "money", { total: "sum" }),
    ]),
    rows: extras.series.executions.map((point, index) => {
      const value = extras.series.tableValueCents[index];
      const unpriced = extras.series.unpriced?.[index];
      // Intervalo com execuções e NENHUMA com preço: valor desconhecido ("—"), não R$ 0,00.
      const allUnpriced = point.current > 0 && (unpriced?.current ?? 0) >= point.current;
      const allUnpricedPrev = point.previous !== null && point.previous > 0 && (unpriced?.previous ?? 0) >= point.previous;
      return row(compact([
        text(point.label),
        int(point.current),
        compare && previousCell(point, int),
        allUnpriced ? unknown(unknownReasons.noPrice) : money(value?.current ?? 0),
        compare && (value ? (allUnpricedPrev ? unknown(unknownReasons.noPrice) : previousCell(value, money)) : unknown(unknownReasons.noBase)),
      ]));
    }),
    withTotal: true,
    notes: [unpricedTotal > 0 ? `Execuções de procedimento sem preço cadastrado (${unpricedTotal}) ficam fora do valor de tabela.` : null],
  });
  const evolutionChart = chart({
    id: "evolution-chart",
    title: "Execuções por período",
    kind: "bar",
    unit: "int",
    categories: extras.series.executions.map((point) => point.label),
    series: compact([
      { name: "Atual", values: extras.series.executions.map((point) => point.current), style: "current" as const },
      compare ? { name: "Anterior", values: extras.series.executions.map((point) => point.previous), style: "previous" as const } : null,
    ]),
  });

  const executors = limitRows(extras.professionals);
  const executorsTable = table({
    id: "executors",
    title: "Quem executa cada procedimento",
    columns: [col("procedure", "Procedimento", "text", { width: 30 }), col("professional", "Profissional", "text", { width: 26 }), col("executions", "Execuções", "int", { total: "sum" })],
    rows: executors.rows.map((item) => row([text(item.procedure), text(item.professional), int(item.executions)])),
    withTotal: true,
    truncated: executors.truncated,
    detail: true,
  });

  return baseDocument("procedures", input, {
    hasData,
    subtitle: "Execuções, valor de tabela (não é receita), custo de material e quem executa.",
    sections: compact([summary, ranking, distributionChart, distribution, evolutionChart, evolution, executorsTable]),
  });
}
