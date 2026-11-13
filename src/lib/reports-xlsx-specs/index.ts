// Especificações de XLSX/CSV por relatório + composição do consolidado. `ExportBundle` = documento (tela/PDF) + especificação
// (XLSX/CSV): os formatos de planilha partem da mesma fonte de dados do documento.
import { sheetName, type ReportDocument, type Section, type TableSection } from "../reports-document.ts";
import { sum, type DataSheet, type Expr, type XlsxSpec } from "../reports-xlsx-types.ts";
import { baseSpec, kpiGroupsOf, PRIVACY_NOTE } from "./common.ts";

export { buildAppointmentsSpec, type AppointmentsSource } from "./appointments.ts";
export { buildClientsSpec, type ClientsSource } from "./clients.ts";
export { buildFinanceSpec, type FinanceSource } from "./finance.ts";
export { buildProceduresSpec, type ProceduresSource } from "./procedures.ts";
export { buildProfessionalsSpec, type ProfessionalsSource } from "./professionals.ts";
export { buildQuotesSpec, type QuotesSource } from "./quotes.ts";
export { buildStockSpec, type StockSource } from "./stock.ts";

export type ExportBundle = { doc: ReportDocument; spec: XlsxSpec };

// Visão geral (e qualquer documento sem detalhe próprio): a tabela de evolução do documento vira a aba de dados.
export function buildGenericSpec(doc: ReportDocument): XlsxSpec {
  const tables = doc.sections.filter((section: Section): section is TableSection => section.type === "table" && section.rows.length > 0);
  const main = tables.find((table) => table.id === "evolution") ?? tables[0];
  const sheets: DataSheet[] = main
    ? [{ name: sheetName(doc.title), columns: main.columns.map((column) => ({ key: column.key, label: column.label, type: column.type, width: column.width, sum: column.total === "sum" })), rows: main.rows.map((row) => row.cells), truncated: main.truncated }]
    : [{ name: sheetName(doc.title), columns: [{ key: "info", label: "Informação", type: "text" }], rows: [], truncated: null }];
  const name = sheets[0].name;
  // Visão geral: os atendimentos realizados do card são a soma da evolução por período (o motor só emite a fórmula se bater).
  const exprs: Record<string, Expr> = doc.kind === "overview" && main?.columns.some((column) => column.key === "done") ? { appointments: sum(name, "done") } : {};
  return baseSpec(doc, { kpiGroups: kpiGroupsOf(doc, exprs), sheets, notes: [PRIVACY_NOTE] });
}

// Consolidado: Resumo com os KPIs de cada relatório permitido (valores do documento) + a aba de dados principal de cada um.
export function buildAllSpec(doc: ReportDocument, parts: ExportBundle[]): XlsxSpec {
  const base = baseSpec(doc, {
    kpiGroups: parts.flatMap((part) => {
      const group = part.spec.kpiGroups[0];
      return group && !part.spec.empty ? [{ title: part.doc.title, items: group.items.slice(0, 5).map((item) => ({ label: item.label, value: item.value, expr: null })) }] : [];
    }),
    sheets: parts.filter((part) => !part.spec.empty).flatMap((part) => (part.spec.sheets[0] ? [part.spec.sheets[0]] : [])),
    notes: [`Consolidado com ${parts.length} relatório(s): ${parts.map((part) => part.doc.title).join(", ")}. Cada aba traz o detalhe principal de um relatório; os cards são os indicadores principais.`, PRIVACY_NOTE, ...parts.filter((part) => part.spec.empty).map((part) => `${part.doc.title}: Nenhuma movimentação no período.`)],
  });
  return { ...base, empty: parts.every((part) => part.spec.empty), description: doc.subtitle };
}
