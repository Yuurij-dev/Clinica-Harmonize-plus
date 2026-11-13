// Regras puras da "Central de relatórios" e da renderização do documento na tela (sem React, sem banco).
// Agrupa os relatórios por categoria conforme as permissões, monta chaves de cache/URLs com os MESMOS filtros da tela
// e prepara texto de células e prévias a partir do ReportDocument.
import {
  allowedReportIds, cellDisplay, cellReason, isUnknown, reportCategories, reportDefinitions,
  type ExportExtension, type ReportCategory, type ReportDefinition, type ReportDocument, type ReportId, type Section, type TableSection,
} from "./reports-document.ts";
import { reportQueryString, type ReportFilters } from "./reports-ui-rules.ts";

export type ReportCapabilities = { finance: boolean; quotes: boolean; stock: boolean };

// Cartões da central por categoria (ordem do catálogo); categoria sem nenhum relatório permitido não aparece.
export function reportCenterGroups(capabilities: ReportCapabilities): Array<{ category: ReportCategory; reports: ReportDefinition[] }> {
  const allowed = new Set<ReportId>(allowedReportIds(capabilities));
  return reportCategories
    .map((category) => ({ category, reports: [...allowed].map((id) => reportDefinitions[id]).filter((definition) => definition.category === category) }))
    .filter((group) => group.reports.length > 0);
}

// Prévia: a granularidade só muda a evolução, não os KPIs; fica fora da chave para não refazer a consulta à toa.
export function previewFilters(filters: ReportFilters): ReportFilters {
  return { ...filters, granularity: null };
}

// Chave de cache (= URL) do documento: relatório + todos os parâmetros que mudam a resposta.
export function documentKey(kind: string, filters: ReportFilters) {
  return `/api/reports/document?tab=${kind}&${reportQueryString(filters)}`;
}

export const previewKey = (kind: string, filters: ReportFilters) => documentKey(kind, previewFilters(filters));

// URL da exportação com os mesmos filtros aplicados na tela.
export function exportUrl(kind: string, format: ExportExtension, filters: ReportFilters) {
  const params = new URLSearchParams(reportQueryString(filters));
  params.set("format", format);
  params.set("tab", kind);
  return `/api/reports/export?${params.toString()}`;
}

export const exportFormatLabels: Record<ExportExtension, string> = { xlsx: "Excel (.xlsx)", pdf: "PDF", csv: "CSV" };
export const exportFormatShort: Record<ExportExtension, string> = { xlsx: "Excel", pdf: "PDF", csv: "CSV" };

export function exportSuccessMessage(format: ExportExtension) {
  return format === "xlsx" ? "Excel gerado." : format === "pdf" ? "PDF gerado." : "CSV gerado (texto simples, separador “;”).";
}

// Nome do arquivo a baixar: o do Content-Disposition (só [A-Za-z0-9_.-]) ou um padrão com a extensão pedida.
export function downloadFileName(contentDisposition: string | null | undefined, kind: string, format: ExportExtension) {
  const raw = /filename="([^"]+)"/.exec(contentDisposition ?? "")?.[1] ?? "";
  const safe = raw.replace(/[^A-Za-z0-9_.-]/g, "");
  if (safe && safe.toLowerCase().endsWith(`.${format}`)) return safe;
  const label = (reportDefinitions as Record<string, ReportDefinition>)[kind]?.fileLabel ?? "Relatorio";
  return `Harmonize_${label}.${format}`;
}

// ---------- Células e prévia ----------

// Texto de exibição + motivo (só para célula desconhecida: "—" com a explicação; nunca R$ 0,00).
export function cellView(cell: Parameters<typeof cellDisplay>[0]) {
  return { text: cellDisplay(cell), reason: cellReason(cell), unknown: isUnknown(cell) };
}

export type PreviewItem = { key: string; label: string; text: string; reason: string | null };

// 1–2 indicadores de prévia: primeiros KPIs do documento.
export function previewItems(doc: ReportDocument, max = 2): PreviewItem[] {
  const section = doc.sections.find((item) => item.type === "kpis");
  if (!section || section.type !== "kpis") return [];
  return section.items.slice(0, max).map((item) => {
    const view = cellView(item.value);
    return { key: item.key, label: item.label, text: view.text, reason: view.reason };
  });
}

export const previewIsEmpty = (doc: ReportDocument) => !doc.hasData;

// Motivos distintos de células desconhecidas de uma tabela (legenda sob a tabela).
export function tableUnknownReasons(section: TableSection) {
  const reasons = new Set<string>();
  for (const row of [...section.rows, ...(section.total ? [section.total] : [])]) {
    for (const cell of row.cells) if (cell.type === "unknown") reasons.add(cell.reason);
  }
  return [...reasons];
}

// Agrupa gráficos vizinhos (lado a lado em telas largas); demais seções ficam isoladas.
export type SectionGroup = { kind: "charts"; sections: Section[] } | { kind: "single"; section: Section };

export function groupSections(sections: Section[]): SectionGroup[] {
  const groups: SectionGroup[] = [];
  for (const section of sections) {
    const last = groups[groups.length - 1];
    if (section.type === "chart" && last?.kind === "charts") last.sections.push(section);
    else if (section.type === "chart") groups.push({ kind: "charts", sections: [section] });
    else groups.push({ kind: "single", section });
  }
  return groups;
}

export const TABLE_PAGE_SIZE = 100;
// Quantas linhas mostrar: de TABLE_PAGE_SIZE em TABLE_PAGE_SIZE (a lista completa está nos arquivos exportados).
export const visibleRowCount = (total: number, pages: number) => Math.min(total, TABLE_PAGE_SIZE * Math.max(1, pages));
