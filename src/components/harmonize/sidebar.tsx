import { Menu, Plus } from "lucide-react";
import { navItems } from "@/data/navigation";
import type { SectionId } from "@/types/clinic";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type SidebarProps = {
  active: SectionId;
  onSelect: (section: SectionId) => void;
  mobileOpen: boolean;
  onClose: () => void;
  onNewAppointment: () => void;
  clinicName?: string;
  isAdmin?: boolean;
};

export function Sidebar({
  active,
  onSelect,
  mobileOpen,
  onClose,
  onNewAppointment,
  clinicName,
  isAdmin = false,
}: SidebarProps) {
  const visibleNavItems = isAdmin ? navItems : navItems.filter((item) => ["agenda", "clientes", "orcamentos"].includes(item.id));
  const content = (
    <aside className="flex h-full w-[220px] flex-col border-r border-border bg-card px-4 py-5 text-card-foreground">
      <div className="mb-7 flex items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-[#5147dc] text-xs font-black text-white shadow-[0_7px_16px_rgba(81,71,220,0.24)]">
              H+
            </div>
            <div className="min-w-0">
              <p className="text-[15px] font-black leading-none text-foreground">Harmonize+</p>
              <p className="mt-1 text-[9px] font-medium text-muted-foreground">Gestão para clínicas</p>
            </div>
          </div>
        </div>
        <button
          className="grid h-9 w-9 place-items-center rounded-md bg-muted text-primary lg:hidden"
          onClick={onClose}
          aria-label="Fechar menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      <Button className="mb-6 w-full justify-start whitespace-nowrap px-3 text-[11px]" variant="primary" onClick={onNewAppointment}>
        <Plus className="h-4 w-4" />
        Novo agendamento
      </Button>

      <nav className="space-y-0.5">
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;

          return (
            <button
              key={item.id}
            className={cn(
                "hp-pressable flex h-10 w-full items-center justify-between rounded-md px-3 text-left text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              onClick={() => {
                onSelect(item.id);
                onClose();
              }}
            >
              <span className="flex items-center gap-3">
                <Icon className="h-4 w-4" />
                {item.label}
              </span>
              {isActive ? <span className="h-1.5 w-1.5 rounded-full bg-[#5147dc]" /> : null}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-border px-2 pt-4">
        <p className="text-[10px] font-semibold text-muted-foreground">{clinicName ?? "Clínica"}</p>
        <p className="mt-1 text-xs font-bold text-foreground">Plano profissional</p>
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:block">
        {content}
      </div>
      <Sheet open={mobileOpen} onOpenChange={(open) => { if (!open) onClose(); }} title="Navegação principal" side="left" className="p-0 lg:hidden" showCloseButton={false}>
        {content}
      </Sheet>
    </>
  );
}
