// Especificação do XLSX dos Relatórios (pura): cada relatório só descreve KPIs, tabela agregada e as linhas de detalhe; o
// motor compartilhado (reports-xlsx-layout.ts) escreve o workbook no layout do modelo. Aqui também ficam as expressões que viram
// FÓRMULAS (COUNTA/SUM/COUNTIFS/SUMIFS/IFERROR) e o cálculo equivalente em JS, usado para só emitir a fórmula quando o resultado
// bate com o valor do documento (o KPI da tela). Importado direto pelo node:test.
import { cellDisplay, cellNumber, type Cell, type ColumnType } from "./reports-document.ts";

export type DataColumn = {
  key: string;
  label: string;
  type: ColumnType;
  width?: number;
  // Coluna somável: a linha de Total usa SUBTOTAL(109, ...).
  sum?: boolean;
  // Coluna calculada (ex.: Margem = A − B): a célula leva a fórmula quando o valor é conhecido.
  minus?: [string, string];
};

// Linhas de detalhe: células tipadas na ordem das colunas. Desconhecido (unknown) vira célula VAZIA na tabela.
export type DataSheet = {
  name: string;
  columns: DataColumn[];
  rows: Cell[][];
  truncated: { shown: number; total: number } | null;
};

// Critério de agregação: coluna igual a um dos valores (ou, com "<>" na frente, diferente). keyRef = usa a célula-chave da
// linha do agregado em vez do texto literal (o motor troca pelo endereço, ex.: B15).
export type Criterion = { column: string; anyOf: string[]; keyRef?: boolean };
export type Agg = { fn: "count" | "sum" | "numbers"; sheet: string; column: string; criteria?: Criterion[] };
export type Expr = { agg: Agg } | { op: "add" | "sub" | "div"; a: Expr; b: Expr };

export const count = (sheet: string, column: string, criteria?: Criterion[]): Expr => ({ agg: { fn: "count", sheet, column, criteria } });
export const sum = (sheet: string, column: string, criteria?: Criterion[]): Expr => ({ agg: { fn: "sum", sheet, column, criteria } });
export const numbers = (sheet: string, column: string): Expr => ({ agg: { fn: "numbers", sheet, column } });
export const add = (a: Expr, b: Expr): Expr => ({ op: "add", a, b });
export const sub = (a: Expr, b: Expr): Expr => ({ op: "sub", a, b });
export const div = (a: Expr, b: Expr): Expr => ({ op: "div", a, b });
export const is = (column: string, ...anyOf: string[]): Criterion => ({ column, anyOf });
export const isKey = (column: string, key: string): Criterion => ({ column, anyOf: [key], keyRef: true });

export type KpiSpec = { label: string; value: Cell; expr?: Expr | null };
export type KpiGroupSpec = { title?: string; items: KpiSpec[] };

// Tabela agregada do Resumo: chave em B e até 4 métricas em D, F, H, J. share = participação (%) sobre outra métrica.
export type AggregateMetric = { label: string; type: "int" | "money" | "decimal" | "percent"; share?: number };
export type AggregateRow = { key: string; cells: Cell[]; exprs: Array<Expr | null> };
export type AggregateSpec = { title: string; keyLabel: string; metrics: AggregateMetric[]; rows: AggregateRow[] };

export type XlsxSpec = {
  kind: string;
  title: string; // "Relatório de Procedimentos"
  description: string;
  clinicName: string;
  filters: { period: string; professional: string; grouping: string; comparison: string; generatedAt: string };
  kpiGroups: KpiGroupSpec[];
  aggregate: AggregateSpec | null;
  sheets: DataSheet[];
  notes: string[];
  // Período sem nenhum dado exibido: no lugar do agregado, "Nenhuma movimentação no período".
  empty: boolean;
  properties: { title: string; subject: string; generatedAtIso: string };
};

// ---------- Cálculo em JS (espelha as fórmulas) ----------

const textOf = (cell: Cell | undefined) => (cell === undefined || cell.type === "unknown" ? "" : cell.type === "text" ? cell.value : cellDisplay(cell));

// Igualdade do COUNTIF: sem diferenciar maiúsculas; "<>x" = diferente de x.
function matches(value: string, criterion: string) {
  if (criterion.startsWith("<>")) return value.toLowerCase() !== criterion.slice(2).toLowerCase();
  return value.toLowerCase() === criterion.toLowerCase();
}

