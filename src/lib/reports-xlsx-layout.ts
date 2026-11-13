// Motor XLSX compartilhado dos Relatórios (exceljs, só no servidor): escreve o workbook no layout do modelo do usuário
// (Resumo + abas de dados) a partir de um XlsxSpec. Resumo: faixa roxa, filtros, cards de KPI com FÓRMULAS sobre a aba de dados
// quando derivável (e o valor do documento quando não), tabela agregada com data bar e rodapé. Abas de dados: Tabela real do
// Excel (TableStyleLight1, filtro), cabeçalho roxo congelado, total fora da tabela com SUBTOTAL(109). Grade desligada, Arial,
// impressão paisagem ajustada à largura com "Página X de Y". Desconhecido = célula vazia (dados) ou "–" (cards/agregados).
import type ExcelJS from "exceljs";
import { cellDisplay, cellNumber, formatDateTimeBr, sheetName, type Cell, type ColumnType } from "./reports-document.ts";
import {
  computeExpr, exprFormula, exprSheets, safeCriterionKey,
  type AggregateSpec, type DataSheet, type Expr, type KpiSpec, type XlsxSpec,
} from "./reports-xlsx-types.ts";

// Paleta do modelo (alfa FF: o Excel ignora o canal).
const COLOR = { purple: "FF5B4FE8", light: "FFEEECFD", purpleText: "FF3F35C4", ink: "FF111827", muted: "FF6B7280", border: "FFE5E7EB", zebra: "FFF9FAFB", white: "FFFFFFFF", lilac: "FFDCD8FF", bar: "FFA5A0F5" };
export const XLSX_FORMATS = {
  money: '"R$" #,##0.00;-"R$" #,##0.00;"–"',
  percent: "0.0%",
  date: "DD/MM/YYYY",
  datetime: "DD/MM/YYYY HH:MM",
  int: "0",
  decimal: "0.0#",
} as const;
const DASH = "–";
export const MAX_AGGREGATE_ROWS = 500;

const arial = (size: number, options: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: "Arial", size, color: { argb: COLOR.ink }, ...options });
const solid = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const align = (horizontal: "left" | "right" | "center", options: Partial<ExcelJS.Alignment> = {}): Partial<ExcelJS.Alignment> => ({ horizontal, vertical: "middle", indent: horizontal === "center" ? 0 : 1, ...options });

// Caracteres inválidos em XML 1.0 corrompem o arquivo; texto longo é cortado no limite do Excel (32.767).
const safeText = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "").slice(0, 32000);

function colLetter(index: number) {
  let n = index;
  let out = "";
  while (n > 0) { const rest = (n - 1) % 26; out = String.fromCharCode(65 + rest) + out; n = Math.floor((n - 1) / 26); }
  return out;
}

// Instante -> "hora de parede" da clínica gravada como UTC (Excel não tem fuso).
function wallClock(iso: string): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(formatDateTimeBr(iso));
  return match ? new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4]), Number(match[5]))) : null;
}

type Placed = { value: ExcelJS.CellValue; numFmt?: string; unknown?: boolean };

// Célula do documento -> valor do Excel. Dinheiro em reais, percentual como fração; desconhecido = unknown.
function place(cell: Cell): Placed {
  switch (cell.type) {
    case "text": return { value: safeText(cell.value) };
    case "int": return { value: cell.value, numFmt: XLSX_FORMATS.int };
    case "decimal": return { value: cell.value };
    case "money": return { value: cell.value / 100, numFmt: XLSX_FORMATS.money };
    case "percent": return { value: cell.value / 100, numFmt: XLSX_FORMATS.percent };
    case "date": {
      const parsed = /^\d{4}-\d{2}-\d{2}$/.test(cell.value) ? new Date(`${cell.value}T00:00:00.000Z`) : null;
      return parsed && !Number.isNaN(parsed.getTime()) ? { value: parsed, numFmt: XLSX_FORMATS.date } : { value: safeText(cell.value) };
    }
    case "datetime": {
      const parsed = wallClock(cell.value);
      return parsed ? { value: parsed, numFmt: XLSX_FORMATS.datetime } : { value: safeText(cell.value) };
    }
    case "unknown": return { value: null, unknown: true };
  }
}

