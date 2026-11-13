// Documento de Profissionais: desempenho por profissional (sem receita recebida por profissional: limitação declarada).
import type { professionalsExtras } from "../reports-datasets";
import {
  baseDocument, chart, col, compact, EMPTY_NOTE, int, intOr, kpis, money, moneyOr, note, percentOr, row, table, text, unknown, unknownReasons,
  type DocumentInput, type ReportDocument,
} from "../reports-document.ts";
import { attendanceRatePct } from "../reports-extra-rules.ts";
import type { professionalsReport } from "../reports-server";
import { limitationText } from "../reports-ui-rules.ts";
import { countKpi, kpisHaveData, kpi, previousCell } from "./common.ts";

type Professionals = Awaited<ReturnType<typeof professionalsReport>>;
type Extras = Awaited<ReturnType<typeof professionalsExtras>>;

export function buildProfessionalsDocument(input: DocumentInput, data: { report: Professionals; extras: Extras }): ReportDocument {
  const { report, extras } = data;
  const compare = Boolean(input.previous);

  const extraByName = new Map(extras.byProfessional.map((item) => [item.name, item]));
  const totals = report.rows.reduce((acc, item) => ({ done: acc.done + item.done, cancelled: acc.cancelled + item.cancelled, missed: acc.missed + item.missed, value: acc.value + (item.tableValueCents ?? 0), unpriced: acc.unpriced + (item.unpricedExecutions ?? 0), priced: acc.priced + (item.tableValueCents === null ? 0 : 1) }), { done: 0, cancelled: 0, missed: 0, value: 0, unpriced: 0, priced: 0 });
  const summary = kpis("summary", [
    countKpi("done", "Atendimentos realizados", totals.done),
    countKpi("cancelled", "Cancelados", totals.cancelled),
    countKpi("missed", "Faltas", totals.missed),
    kpi("attendance", "Taxa de comparecimento", percentOr(attendanceRatePct(totals), unknownReasons.noData), { hint: "Realizados ÷ (realizados + faltas); cancelamento fora do denominador." }),
    kpi("tableValue", "Valor de tabela produzido", totals.priced > 0 || totals.done === 0 ? money(totals.value) : unknown(unknownReasons.noPrice), { hint: totals.unpriced > 0 ? `Parcial: ${totals.unpriced} execução(ões) de procedimento sem preço cadastrado ficaram fora. Não é receita recebida.` : "Execuções × preço cadastrado. Não é receita recebida." }),
  ]);

  // Vazio = nenhum dado exibido: nem as bases do relatório nem os KPIs (um KPI diferente de zero nunca é "vazio").
  const hasData = report.rows.length > 0 || kpisHaveData(summary.items);
  if (!hasData) return baseDocument("professionals", input, { hasData, sections: [summary, note("empty", EMPTY_NOTE)] });

  const ranking = table({
    id: "ranking",
    title: "Desempenho por profissional",
    columns: [
      col("name", "Profissional", "text", { width: 28 }),
      col("done", "Realizados", "int", { total: "sum" }),
      col("cancelled", "Cancelados", "int", { total: "sum" }),
      col("missed", "Faltas", "int", { total: "sum" }),
      col("attendance", "Taxa de comparecimento", "percent"),
      col("cancellation", "Cancelamento (÷ desfechos)", "percent"),
      col("procedures", "Procedimentos distintos", "int"),
      col("patients", "Pacientes distintos", "int"),
      col("tableValue", "Valor de tabela", "money", { total: "sum" }),
      col("ticket", "Ticket de tabela", "money"),
    ],
    rows: report.rows.map((item) => {
      const extra = extraByName.get(item.name);
      return row([
        text(item.name),
        int(item.done),
        int(item.cancelled),
        int(item.missed),
        percentOr(attendanceRatePct(item), unknownReasons.noData),
        percentOr(item.cancellationRatePct, unknownReasons.noData),
        intOr(extra?.distinctProcedures, unknownReasons.noData),
        int(item.patients),
        moneyOr(item.tableValueCents, unknownReasons.noPrice),
        moneyOr(item.tableTicketCents, item.done > 0 && (item.unpricedExecutions ?? 0) === item.done ? unknownReasons.noPrice : unknownReasons.noData),
      ]);
    }),
    withTotal: true,
    notes: [
      "Comparecimento = realizados ÷ (realizados + faltas). Cancelamento = cancelados ÷ (realizados + cancelados + faltas); agendamentos em aberto não entram.",
      "Valor de tabela = execuções × preço cadastrado; não é receita recebida. Execuções de procedimento sem preço cadastrado ficam fora (valor parcial; \"—\" quando todas são sem preço); o ticket divide pelas execuções com preço.",
      totals.unpriced > 0 ? `Execuções sem preço cadastrado: ${totals.unpriced}.` : null,
      limitationText(report.limitation),
    ],
  });

  const evolution = table({
    id: "evolution",
    title: compare ? "Atendimentos realizados por período (atual x anterior)" : "Atendimentos realizados por período",
    columns: compact([col("period", "Período", "text", { width: 18 }), col("done", "Realizados", "int", { total: "sum" }), compare && col("donePrev", "Realizados (anterior)", "int", { total: "sum" })]),
    rows: extras.doneSeries.map((point) => row(compact([text(point.label), int(point.current), compare && previousCell(point, int)]))),
    withTotal: true,
  });
  const evolutionChart = chart({
    id: "evolution-chart",
    title: "Atendimentos realizados por período",
    kind: "bar",
    unit: "int",
    categories: extras.doneSeries.map((point) => point.label),
    series: compact([
      { name: "Atual", values: extras.doneSeries.map((point) => point.current), style: "current" as const },
      compare ? { name: "Anterior", values: extras.doneSeries.map((point) => point.previous), style: "previous" as const } : null,
    ]),
  });

  return baseDocument("professionals", input, {
    hasData,
    subtitle: "Realizados, cancelados, faltas e valor de tabela por profissional.",
    sections: compact([summary, ranking, evolutionChart, evolution]),
  });
}
