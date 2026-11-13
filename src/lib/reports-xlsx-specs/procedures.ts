// XLSX de Procedimentos: uma linha por execução realizada (sem paciente). Valor de tabela/custo vazios quando desconhecidos.
import { date, money, text, unknown, unknownReasons, type Cell, type ReportDocument } from "../reports-document.ts";
import { doneInRange, type AppointmentRow, type ProcedureCatalogEntry } from "../reports-rules.ts";
import { count, div, isKey, numbers, sum, type AggregateSpec, type DataSheet, type XlsxSpec } from "../reports-xlsx-types.ts";
import { baseSpec, cellByKey, kpiGroupsOf, limitDetail, PRIVACY_NOTE, sheetLabel, tableOf, textOfCell } from "./common.ts";

export type ProceduresSource = { rows: AppointmentRow[]; catalog: ProcedureCatalogEntry[] };

export function buildProceduresSpec(doc: ReportDocument, source: ProceduresSource): XlsxSpec {
  const name = sheetLabel("procedures");
  const price = new Map(source.catalog.map((entry) => [entry.name, entry]));
  const done = doneInRange(source.rows, { start: doc.period.from, end: doc.period.to }).sort((a, b) => a.day.localeCompare(b.day) || a.procedure.localeCompare(b.procedure, "pt-BR"));
  const limited = limitDetail(done);
  const rows: Cell[][] = limited.rows.map((item) => {
    const entry = price.get(item.procedure);
    const value = entry ? entry.priceCents : null;
    const cost = entry?.materialCostCents ?? null;
    const margin = value !== null && cost !== null ? money(value - cost) : unknown(unknownReasons.noSheet);
    return [date(item.day), text(item.procedure), text(item.professional), value === null ? unknown(unknownReasons.noPrice) : money(value), cost === null ? unknown(unknownReasons.noSheet) : money(cost), margin];
  });
  const sheet: DataSheet = {
    name,
    columns: [
      { key: "day", label: "Data", type: "date" },
      { key: "procedure", label: "Procedimento", type: "text", width: 24 },
      { key: "professional", label: "Profissional", type: "text", width: 20 },
      { key: "value", label: "Valor de tabela", type: "money", sum: true },
      { key: "cost", label: "Custo de material", type: "money", sum: true },
      { key: "margin", label: "Margem", type: "money", sum: true, minus: ["value", "cost"] },
    ],
    rows,
    truncated: limited.truncated,
  };

  const ranking = tableOf(doc, "ranking");
  const placeholder = unknown(unknownReasons.noData);
  const aggregate: AggregateSpec | null = ranking
    ? {
        title: "Desempenho por procedimento",
        keyLabel: "Procedimento",
        metrics: [{ label: "Execuções", type: "int" }, { label: "Valor de tabela", type: "money" }, { label: "Custo de material", type: "money" }, { label: "Participação", type: "percent", share: 1 }],
        rows: ranking.rows.map((row) => {
          const label = textOfCell(cellByKey(ranking, row, "name"));
          const key = [isKey("procedure", label)];
          return {
            key: label,
            cells: [cellByKey(ranking, row, "executions") ?? placeholder, cellByKey(ranking, row, "tableValue") ?? placeholder, cellByKey(ranking, row, "materialCost") ?? placeholder, placeholder],
            exprs: [count(name, "procedure", key), sum(name, "value", key), sum(name, "cost", key), null],
          };
        }),
      }
    : null;

  return baseSpec(doc, {
    kpiGroups: kpiGroupsOf(doc, {
      executions: count(name, "procedure"),
      tableValue: sum(name, "value"),
      tableTicket: div(sum(name, "value"), numbers(name, "value")),
      materialCost: sum(name, "cost"),
      margin: sum(name, "margin"),
    }),
    aggregate,
    sheets: [sheet],
    notes: [PRIVACY_NOTE, ...(source.catalog.some((entry) => entry.materialCostReason === "restricted") ? ["Custo de material e margem não são exibidos para o seu perfil (colunas vazias)."] : []), "Valor de tabela = execuções × preço cadastrado (não é receita). Células vazias: sem preço ou sem custo de material cadastrado."],
  });
}