const isNumericType = (type: ColumnType) => type === "int" || type === "decimal" || type === "money" || type === "percent";
const columnFormat = (type: ColumnType) => (type === "money" ? XLSX_FORMATS.money : type === "percent" ? XLSX_FORMATS.percent : type === "int" ? XLSX_FORMATS.int : type === "date" ? XLSX_FORMATS.date : type === "datetime" ? XLSX_FORMATS.datetime : undefined);

// ---------- Nomes ----------

function uniqueName(used: Set<string>, wanted: string, clean: (value: string) => string) {
  let name = clean(wanted);
  for (let counter = 2; used.has(name.toLowerCase()); counter += 1) name = clean(`${wanted.slice(0, 26)} ${counter}`);
  used.add(name.toLowerCase());
  return name;
}

// Nome de tabela do Excel: começa com letra ou "_", sem espaços/pontuação, até 255 e sem parecer referência de célula.
function tableName(value: string) {
  const cleaned = value.normalize("NFC").replace(/[^\p{L}\p{N}_]/gu, "_").replace(/^[^\p{L}_]+/u, "") || "Tabela";
  return /^[A-Za-z]{1,3}\d+$/.test(cleaned) || /^[Rr]\d*[Cc]\d*$/.test(cleaned) ? `T_${cleaned}` : cleaned.slice(0, 60);
}

// ---------- Aba de dados ----------

type SheetLayout = { name: string; sheet: DataSheet; firstRow: number; lastRow: number; letters: Record<string, string>; formulasOk: boolean };

