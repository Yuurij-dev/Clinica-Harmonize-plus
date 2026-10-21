"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type SlidingIndicatorProps = {
  /** "line": barra inferior de 2px (abas). "block": fundo do item ativo (sidebar), desliza na vertical. */
  variant?: "line" | "block";
  className?: string;
};

/**
 * Indicador que desliza até o filho ativo do pai (aria-selected="true" ou aria-current="page").
 * O pai precisa ser `position: relative`. Só anima transform (translate + scaleX), medindo offsetLeft/offsetWidth.
 */
export function SlidingIndicator({ variant = "line", className }: SlidingIndicatorProps) {
  const ref = useRef<HTMLSpanElement>(null);

  function measure() {
    const indicator = ref.current;
    const parent = indicator?.parentElement;
    if (!indicator || !parent) return;
    const active = parent.querySelector<HTMLElement>('[aria-selected="true"], [aria-current="page"]');
    if (!active) {
      indicator.style.opacity = "0";
      return;
    }
    indicator.style.opacity = "1";
    if (variant === "line") {
      indicator.style.transform = `translate3d(${active.offsetLeft}px, 0, 0) scaleX(${active.offsetWidth})`;
    } else {
      indicator.style.height = `${active.offsetHeight}px`;
      indicator.style.transform = `translate3d(0, ${active.offsetTop}px, 0)`;
    }
  }

  // Sem deps: reposiciona a cada render do componente hospedeiro (a aba ativa mudou).
  useLayoutEffect(measure);

  useEffect(() => {
    const indicator = ref.current;
    const parent = indicator?.parentElement;
    if (!indicator || !parent) return;
    // Só habilita a transição depois da primeira medição, para o indicador não "voar" da origem ao montar.
    const frame = window.requestAnimationFrame(() => indicator.setAttribute("data-ready", "true"));
    const observer = new ResizeObserver(() => {
      indicator.removeAttribute("data-ready");
      measure();
      window.requestAnimationFrame(() => indicator.setAttribute("data-ready", "true"));
    });
    observer.observe(parent);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  return (
    <span
      aria-hidden="true"
      ref={ref}
      data-variant={variant}
      className={cn(
        "hp-sliding-indicator pointer-events-none absolute left-0 opacity-0",
        variant === "line" ? "bottom-0 h-0.5 w-px origin-left bg-primary" : "top-0 w-full rounded-md bg-accent",
        className,
      )}
    />
  );
}