export function sheetByName(sheets: DataSheet[], name: string) {
  return sheets.find((sheet) => sheet.name === name);
}

export function exprSheets(expr: Expr, into = new Set<string>()): Set<string> {
  if ("agg" in expr) into.add(expr.agg.sheet);
  else { exprSheets(expr.a, into); exprSheets(expr.b, into); }
  return into;
}

export function computeExpr(expr: Expr, sheets: DataSheet[], key?: string): number | null {
  if ("agg" in expr) {
    const { agg } = expr;
    const sheet = sheetByName(sheets, agg.sheet);
    if (!sheet) return null;
    const column = sheet.columns.findIndex((item) => item.key === agg.column);
    if (column < 0) return null;
    const lookups = (agg.criteria ?? []).map((criterion) => ({ index: sheet.columns.findIndex((item) => item.key === criterion.column), values: criterion.keyRef ? [key ?? ""] : criterion.anyOf }));
    if (lookups.some((lookup) => lookup.index < 0)) return null;
    let total = 0;
    for (const row of sheet.rows) {
      if (!lookups.every((lookup) => lookup.values.some((value) => matches(textOf(row[lookup.index]), value)))) continue;
      const cell = row[column];
      if (agg.fn === "count") { if (lookups.length > 0 || (cell && cell.type !== "unknown" && textOf(cell) !== "")) total += 1; }
      else if (agg.fn === "numbers") { if (cell && cellNumber(cell) !== null) total += 1; }
      else { const value = cell ? cellNumber(cell) : null; if (value !== null) total += value; }
    }
    return total;
  }
  const a = computeExpr(expr.a, sheets, key);
  const b = computeExpr(expr.b, sheets, key);
  if (a === null || b === null) return null;
  if (expr.op === "add") return a + b;
  if (expr.op === "sub") return a - b;
  return b === 0 ? 0 : a / b; // IFERROR(a/b, 0)
}

// ---------- Texto da fórmula ----------

export type RangeFn = (sheet: string, column: string) => string;

const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;

function combos(lists: string[][]): string[][] {
  return lists.reduce<string[][]>((acc, list) => acc.flatMap((prefix) => list.map((value) => [...prefix, value])), [[]]);
}

export function exprFormula(expr: Expr, range: RangeFn, keyAddress?: string): string {
  if ("agg" in expr) {
    const { agg } = expr;
    const target = range(agg.sheet, agg.column);
    const criteria = agg.criteria ?? [];
    if (criteria.length === 0) return agg.fn === "count" ? `COUNTA(${target})` : agg.fn === "sum" ? `SUM(${target})` : `COUNT(${target})`;
    const terms = combos(criteria.map((criterion) => (criterion.keyRef ? [keyAddress ?? '""'] : criterion.anyOf.map(quote)))).map((values) => {
      const pairs = criteria.map((criterion, index) => `${range(agg.sheet, criterion.column)},${values[index]}`).join(",");
      if (agg.fn === "sum") return `SUMIFS(${target},${pairs})`;
      return criteria.length === 1 ? `COUNTIF(${pairs})` : `COUNTIFS(${pairs})`;
    });
    return terms.length === 1 ? terms[0] : `(${terms.join("+")})`;
  }
  const a = exprFormula(expr.a, range, keyAddress);
  const b = exprFormula(expr.b, range, keyAddress);
  if (expr.op === "add") return `(${a}+${b})`;
  if (expr.op === "sub") return `(${a}-${b})`;
  return `IFERROR(${a}/${b},0)`;
}

// Chave segura como critério de COUNTIF/SUMIFS: sem operadores, curingas nem aparência de número/data (que o Excel reinterpreta).
// Também recusa notação científica ("1e5"), TRUE/FALSE, chaves iniciadas por "#" (erros do Excel) e chaves acima de 250 caracteres
// (limite de critério do COUNTIF/SUMIFS): nesses casos o motor grava o valor, sem fórmula.
export function safeCriterionKey(value: string) {
  return value.length > 0 && value.length <= 250 && !/^[=<>#]/.test(value) && !/[*?~]/.test(value) && !/^[\d\s/.,:%+-]+$/.test(value) && !/^\d+(e[+-]?\d+)?$/i.test(value) && !/^(true|false)$/i.test(value);
}
