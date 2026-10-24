// Regras puras das micro-animações de dados (count-up, barras de progresso, stagger). Sem DOM nem React.

export const COUNT_UP_DURATION_MS = 550;
export const COUNT_UP_MIN_DURATION_MS = 150;
/** Pausa máxima esperando a entrada em cascata da página (AnimatedPage) antes de iniciar uma animação de dado. */
export const MAX_REVEAL_WAIT_MS = 150;

export function easeOutCubic(progress: number) {
  const clamped = Math.min(1, Math.max(0, progress));
  return 1 - (1 - clamped) ** 3;
}

/** Valores não numéricos (NaN, Infinity, undefined, null) viram 0 para o contador nunca exibir "NaN". */
export function toFiniteNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function resolveCountUpDuration(duration: number | undefined) {
  return Math.max(COUNT_UP_MIN_DURATION_MS, toFiniteNumber(duration, COUNT_UP_DURATION_MS));
}

/** Valor interpolado após `elapsedMs`; no fim devolve exatamente `to` (sem resíduo de ponto flutuante). */
export function countUpValueAt(from: number, to: number, elapsedMs: number, durationMs: number) {
  if (!(durationMs > 0) || elapsedMs >= durationMs) return to;
  if (elapsedMs <= 0) return from;
  return from + (to - from) * easeOutCubic(elapsedMs / durationMs);
}

/** Escala (0..1) de uma barra de progresso a partir de um percentual; valores inválidos ou fora da faixa são limitados. */
export function progressScale(value: unknown) {
  return Math.min(1, Math.max(0, toFiniteNumber(value) / 100));
}

/** Atraso em cascata (ms) para o item `index`, com teto para listas longas. */
export function staggerDelay(index: number, stepMs: number, maxIndex = 12) {
  return Math.min(Math.max(0, Math.floor(toFiniteNumber(index))), maxIndex) * stepMs;
}
