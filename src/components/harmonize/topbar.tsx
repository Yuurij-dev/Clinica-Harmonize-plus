import { Bell, ChevronDown, Loader2, LogOut, Menu, Search, Settings2, Sparkles } from "lucide-react";
import { useState } from "react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import type { SectionId } from "@/types/clinic";

type TopbarProps = {
  onMenu: () => void;
  onDashboard: () => void;
  onSettings: () => void;
  onNavigate: (section: SectionId) => void;
  onLogout: () => Promise<void>;
  user?: { name: string; role: string } | null;
};

function clinicNow() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second));
}

function clinicDateKey(date: Date | string) {
  if (typeof date === "string") return date.slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function appointmentMinutesFromTime(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

export function Topbar({ onMenu, onDashboard, onSettings, onNavigate, onLogout, user }: TopbarProps) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [appointmentAlerts, setAppointmentAlerts] = useState<string[]>([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  function search(value: string) {
    const normalized = value.toLowerCase();
    if (normalized.includes("client") || normalized.includes("pacient")) onNavigate("clientes");
    else if (normalized.includes("proced")) onNavigate("procedimentos");
    else if (normalized.includes("orça") || normalized.includes("orca")) onNavigate("orcamentos");
    else if (normalized.includes("pag") || normalized.includes("finance")) onNavigate("pagamentos");
    else if (normalized.includes("relat")) onNavigate("relatorios");
    else onNavigate("agenda");
  }

  const userName = user?.name ?? "Usuário";
  const initials = userName.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
  const roleLabel = user?.role === "ADMIN" ? "Administradora" : user?.role === "PROFESSIONAL" ? "Profissional" : "Equipe";

  useEffect(() => {
    let active = true;

    async function loadAppointmentAlerts() {
      const response = await fetch("/api/agenda/bootstrap", { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      const data = await response.json() as { appointments?: Array<{ id: string; date: string; time: string; status: string; patient?: { name?: string } }> };
      if (!active) return;

      const now = clinicNow();
      const today = clinicDateKey(now);
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const alerts = (data.appointments ?? [])
        .filter((appointment) => {
          const appointmentMinutes = appointmentMinutesFromTime(appointment.time);
          return clinicDateKey(appointment.date) === today
            && currentMinutes >= appointmentMinutes
            && currentMinutes < appointmentMinutes + 60
            && appointment.status !== "Atendido"
            && appointment.status !== "Faltou";
        })
        .map((appointment) => `É hora do atendimento de ${appointment.patient?.name ?? "um cliente"}.`);
      setAppointmentAlerts(alerts);
    }

    void loadAppointmentAlerts();
    const timer = window.setInterval(() => { void loadAppointmentAlerts(); }, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  async function handleLogout() {
    setIsLoggingOut(true);
    await onLogout();
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
        <div className="min-w-0 flex-1" />

        <label className="hidden h-9 min-w-[230px] items-center gap-2 rounded-full border border-[#e6e6ed] bg-[#fafafd] px-4 text-xs text-[#9293a4] transition-[border-color,box-shadow,background-color] duration-200 focus-within:border-[#5147dc] focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(81,71,220,0.08)] xl:flex">
          <Search className="h-4 w-4" />
          <input
            className="w-full bg-transparent outline-none placeholder:text-[#8b93aa]"
            placeholder="Buscar no Harmonize+"
            onKeyDown={(event) => { if (event.key === "Enter") search(event.currentTarget.value); }}
          />
        </label>

        {user?.role === "ADMIN" ? <Button className="hidden bg-[#5147dc] lg:inline-flex" size="sm" onClick={onDashboard}>
          <Sparkles className="h-3.5 w-3.5" />
          Resumo do dia
        </Button> : null}

        <div className="relative"><Button variant="secondary" size="icon" aria-label="Notificações" onClick={() => setNotificationsOpen((open) => !open)}>
          <Bell className="h-5 w-5" />
          {appointmentAlerts.length ? <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#e0647d] px-1 text-[9px] font-black text-white ring-2 ring-white">{appointmentAlerts.length}</span> : null}
        </Button>{notificationsOpen ? <div className="absolute right-0 top-12 z-40 w-80 rounded-[7px] border border-[#e5e5ee] bg-white p-4 shadow-xl"><p className="text-xs font-bold text-[#303144]">Notificações</p>{appointmentAlerts.length ? appointmentAlerts.map((alert, index) => <p className="mt-3 rounded-[6px] bg-[#f7f6ff] p-3 text-[11px] leading-5 text-[#5147dc]" key={`${alert}-${index}`}>{alert}</p>) : <><p className="mt-3 rounded-[6px] bg-[#f7f6ff] p-3 text-[11px] leading-5 text-[#65667a]">Nenhum atendimento no horário neste momento.</p><p className="mt-2 rounded-[6px] bg-[#fff8e7] p-3 text-[11px] leading-5 text-[#65667a]">As notificações dos próximos atendimentos aparecerão aqui.</p></>}</div> : null}</div>
        {user?.role === "ADMIN" ? <Button
          className="hidden sm:inline-flex"
          variant="secondary"
          size="icon"
          aria-label="Preferências"
          onClick={onSettings}
        >
          <Settings2 className="h-5 w-5" />
        </Button> : null}
        <button className="hp-pressable relative hidden items-center gap-2 border-l border-[#ececf2] pl-4 sm:flex" disabled={isLoggingOut} onClick={() => setProfileOpen((open) => !open)}>
          <div className="grid h-8 w-8 place-items-center rounded-full bg-[#eeeaff] text-[11px] font-black text-[#5b4fd2]">
            {initials}
          </div>
          <div className="leading-tight">
            <p className="text-xs font-bold text-[#2c2d41]">{userName}</p>
            <p className="text-[9px] text-[#9495a5]">{roleLabel}</p>
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-[#9293a4]" />
          {profileOpen ? <div className="absolute right-0 top-11 w-48 rounded-[7px] border border-[#e5e5ee] bg-white p-2 text-left shadow-xl"><span className="block rounded-[5px] px-3 py-2 text-xs font-semibold text-[#555668] hover:bg-[#f5f4ff]" onClick={onSettings}>Meu perfil</span><span className="block rounded-[5px] px-3 py-2 text-xs font-semibold text-[#555668] hover:bg-[#f5f4ff]">Ajuda e suporte</span><span className="mt-1 flex items-center gap-2 rounded-[5px] border-t border-[#eeeef3] px-3 py-2 pt-3 text-xs font-bold text-[#b42318] hover:bg-[#fff5f5]" onClick={handleLogout}>{isLoggingOut ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}{isLoggingOut ? "Saindo..." : "Sair"}</span></div> : null}
        </button>
      </div>
    </header>
  );
}
