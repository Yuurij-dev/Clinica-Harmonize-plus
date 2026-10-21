"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";
import { progressScale } from "@/lib/count-up-rules";
import { useRevealOnView } from "@/lib/use-reveal-on-view";

type ProgressProps = React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
  indicatorClassName?: string;
  /** Atraso (ms) do preenchimento inicial, para barras em cascata. Só vale na 1ª exibição. */
  revealDelay?: number;
};

/**
 * Preenche de 0 até o valor (scaleX, origem à esquerda) quando entra na viewport; mudanças de valor
 * seguem a transição do valor anterior. Só transform, nada de width.
 */
export const Progress = React.forwardRef<React.ElementRef<typeof ProgressPrimitive.Root>, ProgressProps>(({ className, indicatorClassName, value = 0, revealDelay = 0, ...props }, forwardedRef) => {
  const [viewRef, revealed] = useRevealOnView<HTMLDivElement>({ delayMs: revealDelay });
  const setRefs = React.useCallback((node: HTMLDivElement | null) => {
    viewRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [viewRef, forwardedRef]);

  return (
    <ProgressPrimitive.Root ref={setRefs} value={value} className={cn("relative h-2 w-full overflow-hidden rounded-full bg-secondary", className)} {...props}>
      <ProgressPrimitive.Indicator
        className={cn("h-full w-full flex-1 origin-left bg-primary", indicatorClassName)}
        style={{ transform: `scaleX(${revealed ? progressScale(value) : 0})`, transition: "transform 380ms cubic-bezier(0.22, 1, 0.36, 1)" }}
      />
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = ProgressPrimitive.Root.displayName;
