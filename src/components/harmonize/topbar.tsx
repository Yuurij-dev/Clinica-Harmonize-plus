import { Bell, ChevronDown, Menu, Search, Settings2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

type TopbarProps = {
  title: string;
  onMenu: () => void;
};

export function Topbar({ title, onMenu }: TopbarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-[#eeeef3] bg-white/95 px-4 py-3 backdrop-blur-xl sm:px-7 lg:px-9">
      <div className="flex items-center gap-3">
        <Button
          className="lg:hidden"
          variant="secondary"
          size="icon"
          onClick={onMenu}
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-[#202136] sm:text-2xl">
            {title}
          </h1>
        </div>

        <label className="hidden h-9 min-w-[230px] items-center gap-2 rounded-full border border-[#e6e6ed] bg-[#fafafd] px-4 text-xs text-[#9293a4] xl:flex">
          <Search className="h-4 w-4" />
          <input
            className="w-full bg-transparent outline-none placeholder:text-[#8b93aa]"
            placeholder="Buscar no Harmonize+"
          />
        </label>

        <Button className="hidden bg-[#5147dc] lg:inline-flex" size="sm">
          <Sparkles className="h-3.5 w-3.5" />
          Resumo do dia
        </Button>

        <Button variant="secondary" size="icon" aria-label="Notificações">
          <Bell className="h-5 w-5" />
        </Button>
        <Button
          className="hidden sm:inline-flex"
          variant="secondary"
          size="icon"
          aria-label="Preferências"
        >
          <Settings2 className="h-5 w-5" />
        </Button>
        <div className="hidden items-center gap-2 border-l border-[#ececf2] pl-4 sm:flex">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-[#eeeaff] text-[11px] font-black text-[#5b4fd2]">
            DA
          </div>
          <div className="leading-tight">
            <p className="text-xs font-bold text-[#2c2d41]">Dra. Ana</p>
            <p className="text-[9px] text-[#9495a5]">Administradora</p>
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-[#9293a4]" />
        </div>
      </div>
    </header>
  );
}
