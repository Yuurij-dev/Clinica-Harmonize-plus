"use client";

import type { Ref } from "react";
import { Menu } from "lucide-react";
import { navItems } from "@/data/navigation";
import type { SectionId } from "@/types/clinic";
import { cn } from "@/lib/utils";

type MobileNavProps = {
  active: SectionId;
  sections: SectionId[];
  /** Verdadeiro quando a seção ativa está dentro de "Mais" (realça o botão). */
  moreActive: boolean;
  moreOpen: boolean;
  onSelect: (section: SectionId) => void;
  onOpenMore: () => void;
  /** Para devolver o foco ao botão quando a folha "Mais" fecha. */
  moreButtonRef?: Ref<HTMLButtonElement>;
};

const itemClass = "hp-pressable flex min-h-[var(--hp-nav-h)] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/** Barra inferior fixa do celular e tablet (abaixo de lg). Substitui o menu lateral, que fica só no desktop. */
export function MobileNav({ active, sections, moreActive, moreOpen, onSelect, onOpenMore, moreButtonRef }: MobileNavProps) {
  const items = navItems.filter((item) => sections.includes(item.id));
  return (
    <nav aria-label="Navegação principal" className="hp-mobile-nav fixed inset-x-0 bottom-0 z-30 flex border-t border-input bg-card pb-[env(safe-area-inset-bottom)] text-card-foreground lg:hidden">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = active === item.id;
        return (
          <button key={item.id} type="button" aria-current={isActive ? "page" : undefined} className={cn(itemClass, isActive ? "text-accent-foreground" : "text-muted-foreground")} onClick={() => onSelect(item.id)}>
            <Icon aria-hidden="true" className="h-5 w-5" />
            <span className="whitespace-nowrap text-xs font-medium">{item.label}</span>
          </button>
        );
      })}
      <button ref={moreButtonRef} type="button" aria-haspopup="dialog" aria-expanded={moreOpen} className={cn(itemClass, moreActive ? "text-accent-foreground" : "text-muted-foreground")} onClick={onOpenMore}>
        <Menu aria-hidden="true" className="h-5 w-5" />
        <span className="text-xs font-medium">Mais</span>
      </button>
    </nav>
  );
}