function writeDataSheet(wb: ExcelJS.Workbook, sheet: DataSheet, name: string, tables: Set<string>): SheetLayout {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1, showGridLines: false }] });
  const columns = sheet.columns;
  const letters: Record<string, string> = {};
  columns.forEach((column, index) => { letters[column.key] = colLetter(index + 1); });
  const n = sheet.rows.length;
  const labels = columns.map((column, index) => (columns.findIndex((other) => other.label === column.label) === index ? column.label : `${column.label} ${index + 1}`));

  const rowsValues = sheet.rows.map((cells, rowIndex) => columns.map((column, index) => {
    const cell = cells[index];
    const placed = place(cell ?? { type: "unknown", reason: "" });
    if (placed.unknown) return null;
    if (column.minus) {
      const [a, b] = column.minus;
      const rowNumber = rowIndex + 2;
      return typeof placed.value === "number" && placed.value !== 0 ? { formula: `${letters[a]}${rowNumber}-${letters[b]}${rowNumber}`, result: placed.value } : placed.value;
    }
    return placed.value;
  }));

  // Cabeçalho (formatado mesmo sem linhas: o Excel não aceita tabela com 0 linhas de dados).
  const header = ws.getRow(1);
  header.height = 26;
  columns.forEach((column, index) => {
    const cell = header.getCell(index + 1);
    cell.value = safeText(labels[index]);
    cell.font = arial(10, { bold: true, color: { argb: COLOR.white } });
    cell.fill = solid(COLOR.purple);
    cell.alignment = align(isNumericType(column.type) ? "right" : "left");
  });

  if (n > 0) {
    const name = uniqueName(tables, sheet.name, tableName);
    ws.addTable({
      name,
      displayName: name,
      ref: "A1",
      headerRow: true,
      totalsRow: false,
      style: { theme: "TableStyleLight1", showRowStripes: true },
      columns: labels.map((label) => ({ name: safeText(label), filterButton: true })),
      rows: rowsValues,
    });
    // addTable reescreve o cabeçalho: reaplica o estilo.
    columns.forEach((column, index) => {
      const cell = header.getCell(index + 1);
      cell.font = arial(10, { bold: true, color: { argb: COLOR.white } });
      cell.fill = solid(COLOR.purple);
      cell.alignment = align(isNumericType(column.type) ? "right" : "left");
    });
  }

  // Corpo: fonte Arial 10, texto/data à esquerda com recuo, números à direita.
  const widths = columns.map((column, index) => Math.max(labels[index].length + 4, 6));
  sheet.rows.forEach((cells, rowIndex) => {
    const row = ws.getRow(rowIndex + 2);
    columns.forEach((column, index) => {
      const cell = row.getCell(index + 1);
      const source = cells[index];
      const placed = place(source ?? { type: "unknown", reason: "" });
      cell.font = arial(10);
      cell.alignment = align(isNumericType(column.type) ? "right" : "left");
      if (placed.numFmt) cell.numFmt = placed.numFmt;
      if (source) widths[index] = Math.max(widths[index], Math.min(cellDisplay(source).length + 4, 42));
    });
  });
  const minimum: Record<ColumnType, number> = { text: 14, int: 10, decimal: 12, money: 17, percent: 12, date: 13, datetime: 18 };
  columns.forEach((column, index) => { ws.getColumn(index + 1).width = Math.min(Math.max(widths[index], column.width ? Math.min(column.width, 30) : 0, minimum[column.type]), 44); });

  // Total fora da tabela (linha seguinte): SUBTOTAL(109) respeita o filtro da tabela.
  const sumColumns = columns.map((column, index) => ({ column, index })).filter(({ column }) => column.sum);
  if (n > 0 && sumColumns.length > 0) {
    const totalRow = ws.getRow(n + 2);
    columns.forEach((column, index) => {
      const cell = totalRow.getCell(index + 1);
      cell.font = arial(10, { bold: true });
      cell.fill = solid(COLOR.light);
      cell.border = { top: { style: "medium", color: { argb: COLOR.purple } } };
      cell.alignment = align(isNumericType(column.type) ? "right" : "left");
      if (index === 0) cell.value = sheet.truncated ? "Total (linhas exibidas)" : "Total";
      if (column.sum) {
        const total = sheet.rows.reduce((acc, cells) => acc + (cells[index] ? (cellNumber(cells[index]) ?? 0) : 0), 0);
        const display = column.type === "money" ? total / 100 : total;
        // Soma zero vai como valor simples: o exceljs descarta result 0 (a célula voltaria indefinida).
        cell.value = display !== 0 && Number.isFinite(display) ? { formula: `SUBTOTAL(109,${letters[column.key]}2:${letters[column.key]}${n + 1})`, result: display } : 0;
        cell.numFmt = columnFormat(column.type) ?? "General";
      }
    });
  }

  ws.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.75, right: 0.75, top: 1, bottom: 1, header: 0.5, footer: 0.5 }, printTitlesRow: "1:1" };
  ws.headerFooter.oddFooter = "&RPágina &P de &N";
  return { name, sheet, firstRow: 2, lastRow: n + 1, letters, formulasOk: n > 0 && !sheet.truncated };
}

// ---------- Resumo ----------

const KPI_COLUMNS = [2, 4, 6, 8, 10]; // B, D, F, H, J
const kpiFormat = (cell: Cell) => (cell.type === "money" ? XLSX_FORMATS.money : cell.type === "percent" ? XLSX_FORMATS.percent : cell.type === "int" ? XLSX_FORMATS.int : cell.type === "decimal" ? XLSX_FORMATS.decimal : cell.type === "date" ? XLSX_FORMATS.date : undefined);

type Layouts = Map<string, SheetLayout>;

