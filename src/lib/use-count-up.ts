"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { COUNT_UP_DURATION_MS, countUpValueAt, resolveCountUpDuration, toFiniteNumber } from "@/lib/count-up-rules";
import { prefersReducedMotion } from "@/lib/use-reveal-on-view";

const defaultFormat = (value: number) => String(Math.round(value));

type CountUpOptions = {
  duration?: number;
  /** Valor inicial da PRIMEIRA animação (padrão 0). Mudanças posteriores partem do valor exibido. */
  from?: number;
  /** Formatador atual da tela (Intl/currency.format...), aplicado ao valor interpolado. */
  format?: (value: number) => string;
  /** false mantém o valor inicial parado (ex.: elemento ainda fora da viewport). */
  enabled?: boolean;
};

/**
 * Conta do `from` (1ª exibição) ou do valor anterior (mudança) até `value` em ease-out.
 * O 1º render (servidor e hidratação) já traz o valor final; o início em `from` é aplicado antes da pintura.
 * Mesmo valor em novo render não reanima. Reduced-motion mostra o valor final.
 */
export function useCountUp(value: number | null | undefined, { duration = COUNT_UP_DURATION_MS, from = 0, format = defaultFormat, enabled = true }: CountUpOptions = {}) {
  const target = toFiniteNumber(value);
  const startValue = toFiniteNumber(from);
  const [display, setDisplay] = useState(target);
  const shown = useRef(target);
  const started = useRef(false);
  const length = resolveCountUpDuration(duration);

  useLayoutEffect(() => {
    const show = (next: number) => {
      shown.current = next;
      setDisplay(next);
    };
    if (prefersReducedMotion()) {
      started.current = true;
      show(target);
      return;
    }
    if (!enabled) {
      if (!started.current) show(startValue);
      return;
    }
    const origin = started.current ? shown.current : startValue;
    started.current = true;
    if (origin === target) {
      show(target);
      return;
    }
    shown.current = origin;
    setDisplay(origin);
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const elapsed = now - startedAt;
      show(countUpValueAt(origin, target, elapsed, length));
      if (elapsed < length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, enabled, length, startValue]);

  return { value: display, text: format(display), finalText: format(target), animating: display !== target };
}
