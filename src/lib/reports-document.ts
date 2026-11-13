// Modelo de documento dos Relatórios (puro, sem banco): construído uma vez por relatório (reports-documents/*) e
// renderizado por tela, XLSX, PDF e CSV. Importado direto pelo node:test (imports relativos com extensão .ts).
// Semântica obrigatória: valor DESCONHECIDO (null + motivo) nunca vira zero; zero real aparece como 0 / R$ 0,00.
import { clinicTimeZone } from "./clinic-time.ts";
import { formatDateBr, formatMoneyBr, formatNumberPtBr, formatPctBr, formatRangeLabel } from "./reports-ui-rules.ts";

// ---------- Relatórios (catálogo) ----------

export const reportIds = ["finance", "procedures", "professionals", "appointments", "clients", "quotes", "stock"] as const;
export type ReportId = (typeof reportIds)[number];
// "overview" (indicadores gerais) e "all" (consolidado) também geram documento, mas não são cartões da central.
export type ReportKind = ReportId | "overview" | "all";
export type ReportCategory = "Financeiro" | "Operação" | "Clientes" | "Estoque";
export const reportCategories: readonly ReportCategory[] = ["Financeiro", "Operação", "Clientes", "Estoque"];
// Capacidade exigida além de reports:access (mesmos nomes de ReportAccess.capabilities).
export type ReportNeed = "finance" | "quotes" | "stock" | null;

export type ReportDefinition = {
  id: ReportKind;
  label: string;
  category: ReportCategory;
  description: string;
  need: ReportNeed;
  // Permissão do projeto equivalente (documentação/UI); reports:access é sempre exigida.
  permission: "reports:access" | "finance:access" | "quotes:access" | "stock:access";
  // Nome de ícone sugerido (a UI mapeia para o componente de ícone); string pura para manter o módulo sem React.
  icon: string;
  // Trecho do nome do arquivo (somente [A-Za-z0-9]).
  fileLabel: string;
};

export const reportDefinitions: Record<ReportKind, ReportDefinition> = {
  finance: { id: "finance", label: "Financeiro", category: "Financeiro", description: "Recebido, despesas pagas, resultado, a receber, a pagar e formas de pagamento.", need: "finance", permission: "finance:access", icon: "wallet", fileLabel: "Financeiro" },
  quotes: { id: "quotes", label: "Orçamentos", category: "Financeiro", description: "Funil de orçamentos, conversão e valor por status.", need: "quotes", permission: "quotes:access", icon: "file-text", fileLabel: "Orcamentos" },
  procedures: { id: "procedures", label: "Procedimentos", category: "Operação", description: "Execuções, valor de tabela, custo de material e quem executa.", need: null, permission: "reports:access", icon: "syringe", fileLabel: "Procedimentos" },
  professionals: { id: "professionals", label: "Profissionais", category: "Operação", description: "Realizados, faltas, cancelamentos e produção por profissional.", need: null, permission: "reports:access", icon: "users", fileLabel: "Profissionais" },
  appointments: { id: "appointments", label: "Agendamentos", category: "Operação", description: "Concluídos, cancelados, faltas, pendentes e taxas de comparecimento.", need: null, permission: "reports:access", icon: "calendar", fileLabel: "Agendamentos" },
  clients: { id: "clients", label: "Clientes", category: "Clientes", description: "Base cadastrada, novos, ativos, recorrentes e frequência (sem nomes).", need: null, permission: "reports:access", icon: "user-round", fileLabel: "Clientes" },
  stock: { id: "stock", label: "Estoque", category: "Estoque", description: "Posição atual, movimentações do período e consumo com custo.", need: "stock", permission: "stock:access", icon: "package", fileLabel: "Estoque" },
  overview: { id: "overview", label: "Visão geral", category: "Operação", description: "Indicadores gerais do período.", need: null, permission: "reports:access", icon: "layout-dashboard", fileLabel: "VisaoGeral" },
  all: { id: "all", label: "Consolidado", category: "Operação", description: "Capa e resumo de cada relatório permitido.", need: null, permission: "reports:access", icon: "layers", fileLabel: "Consolidado" },
};

export function isReportKind(value: unknown): value is ReportKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(reportDefinitions, value);
}

