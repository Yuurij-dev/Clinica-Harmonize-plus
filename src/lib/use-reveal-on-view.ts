"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_REVEAL_WAIT_MS } from "@/lib/count-up-rules";

export function prefersReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Tempo restante da entrada em cascata da página (AnimatedPage) do cartão que contém o elemento.
 * Assim o dado só anima quando o cartão já está aparecendo, sem animar por baixo de um bloco invisível
 * e sem atraso nenhum quando o elemento aparece depois (dados que chegam da rede).
 */
export function revealWaitMs(element: Element) {
  const card = element.closest("[data-hp-reveal-item]");
  if (!card || typeof card.getAnimations !== "function") return 0;
  let wait = 0;
  for (const animation of card.getAnimations()) {
    const timing = animation.effect?.getComputedTiming();
    if (!timing) continue;
    const remaining = (Number(timing.delay) || 0) - (Number(animation.currentTime) || 0);
    if (remaining > wait) wait = remaining;
  }
  return Math.min(MAX_REVEAL_WAIT_MS, wait);
}

/**
 * Dispara uma vez, quando o elemento entra na viewport (e a entrada em cascata do cartão começou).
 * Primeiro render sempre `false` (igual no servidor); com reduced-motion vira `true` direto.
 */
export function useRevealOnView<T extends Element = HTMLElement>(options: { threshold?: number; delayMs?: number } = {}) {
  const ref = useRef<T | null>(null);
  const [revealed, setRevealed] = useState(false);
  const threshold = options.threshold ?? 0.1;
  const delayMs = Math.max(0, options.delayMs ?? 0);

  useEffect(() => {
    const element = ref.current;
    if (!element || revealed) return;
    let timer = 0;
    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      timer = window.setTimeout(() => setRevealed(true), 0);
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      const wait = revealWaitMs(element) + delayMs;
      if (wait > 0) timer = window.setTimeout(() => setRevealed(true), wait);
      else setRevealed(true);
    }, { threshold });
    observer.observe(element);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [revealed, threshold, delayMs]);

  return [ref, revealed] as const;
}
