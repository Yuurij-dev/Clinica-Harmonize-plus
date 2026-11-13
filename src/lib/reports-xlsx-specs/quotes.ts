// XLSX de Orçamentos: uma linha por orçamento criado no período (sem paciente nem autor).
import { date, dateOr, money, text, unknown, unknownReasons, type Cell, type ReportDocument } from "../reports-document.ts";
import type { QuoteRow } from "../reports-rules.ts";
import { count, isKey, sum, type AggregateSpec, type DataSheet, type XlsxSpec } from "../reports-xlsx-types.ts";
import { baseSpec, cellByKey, kpiGroupsOf, limitDetail, PRIVACY_NOTE, sheetLabel, tableOf, textOfCell } from "./common.ts";

export type QuotesSource = { rows: QuoteRow[] };

export function buildQuotesSpec(doc: ReportDocument, source: QuotesSource): XlsxSpec {
  const name = sheetLabel("quotes");
  const created = source.rows.filter((row) => row.createdDay >= doc.period.from && row.createdDay <= doc.period.to).sort((a, b) => a.createdDay.localeCompare(b.createdDay) || a.status.localeCompare(b.status, "pt-BR"));
  const limited = limitDetail(created);
  const none = unknownReasons.notApplicable;
  const rows: Cell[][] = limited.rows.map((item) => [date(item.createdDay), text(item.status), money(item.totalCents), dateOr(item.sentDay, none), dateOr(item.approvedDay ?? item.refusedDay, none), dateOr(item.expiresDay, none)]);
  const sheet: DataSheet = {
    name,
    columns: [
      { key: "created", label: "Criado em", type: "date" },
      { key: "status", label: "Situação", type: "text", width: 14 },
      { key: "value", label: "Valor", type: "money", sum: true },
      { key: "sent", label: "Enviado em", type: "date" },
      { key: "decided", label: "Aprovado/Recusado em", type: "date" },
      { key: "expires", label: "Validade", type: "date" },
    ],
    rows,
    truncated: limited.truncated,
  };
  const byStatus = tableOf(doc, "by-status");
  const placeholder = unknown(unknownReasons.noData);
  const aggregate: AggregateSpec | null = byStatus
    ? {
        title: "Orçamentos por situação",
        keyLabel: "Situação",
        metrics: [{ label: "Orçamentos", type: "int" }, { label: "Valor", type: "money" }, { label: "Participação", type: "percent", share: 1 }],
        rows: byStatus.rows.map((row) => {
          const label = textOfCell(cellByKey(byStatus, row, "status"));
          const key = [isKey("status", label)];
          return { key: label, cells: [cellByKey(byStatus, row, "count") ?? placeholder, cellByKey(byStatus, row, "value") ?? placeholder, placeholder], exprs: [count(name, "created", key), sum(name, "value", key), null] };
        }),
      }
    : null;
  return baseSpec(doc, {
    kpiGroups: kpiGroupsOf(doc, { created: count(name, "created") }),
    aggregate,
    sheets: [sheet],
    notes: [PRIVACY_NOTE, "A planilha lista os orçamentos criados no período; aprovados/recusados/expirados dos indicadores contam pela data do evento."],
  });
}