// Relatórios (cartões da central) que o usuário pode abrir, na ordem do catálogo.
export function allowedReportIds(capabilities: { finance: boolean; quotes: boolean; stock: boolean }): ReportId[] {
  return reportIds.filter((id) => {
    const need = reportDefinitions[id].need;
    return need === null || capabilities[need];
  });
}

// ---------- Células tipadas ----------

export type Cell =
  | { type: "text"; value: string }
  | { type: "int"; value: number }
  | { type: "decimal"; value: number }
  | { type: "money"; value: number } // centavos
  | { type: "percent"; value: number } // 0–100
  | { type: "date"; value: string } // AAAA-MM-DD
  | { type: "datetime"; value: string } // ISO 8601 (instante)
  | { type: "unknown"; reason: string };

export type ColumnType = "text" | "int" | "decimal" | "money" | "percent" | "date" | "datetime";
export type Align = "left" | "right" | "center";
export type Column = { key: string; label: string; type: ColumnType; width?: number; align?: Align; total?: "sum" | "none" };
export type Tone = "negative" | "positive" | "warning" | "muted";
export type Row = { cells: Cell[]; tone?: Tone };

// Motivos padronizados de célula desconhecida (renderizados como "—" com nota).
export const unknownReasons = {
  noCost: "sem custo cadastrado",
  noSheet: "sem ficha técnica",
  noData: "sem dados no período",
  notApplicable: "não aplicável",
  noBase: "sem base de comparação",
  noPrice: "procedimento sem preço cadastrado",
  restricted: "restrito ao seu perfil",
} as const;

const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

export const text = (value: string | null | undefined): Cell => ({ type: "text", value: value ?? "" });
export const unknown = (reason: string): Cell => ({ type: "unknown", reason });
export const int = (value: number): Cell => ({ type: "int", value: Math.round(value) });
export const decimal = (value: number): Cell => ({ type: "decimal", value });
export const money = (cents: number): Cell => ({ type: "money", value: Math.round(cents) });
export const percent = (value: number): Cell => ({ type: "percent", value });
export const date = (day: string): Cell => ({ type: "date", value: day });
export const datetime = (iso: string): Cell => ({ type: "datetime", value: iso });

// null/NaN -> célula desconhecida com o motivo; zero continua zero.
export const intOr = (value: number | null | undefined, reason: string): Cell => (finite(value) ? int(value) : unknown(reason));
export const decimalOr = (value: number | null | undefined, reason: string): Cell => (finite(value) ? decimal(value) : unknown(reason));
export const moneyOr = (cents: number | null | undefined, reason: string): Cell => (finite(cents) ? money(cents) : unknown(reason));
export const percentOr = (value: number | null | undefined, reason: string): Cell => (finite(value) ? percent(value) : unknown(reason));
export const dateOr = (day: string | null | undefined, reason: string): Cell => (day ? date(day) : unknown(reason));

export const isUnknown = (cell: Cell): cell is { type: "unknown"; reason: string } => cell.type === "unknown";

// Valor numérico da célula (null para texto/data/desconhecido). Dinheiro em centavos, percentual 0–100.
export function cellNumber(cell: Cell): number | null {
  return cell.type === "int" || cell.type === "decimal" || cell.type === "money" || cell.type === "percent" ? cell.value : null;
}

export const UNKNOWN_DISPLAY = "—";

export function formatDateTimeBr(iso: string) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: clinicTimeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(parsed);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")}`;
}

// Texto de exibição (tela/PDF). Desconhecido = "—"; o motivo vai em notas ou tooltip (cellReason).
export function cellDisplay(cell: Cell): string {
  switch (cell.type) {
    case "text": return cell.value;
    case "int": return formatNumberPtBr(cell.value, 0);
    case "decimal": return formatNumberPtBr(cell.value, 3, { trim: true });
    case "money": return formatMoneyBr(cell.value);
    case "percent": return formatPctBr(cell.value);
    case "date": return formatDateBr(cell.value);
    case "datetime": return formatDateTimeBr(cell.value);
    case "unknown": return UNKNOWN_DISPLAY;
  }
}

export const cellReason = (cell: Cell) => (cell.type === "unknown" ? cell.reason : null);

// ---------- Seções ----------

