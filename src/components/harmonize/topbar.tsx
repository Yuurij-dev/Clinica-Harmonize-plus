import { Bell, ChevronDown, Clock3, Loader2, LogOut, Menu, Moon, Search, Settings2, Sparkles, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { SectionId } from "@/types/clinic";
import { StockAlertItem, useStockAlerts } from "./stock-alerts";

type TopbarProps = {
  onMenu: () => void;
  onDashboard: () => void;
  onSettings: () => void;
  onNavigate: (section: SectionId) => void;
  onLogout: () => Promise<void>;
  user?: { id: string; name: string; role: string; clinic?: { trialEndsAt?: string | null } } | null;
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

function initialDarkMode() {
  if (typeof window === "undefined") return false;
  const savedTheme = window.localStorage.getItem("harmonize-theme");
  return savedTheme === "dark";
}

function formatTrialRemaining(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

export function Topbar({ onMenu, onDashboard, onSettings, onNavigate, onLogout, user }: TopbarProps) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [appointmentAlerts, setAppointmentAlerts] = useState<Array<{ id: string; message: string }>>([]);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [themeReady, setThemeReady] = useState(false);
  const [trialRemaining, setTrialRemaining] = useState<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const previousAlertIdsRef = useRef<string[] | null>(null);
  const stockAlerts = useStockAlerts(user?.role === "ADMIN");
  const notificationCount = appointmentAlerts.length + stockAlerts.length;

  function primeNotificationAudio() {
    if (!audioContextRef.current) audioContextRef.current = new AudioContext();
    if (audioContextRef.current.state === "suspended") void audioContextRef.current.resume();
  }

  function playNotificationSound() {
    const context = audioContextRef.current;
    if (!context) return;
    const play = () => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, context.currentTime);
      oscillator.frequency.setValueAtTime(1174, context.currentTime + 0.12);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.32);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.34);
    };
    if (context.state === "suspended") void context.resume().then(play);
    else play();
  }

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
  const trialEndsAt = user?.clinic?.trialEndsAt;
  const trialExpired = trialRemaining !== null && trialRemaining <= 0;
  const trialUrgent = trialRemaining !== null && trialRemaining > 0 && trialRemaining <= 24 * 60 * 60 * 1000;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setDarkMode(initialDarkMode());
      setThemeReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!themeReady) return;
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode, themeReady]);

  useEffect(() => {
    if (!trialEndsAt) {
      const clearRemaining = window.setTimeout(() => setTrialRemaining(null), 0);
      return () => window.clearTimeout(clearRemaining);
    }
    const endsAt = Date.parse(trialEndsAt);
    if (Number.isNaN(endsAt)) {
      const clearRemaining = window.setTimeout(() => setTrialRemaining(null), 0);
      return () => window.clearTimeout(clearRemaining);
    }
    const updateRemaining = () => setTrialRemaining(endsAt - Date.now());
    const initialUpdate = window.setTimeout(updateRemaining, 0);
    const timer = window.setInterval(updateRemaining, 1000);
    return () => {
      window.clearTimeout(initialUpdate);
      window.clearInterval(timer);
    };
  }, [trialEndsAt]);

  function toggleTheme() {
    const nextTheme = !darkMode;
    setDarkMode(nextTheme);
    window.localStorage.setItem("harmonize-theme", nextTheme ? "dark" : "light");
    document.documentElement.classList.toggle("dark", nextTheme);
    window.dispatchEvent(new Event("harmonize-theme-change"));
  }

  useEffect(() => {
    const primeOnInteraction = () => primeNotificationAudio();
    window.addEventListener("pointerdown", primeOnInteraction, { once: true });
    return () => window.removeEventListener("pointerdown", primeOnInteraction);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;

    async function loadAppointmentAlerts() {
      const response = await fetch("/api/agenda/alerts", { cache: "no-store" }).catch(() => null);
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
            && appointment.status !== "Faltou"
            && appointment.status !== "Cancelado";
        })
        .map((appointment) => ({ id: appointment.id, message: `É hora do atendimento de ${appointment.patient?.name ?? "um cliente"}.` }));
      const previousAlertIds = previousAlertIdsRef.current;
      if (previousAlertIds && alerts.some((alert) => !previousAlertIds.includes(alert.id))) playNotificationSound();
      previousAlertIdsRef.current = alerts.map((alert) => alert.id);
      setAppointmentAlerts(alerts);
    }

    void loadAppointmentAlerts();
    const timer = window.setInterval(() => { void loadAppointmentAlerts(); }, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [user?.id]);

  async function handleLogout() {
    setIsLoggingOut(true);
    await onLogout();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 px-4 py-3 text-foreground backdrop-blur-xl sm:px-7 lg:px-9">
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

        <label className="hidden h-9 min-w-[230px] items-center gap-2 rounded-full border border-border bg-muted px-4 text-xs text-muted-foreground transition-[border-color,box-shadow,background-color] duration-200 focus-within:border-ring focus-within:bg-background focus-within:shadow-[0_0_0_4px_color-mix(in_srgb,var(--ring)_12%,transparent)] xl:flex">
          <Search className="h-4 w-4" />
          <Input
            className="h-auto border-0 bg-transparent p-0 shadow-none focus-visible:border-0 focus-visible:ring-0"
            placeholder="Buscar no Harmonize+"
            onKeyDown={(event) => { if (event.key === "Enter") search(event.currentTarget.value); }}
            aria-label="Buscar no Harmonize+"
          />
        </label>

        {user?.role === "ADMIN" ? <Button className="hidden lg:inline-flex" size="sm" onClick={onDashboard}>
          <Sparkles className="h-3.5 w-3.5" />
          Resumo do dia
        </Button> : null}

        {trialRemaining !== null ? <div className={`hidden items-center gap-2 rounded-full border px-3 py-2 text-[10px] font-bold md:flex ${trialExpired || trialUrgent ? "border-[#f2d59c] bg-[#fff8e7] text-[#a56400]" : "border-[#bfe7ce] bg-[#eaf8ef] text-[#247750]"}`} role="status" aria-live="polite">
          <Clock3 className="h-3.5 w-3.5" />
          <span>{trialExpired ? "Teste grátis encerrado" : <>Teste grátis: <strong>{formatTrialRemaining(trialRemaining)}</strong></>}</span>
        </div> : null}

        <DropdownMenu open={notificationsOpen} onOpenChange={setNotificationsOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Notificações" onClick={primeNotificationAudio} className="relative">
              <Bell className="h-5 w-5" />
              {notificationCount ? <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#e0647d] px-1 text-[9px] font-black text-white ring-2 ring-background">{notificationCount}</span> : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[70vh] w-80 overflow-y-auto p-4">
            <p className="text-xs font-semibold">Notificações</p>
            {appointmentAlerts.length ? appointmentAlerts.map((alert) => <p className="mt-3 rounded-md bg-accent p-3 text-[11px] leading-5 text-accent-foreground" key={alert.id}>{alert.message}</p>) : <><p className="mt-3 rounded-md bg-muted p-3 text-[11px] leading-5 text-muted-foreground">Nenhum atendimento no horário neste momento.</p><p className="mt-2 rounded-md bg-muted p-3 text-[11px] leading-5 text-muted-foreground">As notificações dos próximos atendimentos aparecerão aqui.</p></>}
            {stockAlerts.length ? <>
              <p className="mt-4 text-xs font-semibold">Estoque</p>
              <div className="mt-2 space-y-2">{stockAlerts.map((alert) => <StockAlertItem alert={alert} key={`${alert.kind}-${alert.lotId ?? alert.productId}`} onOpen={() => { setNotificationsOpen(false); onNavigate("estoque"); }} />)}</div>
            </> : null}
          </DropdownMenuContent>
        </DropdownMenu>
        {user?.role === "ADMIN" ? <Button
          className="hidden sm:inline-flex"
          variant="secondary"
          size="icon"
          aria-label="Preferências"
          onClick={onSettings}
        >
          <Settings2 className="h-5 w-5" />
        </Button> : null}
        <Button variant="secondary" size="icon" aria-label={darkMode ? "Ativar tema claro" : "Ativar tema escuro"} title={darkMode ? "Tema claro" : "Tema escuro"} onClick={toggleTheme}>
          {darkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="hp-pressable hidden items-center gap-2 border-l border-border pl-4 sm:flex" disabled={isLoggingOut}>
              <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-[11px] font-black text-accent-foreground">{initials}</span>
              <span className="text-left leading-tight">
                <span className="block text-xs font-bold text-foreground">{userName}</span>
                <span className="block text-[9px] text-muted-foreground">{roleLabel}</span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={onSettings}>Meu perfil</DropdownMenuItem>
            <DropdownMenuItem>Ajuda e suporte</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive" disabled={isLoggingOut} onSelect={() => void handleLogout()}>
              {isLoggingOut ? <Loader2 className="animate-spin" /> : <LogOut />}
              {isLoggingOut ? "Saindo..." : "Sair"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
