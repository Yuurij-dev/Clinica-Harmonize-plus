// XLSX de Profissionais: uma linha por atendimento do período (sem paciente).
import { date, money, text, unknown, unknownReasons, type Cell, type ReportDocument } from "../reports-document.ts";
import { isDoneStatus, type AppointmentRow, type ProcedureCatalogEntry } from "../reports-rules.ts";
import { add, count, div, is, isKey, sum, type AggregateSpec, type DataSheet, type XlsxSpec } from "../reports-xlsx-types.ts";
import { baseSpec, cellByKey, kpiGroupsOf, limitDetail, PRIVACY_NOTE, sheetLabel, tableOf, textOfCell } from "./common.ts";

export type ProfessionalsSource = { rows: AppointmentRow[]; catalog: ProcedureCatalogEntry[] };
const DONE = ["Atendido", "Finalizado"];

export function buildProfessionalsSpec(doc: ReportDocument, source: ProfessionalsSource): XlsxSpec {
  const name = sheetLabel("professionals");
  const price = new Map(source.catalog.map((entry) => [entry.name, entry.priceCents]));
  const inRange = source.rows.filter((row) => row.day >= doc.period.from && row.day <= doc.period.to).sort((a, b) => a.day.localeCompare(b.day) || a.professional.localeCompare(b.professional, "pt-BR"));
  const limited = limitDetail(inRange);
  const rows: Cell[][] = limited.rows.map((item) => {
    const done = isDoneStatus(item.status);
    const value = done ? price.get(item.procedure) : undefined;
    return [date(item.day), text(item.professional), text(item.procedure), text(item.status), value === undefined ? unknown(done ? unknownReasons.noPrice : unknownReasons.notApplicable) : money(value)];
  });
  const sheet: DataSheet = {
    name,
    columns: [
      { key: "day", label: "Data", type: "date" },
      { key: "professional", label: "Profissional", type: "text", width: 22 },
      { key: "procedure", label: "Procedimento", type: "text", width: 24 },
      { key: "status", label: "Situação", type: "text", width: 16 },
      { key: "value", label: "Valor de tabela", type: "money", sum: true },
    ],
    rows,
    truncated: limited.truncated,
  };
  const done = count(name, "day", [is("status", ...DONE)]);
  const missed = count(name, "day", [is("status", "Faltou")]);
  const ranking = tableOf(doc, "ranking");
  const placeholder = unknown(unknownReasons.noData);
  const aggregate: AggregateSpec | null = ranking
    ? {
        title: "Desempenho por profissional",
        keyLabel: "Profissional",
        metrics: [{ label: "Realizados", type: "int" }, { label: "Faltas", type: "int" }, { label: "Valor de tabela", type: "money" }, { label: "Participação", type: "percent", share: 0 }],
        rows: ranking.rows.map((row) => {
          const label = textOfCell(cellByKey(ranking, row, "name"));
          const key = isKey("professional", label);
          return {
            key: label,
            cells: [cellByKey(ranking, row, "done") ?? placeholder, cellByKey(ranking, row, "missed") ?? placeholder, cellByKey(ranking, row, "tableValue") ?? placeholder, placeholder],
            exprs: [count(name, "day", [key, is("status", ...DONE)]), count(name, "day", [key, is("status", "Faltou")]), sum(name, "value", [key]), null],
          };
        }),
      }
    : null;
  return baseSpec(doc, {
    kpiGroups: kpiGroupsOf(doc, {
      done,
      cancelled: count(name, "day", [is("status", "Cancelado")]),
      missed,
      attendance: div(done, add(done, missed)),
      tableValue: sum(name, "value"),
    }),
    aggregate,
    sheets: [sheet],
    notes: [PRIVACY_NOTE, "Valor de tabela só nos atendimentos realizados com preço cadastrado (não é receita)."],
  });
}
