// Helpers compartilhados pelos builders de documento (puros).
import { changePct, changePp, type SeriesPoint } from "../reports-rules.ts";
import { cellNumber, int, moneyOr, percentOr, unknown, unknownReasons, type Cell, type KpiItem, type Tone } from "../reports-document.ts";

// Algum KPI numérico diferente de zero = há dado exibido (o relatório não pode ser tratado como vazio).
export const kpisHaveData = (items: KpiItem[]) => items.some((item) => { const value = cellNumber(item.value); return value !== null && value !== 0; });

export const pctOf = (part: number, total: number) => (total > 0 ? (part / total) * 100 : null);

// KPI com período anterior e variação (quando há comparação). previous undefined/null = sem comparação.
export function kpi(key: string, label: string, value: Cell, options: { previous?: Cell | null; change?: number | null; changeKind?: "pct" | "pp"; hint?: string; tone?: Tone } = {}): KpiItem {
  return { key, label, value, previous: options.previous ?? null, change: options.change ?? null, changeKind: options.changeKind ?? "pct", hint: options.hint, tone: options.tone };
}

export const countKpi = (key: string, label: string, current: number, previous?: number | null, hint?: string): KpiItem =>
  kpi(key, label, int(current), { previous: previous === null || previous === undefined ? null : int(previous), change: previous === null || previous === undefined ? null : changePct(current, previous), hint });

export const moneyKpi = (key: string, label: string, current: number | null, previous: number | null | undefined, reason: string, hint?: string, tone?: Tone): KpiItem =>
  kpi(key, label, moneyOr(current, reason), { previous: previous === null || previous === undefined ? null : moneyOr(previous, reason), change: previous === null || previous === undefined ? null : changePct(current, previous), hint, tone });

export const rateKpi = (key: string, label: string, current: number | null, previous: number | null | undefined, hint?: string): KpiItem =>
  kpi(key, label, percentOr(current, unknownReasons.noData), { previous: previous === undefined ? null : percentOr(previous, unknownReasons.noData), change: previous === undefined ? null : changePp(current, previous), changeKind: "pp", hint });

// Série atual/anterior -> linhas: período anterior desconhecido ("sem base de comparação") quando a posição não existe.
export const previousCell = (point: SeriesPoint, build: (value: number) => Cell): Cell => (point.previous === null ? unknown(unknownReasons.noBase) : build(point.previous));

export const toneForSigned = (value: number | null): Tone | undefined => (value !== null && value < 0 ? "negative" : undefined);
