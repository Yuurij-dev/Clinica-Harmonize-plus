"use client";

import { useEffect, useState } from "react";
import { Loader2, LogOut, Moon, Sun } from "lucide-react";
import { navItems } from "@/data/navigation";
import type { SectionId } from "@/types/clinic";
import { Sheet } from "@/components/ui/sheet";
import { THEME_CHANGE_EVENT, isDarkTheme, toggleThemeWithReveal } from "@/lib/theme-transition";
import { cn } from "@/lib/utils";
import { TrialStatus } from "./trial-status";

type MobileMoreSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  active: SectionId;
  sections: SectionId[];
  onSelect: (section: SectionId) => void;
  onLogout: () => Promise<void>;
  /** Chamado ao fechar a folha: devolve o foco ao botão "Mais". */
  onCloseAutoFocus?: (event: Event) => void;
  user: { name: string; role: string; clinic?: { name?: string; trialEndsAt?: string | null } };
};

const roleLabels: Record<string, string> = { ADMIN: "Administradora", PROFESSIONAL: "Profissional", STAFF: "Atendente" };
const rowClass = "hp-pressable flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function useIsDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const sync = () => setDark(isDarkTheme());
    sync();
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, sync);
  }, []);
  return dark;
}

/** Folha inferior do botão "Mais": demais seções, perfil, tema, aviso de teste grátis e Sair. */
export function MobileMoreSheet({ open, onOpenChange, active, sections, onSelect, onLogout, onCloseAutoFocus, user }: MobileMoreSheetProps) {
  const [leaving, setLeaving] = useState(false);
  const dark = useIsDark();
  const items = navItems.filter((item) => sections.includes(item.id));
  const initials = user.name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();

  async function logout() {
    setLeaving(true);
    try { await onLogout(); } finally { setLeaving(false); }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Mais opções" side="bottom" className="lg:hidden" onCloseAutoFocus={onCloseAutoFocus}>
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-3 pr-12">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-sm font-black text-accent-foreground">{initials}</span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-bold text-foreground">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{[roleLabels[user.role], user.clinic?.name].filter(Boolean).join(" · ")}</p>
          </div>
        </div>

        {items.length ? (
          <div className="grid grid-cols-3 gap-2">
            {items.map((item) => {
              const Icon = item.icon;
              const isActive = active === item.id;
              return (
                <button key={item.id} type="button" aria-current={isActive ? "page" : undefined} className={cn("hp-pressable flex min-h-20 min-w-0 flex-col items-center justify-center gap-1.5 rounded-lg border px-1 text-center leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", isActive ? "border-primary bg-accent text-accent-foreground" : "border-input text-foreground hover:bg-muted")} onClick={() => onSelect(item.id)}>
                  <Icon aria-hidden="true" className="h-5 w-5 text-primary" />
                  <span className="max-w-full break-words text-xs font-medium">{item.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        <TrialStatus trialEndsAt={user.clinic?.trialEndsAt} className="w-full justify-center" />

        <div className="space-y-1 border-t border-border pt-3">
          <button type="button" className={rowClass} onClick={toggleThemeWithReveal}>
            {dark ? <Sun aria-hidden="true" className="h-5 w-5 text-primary" /> : <Moon aria-hidden="true" className="h-5 w-5 text-primary" />}
            {dark ? "Tema claro" : "Tema escuro"}
          </button>
          <button type="button" className={cn(rowClass, "text-destructive hover:bg-destructive/10")} disabled={leaving} onClick={() => void logout()}>
            {leaving ? <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" /> : <LogOut aria-hidden="true" className="h-5 w-5" />}
            {leaving ? "Saindo..." : "Sair"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
