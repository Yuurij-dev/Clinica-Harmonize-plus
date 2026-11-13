// CSV dos Relatórios (Excel / Power BI / Sheets): SÓ DADOS. A linha 1 é o cabeçalho da tabela principal da aba de dados do XLSX
// (mesmas colunas; Estoque = posição por item); sem dados, só o cabeçalho. UTF-8 com BOM, separador ";", fim de linha CRLF.
// Números pt-BR sem separador de milhar; dinheiro como número puro (1250,00, sem "R$"); percentual como número; datas
// dd/mm/aaaa e data-hora dd/mm/aaaa hh:mm; desconhecido = vazio (nunca 0). O consolidado (all) não tem CSV.
// Texto livre que começa com = + - @ (ou TAB/CR) recebe o prefixo ' contra injeção de fórmula; escape correto de ";" e aspas.
import { formatDateTimeBr, type Cell } from "./reports-document.ts";
import { formatDateBr, formatNumberPtBr } from "./reports-ui-rules.ts";
import type { XlsxSpec } from "./reports-xlsx-types.ts";

export const CSV_BOM = "﻿";

// Planilhas interpretam células que começam com = + - @ (ou TAB/CR) como fórmula.
export function guardFormula(value: string) {
  return /^\s*[=+\-@]|^[\t\r]/.test(value) ? `'${value}` : value;
}

// Aspas quando há ";", aspas ou quebra de linha; aspas internas dobradas.
export function csvEscape(raw: string) {
  return /[;"\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

// Texto livre passa pela proteção de fórmula; números gerados pelo sistema não (podem ser negativos).
const textField = (value: string) => csvEscape(guardFormula(value));

export function csvValue(cell: Cell): string {
  switch (cell.type) {
    case "text": return textField(cell.value);
    case "int": return formatNumberPtBr(cell.value, 0, { group: false });
    case "decimal": return formatNumberPtBr(cell.value, 3, { group: false, trim: true });
    case "money": return formatNumberPtBr(cell.value / 100, 2, { group: false });
    case "percent": return formatNumberPtBr(cell.value, 1, { group: false, trim: true });
    case "date": return formatDateBr(cell.value);
    case "datetime": return formatDateTimeBr(cell.value);
    case "unknown": return "";
  }
}

export class CsvUnsupportedError extends Error {}

export function renderReportCsv(spec: XlsxSpec): string {
  if (spec.kind === "all") throw new CsvUnsupportedError("O consolidado não tem CSV.");
  const sheet = spec.sheets[0];
  const header = sheet ? sheet.columns.map((column) => textField(column.label)).join(";") : "";
  const lines = [header];
  if (sheet && !spec.empty) for (const row of sheet.rows) lines.push(sheet.columns.map((_, index) => (row[index] ? csvValue(row[index]) : "")).join(";"));
  return CSV_BOM + lines.join("\r\n");
}