// Fórmula de um KPI: só quando as abas referidas estão completas (sem truncar) e o resultado bate com o valor do documento.
function formulaFor(expr: Expr | null | undefined, value: Cell, spec: XlsxSpec, layouts: Layouts, keyAddress?: string, key?: string): { formula: string; result: number } | null {
  if (!expr || value.type === "unknown") return null;
  const names = [...exprSheets(expr)];
  if (names.some((name) => !layouts.get(name)?.formulasOk)) return null;
  const computed = computeExpr(expr, spec.sheets, key);
  if (computed === null || !Number.isFinite(computed)) return null;
  const doc = cellNumber(value);
  if (doc === null) return null;
  // Dinheiro em centavos (meio centavo de folga), percentual: fração × 100, demais exatos.
  const tolerance = value.type === "money" ? 0.5 : value.type === "percent" ? 1e-6 : 1e-9;
  const compared = value.type === "percent" ? computed * 100 : computed;
  if (Math.abs(compared - doc) > tolerance) return null;
  const range = (sheet: string, column: string) => {
    const layout = layouts.get(sheet);
    const letter = layout?.letters[column];
    // Aspas só quando o nome precisa (como no modelo: Procedimentos!E2:E33).
    const sheetRef = layout ? (/^[A-Za-z_][A-Za-z0-9_]*$/.test(layout.name) ? layout.name : `'${layout.name.replace(/'/g, "''")}'`) : "";
    return layout && letter ? `${sheetRef}!${letter}${layout.firstRow}:${letter}${layout.lastRow}` : "#REF!";
  };
  const display = place(value).value;
  return typeof display === "number" ? { formula: exprFormula(expr, range, keyAddress), result: display } : null;
}

function setValueCell(cell: ExcelJS.Cell, value: Cell, formula: { formula: string; result: number } | null) {
  const placed = place(value);
  if (placed.unknown) { cell.value = DASH; return; }
  // Zero vai como valor simples (o exceljs descarta result 0); o formato monetário mostra "–" para zero.
  cell.value = formula && formula.result !== 0 ? formula : placed.value;
  const format = kpiFormat(value);
  if (format) cell.numFmt = format;
}

type Pending = { ws: ExcelJS.Worksheet; row: number; length: number; from: number; to: number };

