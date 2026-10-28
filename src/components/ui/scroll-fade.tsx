"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const fade = (left: boolean, right: boolean) => {
  if (!left && !right) return undefined;
  const image = `linear-gradient(to right, ${left ? "transparent, #000 28px" : "#000, #000 28px"}, ${right ? "#000 calc(100% - 28px), transparent" : "#000 calc(100% - 28px), #000"})`;
  return { maskImage: image, WebkitMaskImage: image };
};

/** Linha rolável na horizontal que esmaece a borda onde ainda há conteúdo a rolar (abas e etapas no celular). */
export function ScrollFade({ className, style, children, onScroll, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [edges, setEdges] = React.useState({ left: false, right: false });

  const update = React.useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const left = element.scrollLeft > 4;
    const right = element.scrollLeft + element.clientWidth < element.scrollWidth - 4;
    setEdges((current) => (current.left === left && current.right === right ? current : { left, right }));
  }, []);

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [update]);

  return (
    <div
      ref={ref}
      className={cn("relative overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}
      style={{ ...fade(edges.left, edges.right), ...style }}
      onScroll={(event) => { update(); onScroll?.(event); }}
      {...props}
    >
      {children}
    </div>
  );
}
