import { Menu, Plus } from "lucide-react";
import { navItems } from "@/data/navigation";
import type { SectionId } from "@/types/clinic";
import { Button } from "@/components/ui/button";
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
    <aside className="flex h-full w-[220px] flex-col border-r border-[#eeeef3] bg-white px-4 py-5 text-[#28293d]">
      <div className="mb-7 flex items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-[#5147dc] text-xs font-black text-white shadow-[0_7px_16px_rgba(81,71,220,0.24)]">
              H+
            </div>
            <div className="min-w-0">
              <p className="text-[15px] font-black leading-none text-[#25263a]">Harmonize+</p>
              <p className="mt-1 text-[9px] font-medium text-[#9a9bad]">Gestão para clínicas</p>
            </div>
          </div>
        </div>
        <button
          className="grid h-9 w-9 place-items-center rounded-[7px] bg-[#f4f4f8] text-[#5147dc] lg:hidden"
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
                "hp-pressable flex h-10 w-full items-center justify-between rounded-[6px] px-3 text-left text-[12px] font-semibold",
                isActive
                  ? "bg-[#f0efff] text-[#5147dc]"
                  : "text-[#747587] hover:bg-[#f7f7fa] hover:text-[#2c2d41]",
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

      <div className="mt-auto border-t border-[#eeeef3] px-2 pt-4">
        <p className="text-[10px] font-semibold text-[#a0a1b1]">{clinicName ?? "Clínica"}</p>
        <p className="mt-1 text-xs font-bold text-[#424357]">Plano profissional</p>
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:block">
        {content}
      </div>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-[#202136]/30 backdrop-blur-sm transition-opacity duration-300 lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
      />
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 transition-transform duration-300 ease-out lg:hidden",
          mobileOpen ? "translate-x-0" : "pointer-events-none -translate-x-full",
        )}
      >
        {content}
      </div>
    </>
  );
}
