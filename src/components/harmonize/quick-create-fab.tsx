"use client";

import { useRef } from "react";
import { CalendarPlus, CreditCard, FileText, Plus, UserPlus, type LucideIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { SectionId } from "@/types/clinic";
import { quickCreateFor, type QuickCreate } from "@/lib/mobile-nav-rules";

const icons: Record<QuickCreate, LucideIcon> = { appointment: CalendarPlus, client: UserPlus, quote: FileText, payment: CreditCard };

/**
 * Botão "+" do celular (abaixo de lg), acima da barra inferior. Só lista criações que o papel pode abrir.
 * Some sozinho (CSS `.hp-fab`) com modal/folha aberta, campo de texto focado ou tela marcada com data-hide-fab.
 */
export function QuickCreateFab({ sections, onCreate }: { sections: SectionId[]; onCreate: (target: QuickCreate) => void }) {
  const targets = quickCreateFor(sections);
  const triggerRef = useRef<HTMLButtonElement>(null);
  if (!targets.length) return null;
  return (
    <div className="hp-fab fixed right-4 z-30 bottom-[calc(var(--hp-nav-h)+env(safe-area-inset-bottom)+1rem)] lg:hidden">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button ref={triggerRef} type="button" aria-label="Criar" className="hp-pressable grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_8px_24px_rgba(31,32,50,0.28)] transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
            <Plus aria-hidden="true" className="h-6 w-6" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-56 border-input p-1.5">
          {targets.map((target) => {
            const Icon = icons[target.id];
            return (
              <DropdownMenuItem key={target.id} className="min-h-11 gap-3 text-sm font-semibold" onSelect={() => { triggerRef.current?.focus(); onCreate(target.id); }}>
                <Icon aria-hidden="true" className="h-4 w-4 text-primary" />
                {target.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
