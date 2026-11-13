// Utilidades comuns dos especificadores de XLSX (puros): filtros do Resumo, cards de KPI a partir do documento, tabelas do documento
// e o esqueleto de XlsxSpec. Cada relatório só define fórmulas dos KPIs, a tabela agregada e as linhas de detalhe.
import { formatDateTimeBr, MAX_TABLE_ROWS, reportDefinitions, type Cell, type ReportDocument, type Row, type TableSection } from "../reports-document.ts";
import type { AggregateSpec, DataSheet, Expr, KpiGroupSpec, XlsxSpec } from "../reports-xlsx-types.ts";

export type SpecParts = { kpiGroups?: KpiGroupSpec[]; aggregate?: AggregateSpec | null; sheets: DataSheet[]; notes?: string[] };

const DASH = "–";

export function filterPairs(doc: ReportDocument): XlsxSpec["filters"] {
  const find = (label: string) => doc.filters.find((filter) => filter.label === label)?.value;
  const professional = find("Profissional") ?? "Todos";
  return {
    period: doc.period.label,
    professional: /^todos/i.test(professional) ? "Todos" : professional,
    grouping: find("Agrupamento") ?? DASH,
    comparison: doc.comparePeriod ? "Ligada" : "Desligada",
    generatedAt: formatDateTimeBr(doc.generatedAt),
  };
}

// Cards = os KPIs do documento (os mesmos da tela). `exprs` associa a chave do KPI à fórmula derivável das linhas de detalhe.
export function kpiGroupsOf(doc: ReportDocument, exprs: Record<string, Expr> = {}, titles: Record<string, string> = {}): KpiGroupSpec[] {
  return doc.sections.flatMap((section) => (section.type === "kpis" ? [{ title: section.title ?? titles[section.id], items: section.items.map((item) => ({ label: item.label, value: item.value, expr: exprs[item.key] ?? null })) }] : []));
}

export function tableOf(doc: ReportDocument, id: string): TableSection | null {
  const found = doc.sections.find((section) => section.type === "table" && section.id === id);
  return found && found.type === "table" ? found : null;
}

// Célula de uma linha do documento pela chave da coluna.
export function cellByKey(table: TableSection, row: Row, key: string): Cell | undefined {
  const index = table.columns.findIndex((column) => column.key === key);
  return index >= 0 ? row.cells[index] : undefined;
}

export const textOfCell = (cell: Cell | undefined) => (cell && cell.type === "text" ? cell.value : "");

// Política de corte uniforme: SEMPRE as linhas mais recentes. As linhas de detalhe cronológicas vêm em ordem crescente de data
// (mantém as últimas: keep = "last"); as já ordenadas do mais novo para o mais antigo ou sem data (posição de estoque) mantêm as primeiras.
export function limitDetail<T>(rows: T[], max = MAX_TABLE_ROWS, keep: "last" | "first" = "last"): { rows: T[]; truncated: { shown: number; total: number } | null } {
  if (rows.length <= max) return { rows, truncated: null };
  return { rows: keep === "last" ? rows.slice(rows.length - max) : rows.slice(0, max), truncated: { shown: max, total: rows.length } };
}

export function truncationNotes(sheets: DataSheet[]) {
  return sheets.flatMap((sheet) => (sheet.truncated ? [`Aba "${sheet.name}": exibindo ${sheet.truncated.shown} de ${sheet.truncated.total} linhas. Os indicadores usam os valores do relatório (não fórmulas sobre a aba).`] : []));
}

export const PRIVACY_NOTE = "Sem dados pessoais: pacientes não são identificados nesta planilha.";

export function baseSpec(doc: ReportDocument, parts: SpecParts): XlsxSpec {
  const empty = !doc.hasData;
  const sheets = empty ? parts.sheets.map((sheet) => ({ ...sheet, rows: [], truncated: null })) : parts.sheets;
  const notes = [
    ...(doc.comparePeriod ? [`Comparação: período anterior ${doc.comparePeriod.label}.`] : []),
    ...(empty ? [] : truncationNotes(sheets)),
    ...(parts.notes ?? []),
  ];
  return {
    kind: doc.kind,
    title: `Relatório de ${doc.title}`,
    description: doc.subtitle,
    clinicName: doc.clinicName,
    filters: filterPairs(doc),
    kpiGroups: parts.kpiGroups ?? kpiGroupsOf(doc),
    aggregate: empty ? null : (parts.aggregate ?? null),
    sheets,
    notes,
    empty,
    properties: { title: `${doc.title} — ${doc.period.label}`, subject: `Relatório ${doc.title} da clínica ${doc.clinicName}`, generatedAtIso: doc.generatedAt },
  };
}

export const sheetLabel = (kind: keyof typeof reportDefinitions) => reportDefinitions[kind].label;
