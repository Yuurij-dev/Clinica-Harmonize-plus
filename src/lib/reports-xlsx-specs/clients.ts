// XLSX de Clientes: uma linha por intervalo (só contagens; nenhuma pessoa é identificada).
import { int, text, unknown, unknownReasons, type Cell, type ReportDocument } from "../reports-document.ts";
import { bucketIndex, doneInRange, reportBuckets, type AppointmentRow, type ReportGranularity } from "../reports-rules.ts";
import { sum, type AggregateSpec, type DataSheet, type XlsxSpec } from "../reports-xlsx-types.ts";
import { baseSpec, kpiGroupsOf, PRIVACY_NOTE, sheetLabel } from "./common.ts";

// points = evolução da base (clientsReport.baseSeries.points); rows = agendamentos do período (qualquer status).
export type ClientsSource = { points: Array<{ label: string; newPatients: number; totalPatients: number }>; granularity: ReportGranularity; rows: AppointmentRow[] };

export function buildClientsSpec(doc: ReportDocument, source: ClientsSource): XlsxSpec {
  const name = sheetLabel("clients");
  const range = { start: doc.period.from, end: doc.period.to };
  const buckets = reportBuckets(range, source.granularity);
  const attended = buckets.map(() => new Set<string>());
  const done = buckets.map(() => 0);
  for (const row of doneInRange(source.rows, range)) {
    const index = bucketIndex(buckets, row.day);
    if (index < 0) continue;
    attended[index].add(row.patientId);
    done[index] += 1;
  }
  const rows: Cell[][] = source.points.map((point, index) => [text(point.label), int(point.newPatients), int(attended[index]?.size ?? 0), int(done[index] ?? 0), int(point.totalPatients)]);
  const sheet: DataSheet = {
    name,
    columns: [
      { key: "period", label: "Período", type: "text", width: 16 },
      { key: "newPatients", label: "Novos cadastros", type: "int", sum: true },
      { key: "attended", label: "Pacientes atendidos", type: "int" },
      { key: "done", label: "Atendimentos realizados", type: "int", sum: true },
      { key: "base", label: "Base acumulada", type: "int" },
    ],
    rows,
    truncated: null,
  };
  // Chaves de período parecem datas ("01/11"): o Excel as reinterpretaria no COUNTIF/SUMIFS, então o motor grava os valores.
  const placeholder = unknown(unknownReasons.noData);
  const aggregate: AggregateSpec = {
    title: "Evolução por intervalo",
    keyLabel: "Período",
    metrics: [{ label: "Novos cadastros", type: "int" }, { label: "Atendimentos realizados", type: "int" }, { label: "Participação", type: "percent", share: 1 }],
    rows: rows.map((cells) => ({ key: cells[0].type === "text" ? cells[0].value : "", cells: [cells[1], cells[3], placeholder], exprs: [null, null, null] })),
  };
  return baseSpec(doc, {
    kpiGroups: kpiGroupsOf(doc, { new: sum(name, "newPatients") }),
    aggregate,
    sheets: [sheet],
    notes: [PRIVACY_NOTE, "Cada linha é um intervalo do período; \"Pacientes atendidos\" conta pacientes distintos no intervalo (não é somável)."],
  });
}
