// Regras puras da exportação dos Relatórios (sem banco, sem renderizadores): formatos, escopo (tab) e cabeçalhos HTTP.
// O conteúdo de todos os formatos vem de UM ReportDocument (reports-document.ts); XLSX/PDF/CSV só o renderizam.
// Seguro para o bundle do cliente (a UI importa os rótulos daqui): não importa pdf-lib nem exceljs.
import { isReportKind, reportDefinitions, reportFileName, type ExportExtension, type ReportKind } from "./reports-document.ts";

export const exportFormats = ["xlsx", "pdf", "csv"] as const satisfies readonly ExportExtension[];
export type ExportFormat = ExportExtension;
// `tab` de /api/reports/export: id de relatório (inclui overview e appointments) ou "all" (consolidado).
export type ExportScope = ReportKind;

export const exportTabLabels: Record<ReportKind, string> = Object.fromEntries(
  Object.values(reportDefinitions).map((definition) => [definition.id, definition.label]),
) as Record<ReportKind, string>;

export const exportContentTypes: Record<ExportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  csv: "text/csv; charset=utf-8",
};

export function parseExportFormat(value: string | null | undefined): ExportFormat | null {
  return (exportFormats as readonly string[]).includes(value ?? "") ? (value as ExportFormat) : null;
}

export function parseExportScope(value: string | null | undefined): ExportScope | null {
  return isReportKind(value) ? value : null;
}

// Formatos oferecidos por escopo: o consolidado (all) não tem CSV (são vários relatórios com colunas diferentes).
export function exportFormatsFor(scope: ExportScope): readonly ExportFormat[] {
  return scope === "all" ? exportFormats.filter((format) => format !== "csv") : exportFormats;
}

export const CSV_ALL_MESSAGE = "O CSV não está disponível para o consolidado. Exporte um relatório por vez em CSV ou use Excel/PDF.";

// Capacidade extra exigida além de reports:access (consolidado e visão geral só exigem reports:access; o consolidado
// inclui apenas os relatórios permitidos).
export function exportScopeNeed(scope: ExportScope) {
  return scope === "all" ? null : reportDefinitions[scope].need;
}

// Nome de arquivo seguro (só [A-Za-z0-9_.-]); vai no Content-Disposition.
export const exportFileName = reportFileName;

// Cabeçalhos das respostas privadas de exportação (nada de cache, sem sniffing de tipo).
export function exportHeaders(fileName: string, format: ExportFormat) {
  return {
    "Content-Type": exportContentTypes[format],
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
}
