import { Bell, ChevronDown, LogOut, Menu, Search, Settings2, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { SectionId } from "@/types/clinic";

type TopbarProps = {
  title: string;
  onMenu: () => void;
  onDashboard: () => void;
  onSettings: () => void;
  onNavigate: (section: SectionId) => void;
  onLogout: () => void;
};

export function Topbar({ title, onMenu, onDashboard, onSettings, onNavigate, onLogout }: TopbarProps) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  function search(value: string) {
    const normalized = value.toLowerCase();
    if (normalized.includes("client") || normalized.includes("pacient")) onNavigate("clientes");
    else if (normalized.includes("proced")) onNavigate("procedimentos");
    else if (normalized.includes("orça") || normalized.includes("orca")) onNavigate("orcamentos");
    else if (normalized.includes("pag") || normalized.includes("finance")) onNavigate("pagamentos");
    else if (normalized.includes("relat")) onNavigate("relatorios");
    else onNavigate("agenda");
  }

  return (
    <header className="hp-topbar-enter sticky top-0 z-30 border-b border-[#eeeef3] bg-white/95 px-4 py-3 backdrop-blur-xl sm:px-7 lg:px-9">
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

        <label className="hidden h-9 min-w-[230px] items-center gap-2 rounded-full border border-[#e6e6ed] bg-[#fafafd] px-4 text-xs text-[#9293a4] transition-[border-color,box-shadow,background-color] duration-200 focus-within:border-[#5147dc] focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(81,71,220,0.08)] xl:flex">
          <Search className="h-4 w-4" />
          <input
            className="w-full bg-transparent outline-none placeholder:text-[#8b93aa]"
            placeholder="Buscar no Harmonize+"
            onKeyDown={(event) => { if (event.key === "Enter") search(event.currentTarget.value); }}
          />
        </label>

        <Button className="hidden bg-[#5147dc] lg:inline-flex" size="sm" onClick={onDashboard}>
          <Sparkles className="h-3.5 w-3.5" />
          Resumo do dia
        </Button>

        <div className="relative"><Button variant="secondary" size="icon" aria-label="Notificações" onClick={() => setNotificationsOpen((open) => !open)}>
          <Bell className="h-5 w-5" />
        </Button>{notificationsOpen ? <div className="absolute right-0 top-12 w-72 rounded-[7px] border border-[#e5e5ee] bg-white p-4 shadow-xl"><p className="text-xs font-bold text-[#303144]">Notificações</p><p className="mt-3 rounded-[6px] bg-[#f7f6ff] p-3 text-[11px] leading-5 text-[#65667a]">3 retornos precisam ser confirmados hoje.</p><p className="mt-2 rounded-[6px] bg-[#fff8e7] p-3 text-[11px] leading-5 text-[#65667a]">Há 2 pagamentos pendentes.</p></div> : null}</div>
        <Button
          className="hidden sm:inline-flex"
          variant="secondary"
          size="icon"
          aria-label="Preferências"
          onClick={onSettings}
        >
          <Settings2 className="h-5 w-5" />
        </Button>
        <button className="hp-pressable relative hidden items-center gap-2 border-l border-[#ececf2] pl-4 sm:flex" onClick={() => setProfileOpen((open) => !open)}>
          <div className="grid h-8 w-8 place-items-center rounded-full bg-[#eeeaff] text-[11px] font-black text-[#5b4fd2]">
            DA
          </div>
          <div className="leading-tight">
            <p className="text-xs font-bold text-[#2c2d41]">Dra. Ana</p>
            <p className="text-[9px] text-[#9495a5]">Administradora</p>
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-[#9293a4]" />
          {profileOpen ? <div className="absolute right-0 top-11 w-48 rounded-[7px] border border-[#e5e5ee] bg-white p-2 text-left shadow-xl"><span className="block rounded-[5px] px-3 py-2 text-xs font-semibold text-[#555668] hover:bg-[#f5f4ff]" onClick={onSettings}>Meu perfil</span><span className="block rounded-[5px] px-3 py-2 text-xs font-semibold text-[#555668] hover:bg-[#f5f4ff]">Ajuda e suporte</span><span className="mt-1 flex items-center gap-2 rounded-[5px] border-t border-[#eeeef3] px-3 py-2 pt-3 text-xs font-bold text-[#b42318] hover:bg-[#fff5f5]" onClick={onLogout}><LogOut className="h-3.5 w-3.5" />Sair</span></div> : null}
        </button>
      </div>
    </header>
  );
}
