import { CalendarDays, CreditCard, Home, Sparkles, Users } from "lucide-react";
import type { SectionId } from "@/types/clinic";
import { cn } from "@/lib/utils";

const mobileItems: { id: SectionId; label: string; icon: typeof Home }[] = [
  { id: "dashboard", label: "Início", icon: Home },
  { id: "agenda", label: "Agenda", icon: CalendarDays },
  { id: "clientes", label: "Clientes", icon: Users },
  { id: "procedimentos", label: "Custos", icon: Sparkles },
  { id: "pagamentos", label: "Pagto.", icon: CreditCard },
];

export function MobileNav({
  active,
  onSelect,
}: {
  active: SectionId;
  onSelect: (section: SectionId) => void;
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-[#dfe4f2] bg-white px-2 pb-3 pt-2 shadow-[0_-12px_35px_rgba(14,23,55,0.1)] lg:hidden">
      {mobileItems.map((item) => {
        const Icon = item.icon;
        const isActive = active === item.id;

        return (
          <button
            key={item.id}
            className={cn(
              "flex flex-col items-center gap-1 rounded-[8px] px-1 py-2 text-[11px] font-bold transition",
              isActive ? "bg-[#eef3ff] text-[#1438ff]" : "text-[#7c86a2]",
            )}
            onClick={() => onSelect(item.id)}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
