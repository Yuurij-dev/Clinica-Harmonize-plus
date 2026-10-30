// Agendamento do autosave de rascunhos. Sem `maxWait` é o debounce de sempre (espera `delay` desde a última edição).
// Com `maxWait` há um teto: a gravação acontece no máximo `maxWait` ms depois da PRIMEIRA alteração ainda não salva,
// mesmo que a pessoa continue editando sem pausa; o que vier primeiro (pausa de `delay` ou o teto) dispara.

/** Tempo (ms) até a próxima gravação, a partir de `now`, dado o instante da primeira alteração não salva. */
export function autosaveWaitMs({ now, firstDirtyAt, delay, maxWait }: { now: number; firstDirtyAt: number | null; delay: number; maxWait?: number }) {
  if (maxWait === undefined || firstDirtyAt === null) return delay;
  const untilCap = firstDirtyAt + maxWait - now;
  return Math.max(0, Math.min(delay, untilCap));
}
