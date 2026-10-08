"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function ListAccordion({ title, subtitle, meta, open, onToggle, children }: { title: string; subtitle?: string; meta?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <Card className={cn("overflow-hidden transition", open && "border-[#5147dc]/40")}>
      <button aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left" type="button" onClick={onToggle}>
        <span className="min-w-0">
          <strong className="text-sm font-bold text-[#27283b]">{title}</strong>
          {subtitle ? <span className="text-sm text-[#5f6072]"> / {subtitle}</span> : null}
        </span>
        <span className="flex shrink-0 items-center gap-3">
          {meta}
          <ChevronDown className={cn("h-4 w-4 text-[#77788a] transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open ? <div className="border-t border-[#ececf2] p-4">{children}</div> : null}
    </Card>
  );
}
