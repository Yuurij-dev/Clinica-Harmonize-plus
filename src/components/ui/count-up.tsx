"use client";

import { useCountUp } from "@/lib/use-count-up";
import { useRevealOnView } from "@/lib/use-reveal-on-view";

type CountUpProps = {
  value: number | null | undefined;
  /** Formatador atual da tela (ex.: `currency.format`); recebe o valor interpolado. */
  format?: (value: number) => string;
  duration?: number;
  from?: number;
  className?: string;
};

/**
 * Número que conta ao aparecer (viewport, uma vez) e, depois, do valor anterior até o novo.
 * Leitores de tela recebem só o valor final enquanto os frames ficam em aria-hidden.
 */
export function CountUp({ value, format, duration, from, className }: CountUpProps) {
  const [ref, revealed] = useRevealOnView<HTMLSpanElement>();
  const { text, finalText, animating } = useCountUp(value, { format, duration, from, enabled: revealed });

  if (!animating) return <span ref={ref} className={className}>{text}</span>;
  return (
    <span ref={ref} className={className}>
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{finalText}</span>
    </span>
  );
}