function writeSummary(ws: ExcelJS.Worksheet, spec: XlsxSpec, layouts: Layouts) {
  [2, 24, 3, 24, 3, 24, 3, 24, 3, 24, 2].forEach((width, index) => { ws.getColumn(index + 1).width = width; });
  const pending: Pending[] = [];

  // Faixa roxa (linhas 1 a 3, A:K).
  [[1, 10], [2, 34], [3, 20]].forEach(([rowNumber, height]) => {
    const row = ws.getRow(rowNumber);
    row.height = height;
    for (let column = 1; column <= 11; column += 1) row.getCell(column).fill = solid(COLOR.purple);
  });
  const titleCell = ws.getCell("B2");
  titleCell.value = safeText(`Harmonize+  ·  ${spec.title}`);
  titleCell.font = arial(18, { bold: true, color: { argb: COLOR.white } });
  titleCell.alignment = { vertical: "middle" };
  const clinicCell = ws.getCell("J2");
  clinicCell.value = safeText(spec.clinicName);
  clinicCell.font = arial(11, { bold: true, color: { argb: COLOR.white } });
  clinicCell.alignment = { horizontal: "right", vertical: "middle" };
  const descCell = ws.getCell("B3");
  descCell.value = safeText(spec.description);
  descCell.font = arial(10, { color: { argb: COLOR.lilac } });
  descCell.alignment = { vertical: "top" };

  // Filtros (linhas 5 e 6).
  ws.getRow(5).height = 16;
  ws.getRow(6).height = 22;
  const filters: Array<[string, string]> = [["PERÍODO", spec.filters.period], ["PROFISSIONAL", spec.filters.professional], ["AGRUPAMENTO", spec.filters.grouping], ["COMPARAÇÃO", spec.filters.comparison], ["GERADO EM", spec.filters.generatedAt]];
  filters.forEach(([label, value], index) => {
    const labelCell = ws.getCell(5, KPI_COLUMNS[index]);
    labelCell.value = label;
    labelCell.font = arial(8, { bold: true, color: { argb: COLOR.muted } });
    const valueCell = ws.getCell(6, KPI_COLUMNS[index]);
    valueCell.value = safeText(value);
    valueCell.font = arial(11);
    valueCell.border = { bottom: { style: "medium", color: { argb: COLOR.purple } } };
    valueCell.alignment = { shrinkToFit: true };
  });

  // Cards de KPI: blocos de até 5 (borda grossa, rótulo, valor, fecho).
  let row = 8;
  for (const group of spec.kpiGroups) {
    if (group.items.length === 0) continue;
    if (group.title) {
      const titleRow = ws.getCell(row, 2);
      titleRow.value = safeText(group.title);
      titleRow.font = arial(12, { bold: true });
      row += 1;
    }
    for (let start = 0; start < group.items.length; start += 5) {
      const chunk = group.items.slice(start, start + 5);
      ws.getRow(row).height = 8;
      ws.getRow(row + 1).height = 20;
      ws.getRow(row + 2).height = 34;
      ws.getRow(row + 3).height = 18;
      chunk.forEach((item: KpiSpec, index) => {
        const column = KPI_COLUMNS[index];
        const top = ws.getCell(row, column);
        top.fill = solid(COLOR.light);
        top.border = { top: { style: "thick", color: { argb: COLOR.purple } } };
        const label = ws.getCell(row + 1, column);
        label.value = safeText(item.label);
        label.font = arial(9, { bold: true, color: { argb: COLOR.purpleText } });
        label.fill = solid(COLOR.light);
        label.alignment = align("left", { shrinkToFit: true });
        const valueCell = ws.getCell(row + 2, column);
        valueCell.font = arial(20, { bold: true });
        valueCell.fill = solid(COLOR.light);
        valueCell.alignment = align("left", { shrinkToFit: true });
        setValueCell(valueCell, item.value, formulaFor(item.expr, item.value, spec, layouts));
        ws.getCell(row + 3, column).fill = solid(COLOR.light);
      });
      row += 5; // 4 linhas do card + 1 de respiro
    }
  }

  // Tabela agregada ou estado vazio.
  if (spec.empty || !spec.aggregate) {
    if (spec.empty) {
      ws.getRow(row + 1).height = 60;
      const message = ws.getCell(row + 1, 2);
      message.value = "Nenhuma movimentação no período";
      message.font = arial(12, { color: { argb: COLOR.muted } });
      message.alignment = { horizontal: "center", vertical: "middle" };
      ws.mergeCells(row + 1, 2, row + 1, 10);
      row += 3;
    }
  } else {
    row = writeAggregate(ws, row, spec.aggregate, spec, layouts);
  }

  // Notas e rodapé.
  for (const note of spec.notes) {
    const cell = ws.getCell(row, 2);
    cell.value = safeText(note);
    cell.font = arial(9, { italic: true, color: { argb: COLOR.muted } });
    cell.alignment = { wrapText: true, vertical: "top" };
    ws.mergeCells(row, 2, row, 10);
    pending.push({ ws, row, length: note.length, from: 2, to: 10 });
    row += 1;
  }
  const footer = ws.getCell(row + 1, 2);
  footer.value = safeText(`Gerado pelo Harmonize+ · ${spec.clinicName} · ${spec.filters.generatedAt}`);
  footer.font = arial(8, { italic: true, color: { argb: COLOR.muted } });

  // Células mescladas não ajustam a altura: estima as linhas pela largura (24×5 + 3×4 = 132 caracteres).
  for (const item of pending) ws.getRow(item.row).height = Math.max(15, Math.ceil((item.length * 1.05) / 120) * 13);

  ws.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true, margins: { left: 0.75, right: 0.75, top: 1, bottom: 1, header: 0.5, footer: 0.5 } };
  ws.headerFooter.oddFooter = "&RPágina &P de &N";
}

