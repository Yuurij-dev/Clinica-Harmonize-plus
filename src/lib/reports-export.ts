// Renderiza um pacote de exportação no formato pedido: XLSX (layout do modelo, motor compartilhado) e CSV (só dados) saem da
// especificação de planilha; o PDF segue renderizando o ReportDocument. Só servidor: importa exceljs/pdf-lib. A rota
// /api/reports/export apenas carrega o pacote e chama aqui (testável sem HTTP). Consolidado (all) não tem CSV.
import { reportFileName } from "./reports-document.ts";
import { CsvUnsupportedError, renderReportCsv } from "./reports-csv.ts";
import { exportHeaders, type ExportFormat } from "./reports-export-rules.ts";
import { renderReportPdf } from "./reports-pdf.ts";
import { renderXlsx } from "./reports-xlsx-layout.ts";
import type { ExportBundle } from "./reports-xlsx-specs/index.ts";

export type ExportFile = { body: Uint8Array; fileName: string; headers: Record<string, string> };

export async function renderReportFile(bundle: ExportBundle, format: ExportFormat): Promise<ExportFile> {
  const { doc, spec } = bundle;
  const fileName = reportFileName(doc.kind, { start: doc.period.from, end: doc.period.to }, format);
  let body: Uint8Array;
  if (format === "xlsx") body = new Uint8Array(await renderXlsx(spec));
  else if (format === "pdf") body = await renderReportPdf(doc);
  else body = new TextEncoder().encode(renderReportCsv(spec));
  // Planilha com linhas cortadas (acima do limite, mantendo as mais recentes): avisa no cabeçalho para a UI mostrar o aviso.
  const truncated = (format === "csv" ? spec.sheets.slice(0, 1) : spec.sheets).find((sheet) => sheet.truncated && !spec.empty)?.truncated ?? null;
  const headers: Record<string, string> = exportHeaders(fileName, format);
  if (truncated && format !== "pdf") headers["X-Report-Truncated"] = `${truncated.shown}/${truncated.total}`;
  return { body, fileName, headers };
}

export { CsvUnsupportedError };