export type KpiItem = {
  key: string;
  label: string;
  value: Cell;
  hint?: string;
  tone?: Tone;
  // Período anterior (quando há comparação) e variação (% ou p.p., conforme changeKind).
  previous?: Cell | null;
  change?: number | null;
  changeKind?: "pct" | "pp";
};

export type KpiSection = { type: "kpis"; id: string; title?: string; items: KpiItem[] };

export type TableSection = {
  type: "table";
  id: string;
  title: string;
  columns: Column[];
  rows: Row[];
  total: Row | null;
  notes: string[];
  // Quando a lista foi limitada: exibindo `shown` de `total` linhas.
  truncated: { shown: number; total: number } | null;
  // true = tabela detalhada (aba "Dados" do XLSX); false = análise/agrupamento.
  detail?: boolean;
};

export type ChartKind = "bar" | "line" | "donut";
export type ChartSeries = { name: string; values: Array<number | null>; style?: "current" | "previous" };
export type ChartSection = { type: "chart"; id: string; title: string; kind: ChartKind; unit: "int" | "money" | "percent"; categories: string[]; series: ChartSeries[] };
export type NoteSection = { type: "note"; id: string; tone: "info" | "warning"; text: string };
export type Section = KpiSection | TableSection | ChartSection | NoteSection;

export type DocumentFilter = { label: string; value: string };
export type DocumentPeriod = { from: string; to: string; label: string };

export type ReportDocument = {
  kind: ReportKind;
  title: string;
  subtitle: string;
  clinicName: string;
  period: DocumentPeriod;
  comparePeriod: DocumentPeriod | null;
  filters: DocumentFilter[];
  generatedAt: string; // ISO
  // false = relatório sem movimentação no período: só capa + nota (sem gráficos).
  hasData: boolean;
  sections: Section[];
};

// ---------- Identificação ----------

export type DocumentInput = {
  clinicName: string;
  range: { start: string; end: string };
  previous: { start: string; end: string } | null;
  professional: string | null;
  granularityLabel?: string | null;
  generatedAt: string;
  extraFilters?: DocumentFilter[];
};

export const periodOf = (range: { start: string; end: string }): DocumentPeriod => ({ from: range.start, to: range.end, label: formatRangeLabel(range) });

export function documentFilters(input: Pick<DocumentInput, "professional" | "granularityLabel" | "extraFilters">): DocumentFilter[] {
  const filters: DocumentFilter[] = [{ label: "Profissional", value: input.professional ?? "Todos os profissionais" }];
  if (input.granularityLabel) filters.push({ label: "Agrupamento", value: input.granularityLabel });
  return [...filters, ...(input.extraFilters ?? [])];
}

export function baseDocument(kind: ReportKind, input: DocumentInput, extra: { subtitle?: string; sections: Section[]; hasData: boolean }): ReportDocument {
  const definition = reportDefinitions[kind];
  return {
    kind,
    title: definition.label,
    subtitle: extra.subtitle ?? definition.description,
    clinicName: input.clinicName,
    period: periodOf(input.range),
    comparePeriod: input.previous ? periodOf(input.previous) : null,
    filters: documentFilters(input),
    generatedAt: input.generatedAt,
    hasData: extra.hasData,
    sections: extra.sections,
  };
}

// ---------- Construtores de seção ----------

export const MAX_TABLE_ROWS = 5000;

export function limitRows<T>(rows: T[], max = MAX_TABLE_ROWS, totalCount = rows.length) {
  const shown = rows.length > max ? rows.slice(0, max) : rows;
  return { rows: shown, truncated: totalCount > shown.length ? { shown: shown.length, total: totalCount } : null };
}

export const truncatedNote = (truncated: { shown: number; total: number }) => `Exibindo ${formatNumberPtBr(truncated.shown)} de ${formatNumberPtBr(truncated.total)} linhas.`;

