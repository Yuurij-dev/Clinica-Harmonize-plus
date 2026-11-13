// XLSX de Agendamentos: uma linha por agendamento do período (sem paciente).
import { date, text, unknown, unknownReasons, type Cell, type ReportDocument } from "../reports-document.ts";
import type { AppointmentRow } from "../reports-rules.ts";
import { add, count, div, is, isKey, type AggregateSpec, type DataSheet, type XlsxSpec } from "../reports-xlsx-types.ts";
import { baseSpec, cellByKey, kpiGroupsOf, limitDetail, PRIVACY_NOTE, sheetLabel, tableOf, textOfCell } from "./common.ts";

export type AppointmentsSource = { rows: AppointmentRow[] };
const DONE = ["Atendido", "Finalizado"];

export function buildAppointmentsSpec(doc: ReportDocument, source: AppointmentsSource): XlsxSpec {
  const name = sheetLabel("appointments");
  const inRange = source.rows
    .filter((row) => row.day >= doc.period.from && row.day <= doc.period.to)
    .sort((a, b) => a.day.localeCompare(b.day) || (a.time ?? "").localeCompare(b.time ?? "") || a.professional.localeCompare(b.professional, "pt-BR"));
  const limited = limitDetail(inRange);
  const rows: Cell[][] = limited.rows.map((item) => [date(item.day), item.time ? text(item.time) : unknown(unknownReasons.noData), text(item.professional), text(item.procedure), text(item.status)]);
  const sheet: DataSheet = {
    name,
    columns: [
      { key: "day", label: "Data", type: "date" },
      { key: "time", label: "Hora", type: "text", width: 8 },
      { key: "professional", label: "Profissional", type: "text", width: 22 },
      { key: "procedure", label: "Procedimento", type: "text", width: 24 },
      { key: "status", label: "Situação", type: "text", width: 16 },
    ],
    rows,
    truncated: limited.truncated,
  };
  const total = count(name, "day");
  const done = count(name, "day", [is("status", ...DONE)]);
  const missed = count(name, "day", [is("status", "Faltou")]);
  const cancelled = count(name, "day", [is("status", "Cancelado")]);
  const byProfessional = tableOf(doc, "by-professional");
  const placeholder = unknown(unknownReasons.noData);
  const aggregate: AggregateSpec | null = byProfessional
    ? {
        title: "Agendamentos por profissional",
        keyLabel: "Profissional",
        metrics: [{ label: "Agendamentos", type: "int" }, { label: "Concluídos", type: "int" }, { label: "Faltas", type: "int" }, { label: "Participação", type: "percent", share: 0 }],
        rows: byProfessional.rows.map((row) => {
          const label = textOfCell(cellByKey(byProfessional, row, "name"));
          const key = isKey("professional", label);
          return {
            key: label,
            cells: [cellByKey(byProfessional, row, "total") ?? placeholder, cellByKey(byProfessional, row, "done") ?? placeholder, cellByKey(byProfessional, row, "missed") ?? placeholder, placeholder],
            exprs: [count(name, "day", [key]), count(name, "day", [key, is("status", ...DONE)]), count(name, "day", [key, is("status", "Faltou")]), null],
          };
        }),
      }
    : null;
  return baseSpec(doc, {
    kpiGroups: kpiGroupsOf(doc, {
      total,
      done,
      cancelled,
      missed,
      pending: count(name, "day", [is("status", "Agendado", "Em atendimento")]),
      attendanceRate: div(done, add(done, missed)),
      cancellationRate: div(cancelled, total),
    }),
    aggregate,
    sheets: [sheet],
    notes: [PRIVACY_NOTE],
  });
}