function writeAggregate(ws: ExcelJS.Worksheet, startRow: number, aggregate: AggregateSpec, spec: XlsxSpec, layouts: Layouts): number {
  const metrics = aggregate.metrics.slice(0, 4);
  const columns = KPI_COLUMNS.slice(1, 1 + metrics.length);
  let row = startRow;
  const title = ws.getCell(row, 2);
  title.value = safeText(aggregate.title);
  title.font = arial(12, { bold: true });
  row += 1;

  // Cabeçalho: 9pt cinza com borda inferior; espaçadoras (C, E, G, I) só com a borda.
  const border = { bottom: { style: "thin", color: { argb: COLOR.border } } } as const;
  const headerRow = row;
  const headerCell = (column: number, label: string, horizontal: "left" | "right") => {
    const cell = ws.getCell(headerRow, column);
    cell.value = safeText(label);
    cell.font = arial(9, { bold: true, color: { argb: COLOR.muted } });
    cell.border = border;
    cell.alignment = { horizontal, indent: 1 };
  };
  headerCell(2, aggregate.keyLabel, "left");
  metrics.forEach((metric, index) => headerCell(columns[index], metric.label, "right"));
  for (let column = 3; column <= 9; column += 2) ws.getCell(headerRow, column).border = border;
  row += 1;

  // Até 500 linhas no agregado; acima disso mostra as primeiras 500, mas o Total e a participação usam TODAS as linhas.
  const allRows = aggregate.rows;
  const rows = allRows.slice(0, MAX_AGGREGATE_ROWS);
  const cut = allRows.length > rows.length;
  const first = row;
  const last = row + rows.length - 1;
  const totalRow = last + 1;
  const letter = (column: number) => colLetter(column);
  const shareBase = (index: number) => metrics[index]?.share;
  const numericMetric = (index: number) => shareBase(index) === undefined;

  rows.forEach((item, rowIndex) => {
    const rowNumber = first + rowIndex;
    const zebra = rowIndex % 2 === 1;
    ws.getRow(rowNumber).height = 20;
    const keyCell = ws.getCell(rowNumber, 2);
    keyCell.value = safeText(item.key);
    keyCell.font = arial(10);
    keyCell.alignment = align("left");
    for (let column = 2; column <= 10; column += 1) {
      const cell = ws.getCell(rowNumber, column);
      cell.border = border;
      if (zebra) cell.fill = solid(COLOR.zebra);
    }
    metrics.forEach((metric, index) => {
      const cell = ws.getCell(rowNumber, columns[index]);
      cell.font = arial(10);
      cell.alignment = align("right");
      const base = shareBase(index);
      if (base !== undefined) {
        const baseColumn = columns[base];
        const own = item.cells[base];
        const total = allRows.reduce((acc, other) => acc + (other.cells[base] ? (cellNumber(other.cells[base]) ?? 0) : 0), 0);
        const value = own ? cellNumber(own) : null;
        if (value === null) { cell.value = DASH; cell.numFmt = XLSX_FORMATS.percent; return; }
        const fraction = total > 0 ? value / total : 0;
        cell.numFmt = XLSX_FORMATS.percent;
        // Cortado: o total da coluna não é a soma das linhas mostradas, então a participação é valor (sobre o total real).
        cell.value = fraction !== 0 && !cut ? { formula: `IFERROR(${letter(baseColumn)}${rowNumber}/$${letter(baseColumn)}$${totalRow},0)`, result: fraction } : fraction;
        return;
      }
      const source = item.cells[index] ?? { type: "unknown", reason: "" } as Cell;
      const expr = safeCriterionKey(item.key) ? item.exprs[index] : null;
      const formula = formulaFor(expr, source, spec, layouts, `B${rowNumber}`, item.key);
      setValueCell(cell, source, formula);
    });
  });

  // Total: negrito com borda superior preta; participação soma 100%.
  const total = ws.getRow(totalRow);
  total.height = 22;
  const border2 = { top: { style: "medium", color: { argb: COLOR.ink } } } as const;
  const totalLabel = ws.getCell(totalRow, 2);
  const partial = allRows.some((item) => item.cells.some((cell, index) => numericMetric(index) && cell?.type === "unknown"));
  totalLabel.value = cut ? `Total (todas as ${allRows.length} linhas)` : partial ? "Total (parcial)" : "Total";
  totalLabel.font = arial(10, { bold: true });
  totalLabel.alignment = align("left");
  for (let column = 2; column <= 10; column += 1) {
    const cell = ws.getCell(totalRow, column);
    cell.border = border2;
    if (column % 2 === 1) { cell.font = arial(10, { bold: true }); cell.alignment = align("right"); } // espaçadoras como no modelo
  }
  metrics.forEach((metric, index) => {
    const cell = ws.getCell(totalRow, columns[index]);
    cell.font = arial(10, { bold: true });
    cell.alignment = align("right");
    const base = shareBase(index);
    const sample = rows.map((item) => (base !== undefined ? item.cells[base] : item.cells[index])).find((candidate) => candidate && candidate.type !== "unknown");
    const sumValue = allRows.reduce((acc, item) => acc + (base !== undefined ? (item.cells[base] ? (cellNumber(item.cells[base]) ?? 0) : 0) : (item.cells[index] ? (cellNumber(item.cells[index]) ?? 0) : 0)), 0);
    if (base !== undefined) {
      cell.numFmt = XLSX_FORMATS.percent;
      const knownAny = allRows.some((item) => item.cells[base] && cellNumber(item.cells[base]) !== null);
      const shown = rows.reduce((acc, item) => acc + (item.cells[base] ? (cellNumber(item.cells[base]) ?? 0) : 0), 0);
      cell.value = knownAny && sumValue > 0 ? (cut ? shown / sumValue : { formula: `SUM(${letter(columns[index])}${first}:${letter(columns[index])}${last})`, result: 1 }) : knownAny ? 0 : DASH;
      return;
    }
    const format = sample ? kpiFormat(sample) : metric.type === "money" ? XLSX_FORMATS.money : XLSX_FORMATS.int;
    if (format) cell.numFmt = format;
    const display = metric.type === "money" ? sumValue / 100 : sumValue;
    cell.value = rows.length > 0 && display !== 0 && !cut ? { formula: `SUM(${letter(columns[index])}${first}:${letter(columns[index])}${last})`, result: display } : display;
  });

  // Data bar lilás na participação (se houver).
  const shareIndex = metrics.findIndex((_, index) => shareBase(index) !== undefined);
  if (shareIndex >= 0 && rows.length > 0) {
    const column = letter(columns[shareIndex]);
    ws.addConditionalFormatting({ ref: `${column}${first}:${column}${last}`, rules: [{ type: "dataBar", priority: 1, cfvo: [{ type: "num", value: 0 }, { type: "num", value: 1 }], color: { argb: COLOR.bar } }] as unknown as ExcelJS.ConditionalFormattingRule[] });
  }
  return totalRow + 2;
}