// Soma colunas somáveis ignorando células desconhecidas; coluna toda desconhecida (com linhas) = desconhecida.
// Total parcial: se alguma coluna somável tem célula desconhecida, o rótulo vira "Total (parcial)" (todos os formatos).
export function totalRow(columns: Column[], rows: Row[], label = "Total"): Row {
  let labelled = false;
  let partial = false;
  const cells = columns.map((column, index): Cell => {
    if (column.total !== "sum") {
      if (!labelled && column.type === "text") {
        labelled = true;
        return text(label);
      }
      return text("");
    }
    const values = rows.map((row) => row.cells[index]).filter((cell): cell is Cell => Boolean(cell));
    const numbers = values.map(cellNumber).filter(finite);
    if (values.some((cell) => cell.type === "unknown")) partial = true;
    if (numbers.length === 0) return values.length > 0 ? unknown(unknownReasons.noData) : zeroCell(column.type);
    const sum = numbers.reduce((acc, value) => acc + value, 0);
    return column.type === "money" ? money(sum) : column.type === "int" ? int(sum) : column.type === "percent" ? percent(sum) : decimal(Math.round(sum * 1000) / 1000);
  });
  if (partial) {
    const at = cells.findIndex((cell) => cell.type === "text" && cell.value === label);
    if (at >= 0) cells[at] = text(`${label} (parcial)`);
  }
  return { cells, tone: undefined };
}

function zeroCell(type: ColumnType): Cell {
  return type === "money" ? money(0) : type === "int" ? int(0) : type === "percent" ? percent(0) : type === "decimal" ? decimal(0) : text("");
}

export function table(input: { id: string; title: string; columns: Column[]; rows: Row[]; withTotal?: boolean; totalLabel?: string; notes?: Array<string | null | undefined>; truncated?: { shown: number; total: number } | null; detail?: boolean }): TableSection {
  const notes = (input.notes ?? []).filter((note): note is string => Boolean(note));
  if (input.truncated) notes.push(truncatedNote(input.truncated));
  return {
    type: "table",
    id: input.id,
    title: input.title,
    columns: input.columns,
    rows: input.rows,
    total: input.withTotal && input.rows.length > 0 && !input.truncated ? totalRow(input.columns, input.rows, input.totalLabel) : null,
    notes,
    truncated: input.truncated ?? null,
    detail: input.detail,
  };
}

export const row = (cells: Cell[], tone?: Tone): Row => ({ cells, tone });
export const col = (key: string, label: string, type: ColumnType, options: Partial<Pick<Column, "width" | "align" | "total">> = {}): Column => ({ key, label, type, ...options });

export const kpis = (id: string, items: KpiItem[], title?: string): KpiSection => ({ type: "kpis", id, title, items });
export const note = (id: string, textValue: string, tone: "info" | "warning" = "info"): NoteSection => ({ type: "note", id, tone, text: textValue });

export function chart(input: Omit<ChartSection, "type">): ChartSection | null {
  // Gráfico só quando há dados reais (algum valor não nulo e diferente de zero): nada de gráfico enganoso vazio.
  const hasValues = input.series.some((series) => series.values.some((value) => finite(value) && value !== 0));
  return hasValues && input.categories.length > 0 ? { type: "chart", ...input } : null;
}

export const compact = <T>(items: Array<T | null | undefined | false>): T[] => items.filter((item): item is T => Boolean(item));

// Alinhamento padrão por tipo (texto à esquerda, números à direita, datas centralizadas).
export function columnAlign(column: Column): Align {
  if (column.align) return column.align;
  return column.type === "text" ? "left" : column.type === "date" || column.type === "datetime" ? "center" : "right";
}

// ---------- Nome do arquivo ----------

export type ExportExtension = "xlsx" | "pdf" | "csv";

// Harmonize_<Relatorio>_<AAAA-MM-DD>_a_<AAAA-MM-DD>.<ext> (somente [A-Za-z0-9_.-]).
export function reportFileName(kind: ReportKind, range: { start: string; end: string }, extension: ExportExtension) {
  const safe = (value: string) => value.replace(/[^0-9-]/g, "");
  return `Harmonize_${reportDefinitions[kind].fileLabel}_${safe(range.start)}_a_${safe(range.end)}.${extension}`;
}

// Nome de aba do Excel: até 31 caracteres, sem : \ / ? * [ ] e sem apóstrofo nas pontas.
export function sheetName(value: string) {
  const cleaned = value.replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").trim().replace(/^'+|'+$/g, "");
  return (cleaned || "Planilha").slice(0, 31);
}

// Documento sem nenhuma movimentação: capa + nota padrão (sem gráficos).
export const EMPTY_NOTE = "Nenhuma movimentação no período.";
