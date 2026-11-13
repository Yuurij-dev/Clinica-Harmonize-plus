// Regras puras da tela de Relatórios (sem React, sem banco): presets e rótulos de período, filtros -> chave de cache/URL,
// formatação pt-BR e variação. Também usadas pela exportação (reports-export-rules.ts). Datas em AAAA-MM-DD.
import { parseDateOnly } from "./clinic-time.ts";
import { MAX_RANGE_DAYS, daysBetween, type ReportGranularity, type ReportPeriod } from "./reports-rules.ts";

export const periodPresets: ReadonlyArray<{ value: ReportPeriod; label: string }> = [
  { value: "today", label: "Hoje" },
  { value: "last7", label: "Últimos 7 dias" },
  { value: "last30", label: "Últimos 30 dias" },
  { value: "month", label: "Este mês" },
  { value: "prevMonth", label: "Mês anterior" },
  { value: "year", label: "Este ano" },
  { value: "custom", label: "Personalizado" },
];

export function periodPresetLabel(period: string) {
  return periodPresets.find((preset) => preset.value === period)?.label ?? "Período";
}

export const granularityLabels: Record<ReportGranularity, string> = { day: "Diário", week: "Semanal", month: "Mensal" };

// AAAA-MM-DD -> DD/MM/AAAA (texto fora do formato volta como veio).
export function formatDateBr(day: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : day;
}

// "01/11/2026 – 30/11/2026"; um dia só mostra a data uma vez.
export function formatRangeLabel(range: { start: string; end: string }) {
  return range.start === range.end ? formatDateBr(range.start) : `${formatDateBr(range.start)} – ${formatDateBr(range.end)}`;
}

// Mensagem de erro do período personalizado (null = válido). Espelha as regras do servidor (400).
export function customRangeError(from: string, to: string) {
  if (!from || !to) return "Informe as datas inicial e final.";
  if (!parseDateOnly(from) || !parseDateOnly(to)) return "Datas inválidas.";
  if (from > to) return "A data inicial deve ser anterior ou igual à final.";
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) return `O período pode ter no máximo ${MAX_RANGE_DAYS} dias.`;
  return null;
}

export type ReportFilters = {
  period: ReportPeriod;
  from: string;
  to: string;
  compare: boolean;
  professional: string;
  // null = padrão do servidor para o tamanho do período.
  granularity: ReportGranularity | null;
};

// Query estável (ordem fixa) com todos os parâmetros que mudam a resposta; from/to só no período personalizado.
export function reportQueryString(filters: ReportFilters) {
  const params = new URLSearchParams({ period: filters.period });
  if (filters.period === "custom") {
    params.set("from", filters.from);
    params.set("to", filters.to);
  }
  if (filters.compare) params.set("compare", "1");
  const professional = filters.professional.trim();
  if (professional) params.set("professional", professional);
  if (filters.granularity) params.set("granularity", filters.granularity);
  return params.toString();
}

// Chave de cache = a própria URL (ver docs/data-loading.md).
export function reportKey(path: string, filters: ReportFilters) {
  return `${path}?${reportQueryString(filters)}`;
}

// ---------- Formatação pt-BR ----------

// Número pt-BR sem Intl (saída idêntica em qualquer ambiente). `trim` tira zeros à direita das casas.
export function formatNumberPtBr(value: number, decimals = 0, options: { group?: boolean; trim?: boolean } = {}) {
  const group = options.group ?? true;
  const fixed = Math.abs(value).toFixed(decimals);
  const [integer, fraction = ""] = fixed.split(".");
  const cleanFraction = options.trim ? fraction.replace(/0+$/, "") : fraction;
  const body = (group ? integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : integer) + (cleanFraction ? `,${cleanFraction}` : "");
  return value < 0 && Number(fixed) !== 0 ? `-${body}` : body;
}

// "R$ 1.234,56" com espaço comum (não NBSP).
export function formatMoneyBr(cents: number) {
  const value = formatNumberPtBr(cents / 100, 2);
  return value.startsWith("-") ? `-R$ ${value.slice(1)}` : `R$ ${value}`;
}

// Eixo de gráfico: "R$ 950", "R$ 1k", "R$ 1,5k".
export function compactMoney(reais: number) {
  const abs = Math.abs(reais);
  const sign = reais < 0 ? "-" : "";
  if (abs >= 1000) return `${sign}R$ ${formatNumberPtBr(abs / 1000, 1, { trim: true })}k`;
  return `${sign}R$ ${formatNumberPtBr(abs, 0)}`;
}

export function formatPctBr(value: number, decimals = 1) {
  return `${formatNumberPtBr(value, decimals, { trim: true })}%`;
}

export type VariationInfo = { direction: "up" | "down" | "flat" | "none"; text: string };

// Variação para os cards: kind "pct" = %, "pp" = pontos percentuais. null/undefined/NaN = "—" (sem base de comparação).
export function variationInfo(value: number | null | undefined, kind: "pct" | "pp" = "pct"): VariationInfo {
  if (value === null || value === undefined || !Number.isFinite(value)) return { direction: "none", text: "—" };
  const unit = kind === "pp" ? " p.p." : "%";
  const rounded = Math.round(Math.abs(value) * 10) / 10;
  if (rounded === 0) return { direction: "flat", text: `0${unit}` };
  return { direction: value > 0 ? "up" : "down", text: `${formatNumberPtBr(rounded, 1, { trim: true })}${unit}` };
}

// A resposta de visão geral já corresponde aos filtros atuais? (para marcar "atualizando" enquanto a nova chega)
export function overviewMatchesFilters(
  data: { range: { period: string; start: string; end: string }; previousRange: unknown; appliedProfessional: string | null; series: { granularity: string }; professionals: string[] },
  filters: ReportFilters,
) {
  if (data.range.period !== filters.period) return false;
  if (filters.period === "custom" && (data.range.start !== filters.from || data.range.end !== filters.to)) return false;
  if (Boolean(data.previousRange) !== filters.compare) return false;
  if (filters.granularity && data.series.granularity !== filters.granularity) return false;
  // Quem não escolhe profissional (lista vazia) tem o filtro forçado pelo servidor.
  if (data.professionals.length > 0 && (data.appliedProfessional ?? "") !== filters.professional.trim()) return false;
  return true;
}

const limitationTexts: Record<string, string> = {
  payment_without_professional: "Pagamentos não são vinculados a profissional, procedimento ou orçamento: não há receita por profissional.",
  category_not_registered: "Procedimentos não têm categoria cadastrada: não há receita por categoria.",
  forbidden: "Seu cargo não tem acesso aos dados financeiros.",
};

export function limitationText(code: string | null | undefined) {
  return code ? (limitationTexts[code] ?? code) : null;
}