// ---------- Workbook ----------

export async function renderXlsx(spec: XlsxSpec): Promise<Buffer> {
  // Import dinâmico: exceljs é pesado e só roda no servidor (fora do bundle do cliente).
  const mod = (await import("exceljs")) as unknown as { default?: typeof ExcelJS } & typeof ExcelJS;
  const Excel = mod.default ?? mod;
  const wb = new Excel.Workbook();
  wb.creator = "Harmonize+";
  wb.lastModifiedBy = "Harmonize+";
  wb.company = spec.clinicName;
  wb.title = spec.properties.title;
  wb.subject = spec.properties.subject;
  const generated = new Date(spec.properties.generatedAtIso);
  wb.created = generated;
  wb.modified = generated;
  wb.calcProperties = { fullCalcOnLoad: true };

  // O Resumo é criado primeiro (ordem das abas) e preenchido por último, quando as abas de dados já existem para as fórmulas.
  const summary = wb.addWorksheet("Resumo", { views: [{ showGridLines: false }] });
  const usedSheets = new Set<string>(["resumo"]);
  const usedTables = new Set<string>();
  const layouts: Layouts = new Map();
  for (const sheet of spec.sheets) {
    const name = uniqueName(usedSheets, sheet.name, sheetName);
    // As expressões se referem ao nome original do DataSheet: o mapa usa esse nome.
    layouts.set(sheet.name, writeDataSheet(wb, sheet, name, usedTables));
  }
  writeSummary(summary, spec, layouts);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

