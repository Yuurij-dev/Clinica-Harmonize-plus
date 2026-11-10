import Image from "next/image";
import { ArrowDown, ArrowRight, ArrowUp, Bell, Building2, Check, ChevronDown, CornerDownLeft, HelpCircle, Loader2, LogOut, Moon, Search, Settings2, Sparkles, Sun, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { THEME_CHANGE_EVENT, isDarkTheme, resolveStoredDark, toggleThemeWithReveal } from "@/lib/theme-transition";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { SectionId } from "@/types/clinic";
import type { StockAlert } from "@/lib/stock-rules";
import { getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { patientListKey } from "@/lib/patient-list-rules";
import { collectFeatureSearchResults, collectSearchQuickActions, groupSearchResults, mergeSearchResults, navigateToSearchResult, normalizeSearchText, previewSearchResults, searchKeyboardAction, splitSearchHighlight, suggestFeatureSearchTerms, type GlobalSearchResult, type SearchAccess, type SearchQuickAction } from "@/lib/global-search-rules";
import { StockAlertGroups, useStockAlerts } from "./stock-alerts";
import { TrialStatus } from "./trial-status";
import { useCan } from "./current-user";
import type { UserClinic } from "./clinic-chooser";
import { Modal } from "@/components/ui/modal";
import { setupInviteEvent, tourReplayEvent } from "@/lib/section-events";
import { PatientAvatar } from "./patient-avatar";

type TopbarProps = {
  onDashboard: () => void;
  onSettings: () => void;
  onNavigate: (section: SectionId) => void;
  onQuickCreate: (section: SectionId, dialog: "appointment" | "client" | "procedure" | "quote" | "payment") => Promise<void>;
  onOpenSettingsSection: (section: string) => void;
  onOpenStockAlert: (alert: StockAlert) => void;
  onLogout: () => Promise<void>;
  user?: { id: string; name: string; role: string; clinicId?: string; clinic?: { name?: string; trialEndsAt?: string | null } } | null;
  clinics?: UserClinic[];
  onSwitchClinic?: (clinicId: string) => Promise<void>;
};

type GlobalSearchResponse = { results: GlobalSearchResult[]; partial?: boolean };

function collectCachedSearchResults(query: string, access: SearchAccess) {
  const normalizedQuery = normalizeSearchText(query);
  const matches: GlobalSearchResult[] = [];
  const add = (result: GlobalSearchResult, fields: Array<string | null | undefined>) => {
    if (fields.some((field) => field && normalizeSearchText(field).includes(normalizedQuery))) matches.push(result);
  };
  const dashboard = readClientCache<{
    patients?: Array<{ id: string; name: string; status?: string }>;
    appointments?: Array<{ id: string; date: string; time: string; procedure: string; status: string; patient?: { name?: string } | null }>;
    quotes?: Array<{ id: string; items: string; status: string; patient?: { name?: string } | null }>;
  }>("/api/dashboard/bootstrap");
  if (access.patients) {
    for (const patient of dashboard?.patients ?? []) add({ id: patient.id, title: patient.name, description: patient.status ?? "", section: "clientes", kind: "Paciente" }, [patient.name, patient.status]);
    const patientPage = readClientCache<{ patients?: Array<{ id: string; name: string; phone?: string; status?: string }> }>(patientListKey());
    for (const patient of patientPage?.patients ?? []) add({ id: patient.id, title: patient.name, description: [patient.phone, patient.status].filter(Boolean).join(" · "), section: "clientes", kind: "Paciente" }, [patient.name, patient.phone, patient.status]);
  }
  if (access.agenda) for (const item of dashboard?.appointments ?? []) add({ id: item.id, title: `${item.patient?.name ?? "Paciente"} · ${item.procedure}`, description: `${item.date} ${item.time} · ${item.status}`, section: "agenda", kind: "Agendamento" }, [item.patient?.name, item.procedure, item.status]);
  if (access.quotes) for (const item of dashboard?.quotes ?? []) add({ id: item.id, title: item.patient?.name ?? "Orçamento", description: `${item.items} · ${item.status}`, section: "orcamentos", kind: "Orçamento" }, [item.patient?.name, item.items, item.status]);
  if (access.quotes) {
    const data = readClientCache<{ quotes?: Array<{ id: string; items: string; status: string; patient?: string | { name?: string } | null }> }>("/api/quotes");
    for (const item of data?.quotes ?? []) {
      const patient = typeof item.patient === "string" ? item.patient : item.patient?.name;
      add({ id: item.id, title: patient ?? "Orçamento", description: `${item.items} · ${item.status}`, section: "orcamentos", kind: "Orçamento" }, [patient, item.items, item.status]);
    }
  }

  if (access.procedures) {
    const data = readClientCache<{ procedures?: Array<{ id: string; name: string; category?: string; materials?: string }> }>("/api/procedures");
    for (const item of data?.procedures ?? []) add({ id: item.id, title: item.name, description: item.category ?? "", section: "procedimentos", kind: "Procedimento" }, [item.name, item.category, item.materials]);
  }
  if (access.stock) {
    const data = readClientCache<{ products?: Array<{ id: string; name: string; category?: string; supplier?: string; unit?: string }> }>("/api/products");
    for (const item of data?.products ?? []) add({ id: item.id, title: item.name, description: [item.category, item.supplier, item.unit].filter(Boolean).join(" · "), section: "estoque", kind: "Estoque" }, [item.name, item.category, item.supplier, item.unit]);
  }
  if (access.purchases) {
    const data = readClientCache<{ purchases?: Array<{ id: string; supplier: string; invoiceNumber?: string | null; purchasedOn: string; items?: Array<{ name: string; lotCode: string }> }> }>("/api/purchases");
    for (const item of data?.purchases ?? []) add({ id: item.id, title: item.supplier, description: [item.invoiceNumber, item.purchasedOn].filter(Boolean).join(" · "), section: "compras", kind: "Compra" }, [item.supplier, item.invoiceNumber, item.purchasedOn, ...(item.items ?? []).flatMap((line) => [line.name, line.lotCode])]);
  }
  if (access.payments) {
    const data = readClientCache<{ payments?: Array<{ id: string; patient?: string | { name?: string } | null; method: string; status: string; date: string }> }>("/api/payments");
    for (const item of data?.payments ?? []) {
      const patient = typeof item.patient === "string" ? item.patient : item.patient?.name;
      add({ id: item.id, title: patient ?? "Pagamento", description: `${item.method} · ${item.status}`, section: "pagamentos", kind: "Pagamento" }, [patient, item.method, item.status, item.date]);
    }
  }
  return [...new Map(matches.map((result) => [`${result.kind}:${result.id}`, result])).values()].slice(0, 30);
}

function HighlightedSearchText({ value, query }: { value: string; query: string }) {
  return <>{splitSearchHighlight(value, query).map((part, index) => part.match ? <mark key={index} className="rounded-sm bg-primary/15 text-inherit">{part.text}</mark> : <span key={index}>{part.text}</span>)}</>;
}

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

export function Topbar({ onDashboard, onSettings, onNavigate, onQuickCreate, onOpenSettingsSection, onOpenStockAlert, onLogout, user, clinics = [], onSwitchClinic }: TopbarProps) {
  const canAccessDashboard = useCan("dashboard:access");
  const canAccessSettings = useCan("settings:access");
  const canAccessStock = useCan("stock:access");
  const canSearchPatients = useCan("patients:access");
  const canSearchAgenda = useCan("agenda:access");
  const canSearchProcedures = useCan("procedures:access");
  const canSearchPurchases = useCan("purchases:access");
  const canSearchQuotes = useCan("quotes:access");
  const canSearchPayments = useCan("payments:access");
  const canSearchFinance = useCan("finance:access");
  const canSearchReports = useCan("reports:access");
  const canSearchSettingsPermissions = useCan("settings:permissions");
  const canSearchSettingsTeam = useCan("settings:team");
  const canSearchClinical = useCan("clinical:read");
  const canSearchAnamnesis = useCan("anamnesis:read");
  const canSearchAppointmentRun = useCan("appointment:run");
  const searchAccess = useMemo<SearchAccess>(() => ({
    dashboard: canAccessDashboard,
    patients: canSearchPatients,
    agenda: canSearchAgenda,
    appointmentRun: canSearchAppointmentRun,
    procedures: canSearchProcedures,
    stock: canAccessStock,
    purchases: canSearchPurchases,
    quotes: canSearchQuotes,
    payments: canSearchPayments,
    finance: canSearchFinance,
    reports: canSearchReports,
    settings: canAccessSettings,
    settingsPermissions: canSearchSettingsPermissions,
    settingsTeam: canSearchSettingsTeam,
    clinical: canSearchClinical,
    anamnesis: canSearchAnamnesis,
  }), [canAccessDashboard, canAccessSettings, canAccessStock, canSearchAgenda, canSearchAnamnesis, canSearchAppointmentRun, canSearchClinical, canSearchFinance, canSearchPatients, canSearchPayments, canSearchProcedures, canSearchPurchases, canSearchQuotes, canSearchReports, canSearchSettingsPermissions, canSearchSettingsTeam]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  // Confirmação antes de iniciar o tour: o Harmo se apresenta e o usuário decide.
  const [tourAskOpen, setTourAskOpen] = useState(false);
  // Recusar o tour também deixa o assistente de configuração convidar o administrador que ainda não decidiu.
  const declineTour = () => { setTourAskOpen(false); window.dispatchEvent(new Event(setupInviteEvent)); };
  const [appointmentAlerts, setAppointmentAlerts] = useState<Array<{ id: string; message: string }>>([]);
  const [stockNotificationsEnabled, setStockNotificationsEnabled] = useState(true);
  const [appointmentNotificationSoundEnabled, setAppointmentNotificationSoundEnabled] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [remoteSearch, setRemoteSearch] = useState<{ query: string; scope: string; results: GlobalSearchResult[]; partial: boolean } | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchRetry, setSearchRetry] = useState(0);
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [expandedSearchGroups, setExpandedSearchGroups] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const pendingSearchKeyRef = useRef<string | null>(null);
  const previousAlertIdsRef = useRef<string[] | null>(null);
  const previousStockAlertIdsRef = useRef<string[] | null>(null);
  const notificationSoundEnabledRef = useRef(appointmentNotificationSoundEnabled);
  notificationSoundEnabledRef.current = appointmentNotificationSoundEnabled;

  function handleStockAlertsLoaded(alerts: StockAlert[], isInitialLoad: boolean) {
    const ids = alerts.map((alert) => `${alert.kind}:${alert.productId}:${alert.lotId ?? ""}`);
    const previousIds = previousStockAlertIdsRef.current;
    if (!isInitialLoad && notificationSoundEnabledRef.current && previousIds && ids.some((id) => !previousIds.includes(id))) playNotificationSound();
    previousStockAlertIdsRef.current = ids;
  }

  const stockAlerts = useStockAlerts(canAccessStock && stockNotificationsEnabled, handleStockAlertsLoaded);
  const notificationCount = appointmentAlerts.length + stockAlerts.length;
  const normalizedQuery = searchQuery.trim();
  const searchDataScope = `${user?.id ?? "anonymous"}:${JSON.stringify(searchAccess)}`;
  const immediateSearchResults = useMemo(() => normalizedQuery.length < 2 ? [] : mergeSearchResults(
    collectFeatureSearchResults(normalizedQuery, searchAccess), collectCachedSearchResults(normalizedQuery, searchAccess),
  ), [normalizedQuery, searchAccess]);
  const currentRemoteSearch = remoteSearch?.query === normalizedQuery && remoteSearch.scope === searchDataScope ? remoteSearch : null;
  const searchResults = useMemo(() => mergeSearchResults(immediateSearchResults, currentRemoteSearch?.results ?? []), [currentRemoteSearch, immediateSearchResults]);
  const searchPartial = currentRemoteSearch?.partial ?? false;
  const searchGroups = useMemo(() => groupSearchResults(searchResults), [searchResults]);
  const visibleSearchGroups = useMemo(() => searchGroups.map((group) => ({ ...group, ...previewSearchResults(group.results, expandedSearchGroups.includes(group.id)) })), [expandedSearchGroups, searchGroups]);
  const quickActions = useMemo(() => collectSearchQuickActions(searchQuery, searchAccess), [searchAccess, searchQuery]);
  const searchSuggestions = useMemo(() => suggestFeatureSearchTerms(searchQuery, searchAccess), [searchAccess, searchQuery]);
  const showSearchSuggestions = !searchLoading && !searchError && !searchResults.length && !quickActions.length;
  const selectableSearchItems = useMemo<Array<{ type: "action"; value: SearchQuickAction } | { type: "result"; value: GlobalSearchResult } | { type: "expand"; value: { id: string; label: string } } | { type: "suggestion"; value: string }>>(() => [
    ...quickActions.map((action) => ({ type: "action" as const, value: action })),
    ...visibleSearchGroups.flatMap((group) => [
      ...group.results.map((result) => ({ type: "result" as const, value: result })),
      ...(group.hiddenCount && !expandedSearchGroups.includes(group.id) ? [{ type: "expand" as const, value: { id: group.id, label: group.label } }] : []),
    ]),
    ...(showSearchSuggestions ? searchSuggestions.map((suggestion) => ({ type: "suggestion" as const, value: suggestion })) : []),
  ], [expandedSearchGroups, quickActions, searchSuggestions, showSearchSuggestions, visibleSearchGroups]);

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

  const userName = user?.name ?? "Usuário";
  const initials = userName.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
  const roleLabel = user?.role === "ADMIN" ? "Administradora" : user?.role === "PROFESSIONAL" ? "Profissional" : user?.role === "STAFF" ? "Atendente" : "";

  useEffect(() => {
    // Após o login (navegação SPA) o script do layout não rodou: aplica o tema salvo/preferido do sistema.
    const stored = resolveStoredDark();
    if (stored !== isDarkTheme()) {
      document.documentElement.classList.toggle("dark", stored);
      window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
    }
    const frame = window.requestAnimationFrame(() => setDarkMode(isDarkTheme()));
    // flushSync: o ícone precisa estar no novo estado antes do snapshot da view transition.
    const syncFromDocument = () => flushSync(() => setDarkMode(isDarkTheme()));
    window.addEventListener(THEME_CHANGE_EVENT, syncFromDocument);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener(THEME_CHANGE_EVENT, syncFromDocument);
    };
  }, []);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        setSearchFocused(true);
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) return;
    let active = true;
    let timeout: number;
    const requestTimer = window.setTimeout(() => {
      setSearchLoading(true);
      setSearchError(false);
      const key = `/api/search?q=${encodeURIComponent(query)}`;
      const cached = readClientCache<GlobalSearchResponse>(key);
      if (cached && active) setRemoteSearch({ query, scope: searchDataScope, results: cached.results, partial: Boolean(cached.partial) });
      pendingSearchKeyRef.current = key;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => {
          if (!active) return;
          invalidateClientCache(key);
          reject(new Error("A busca demorou mais do que o esperado."));
        }, 4_000);
      });
      void Promise.race([getCachedJson<GlobalSearchResponse>(key), timeoutPromise]).then((data) => {
        if (active) setRemoteSearch({ query, scope: searchDataScope, results: data.results, partial: Boolean(data.partial) });
      }).catch(() => {
        if (active) setSearchError(true);
      }).finally(() => {
        window.clearTimeout(timeout);
        if (pendingSearchKeyRef.current === key) pendingSearchKeyRef.current = null;
        if (active) setSearchLoading(false);
      });
    }, 35);
    return () => {
      active = false;
      window.clearTimeout(requestTimer);
      if (pendingSearchKeyRef.current) {
        invalidateClientCache(pendingSearchKeyRef.current);
        pendingSearchKeyRef.current = null;
      }
    };
  }, [searchAccess, searchDataScope, searchQuery, searchRetry]);

  useEffect(() => {
    const primeOnInteraction = () => primeNotificationAudio();
    window.addEventListener("pointerdown", primeOnInteraction, { once: true });
    return () => window.removeEventListener("pointerdown", primeOnInteraction);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;

    async function loadAppointmentAlerts() {
      if (document.visibilityState === "visible") {
        const automationResponse = await fetch("/api/appointments/auto-process", { method: "POST", cache: "no-store" }).catch(() => null);
        if (automationResponse?.ok) {
          const automation = await automationResponse.json().catch(() => null) as { updated?: Array<{ id: string; patientId: string; date: string }> } | null;
          if (active && automation?.updated?.length) {
            invalidateClientCache("/api/agenda", "/api/dashboard/bootstrap", "/api/patients", ...automation.updated.map(({ patientId }) => `/api/patients/${patientId}/history`));
            window.dispatchEvent(new Event("harmonize-auto-appointments-updated"));
          }
        }
      }
      const response = await fetch("/api/agenda/alerts", { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      const data = await response.json() as { appointments?: Array<{ id: string; date: string; time: string; status: string; patient?: { name?: string } }>; settings?: { appointmentNotificationsEnabled?: boolean; appointmentNotificationSoundEnabled?: boolean; stockNotificationsEnabled?: boolean } };
      if (!active) return;
      setStockNotificationsEnabled(data.settings?.stockNotificationsEnabled ?? true);
      setAppointmentNotificationSoundEnabled(data.settings?.appointmentNotificationSoundEnabled ?? true);

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
      const soundEnabled = data.settings?.appointmentNotificationSoundEnabled ?? appointmentNotificationSoundEnabled;
      if (soundEnabled && previousAlertIds && alerts.some((alert) => !previousAlertIds.includes(alert.id))) playNotificationSound();
      previousAlertIdsRef.current = alerts.map((alert) => alert.id);
      setAppointmentAlerts(alerts);
    }

    void loadAppointmentAlerts();
    const timer = window.setInterval(() => { void loadAppointmentAlerts(); }, 30_000);
    const handleSettingsChange = () => { void loadAppointmentAlerts(); };
    window.addEventListener("harmonize-notification-settings-updated", handleSettingsChange);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("harmonize-notification-settings-updated", handleSettingsChange); };
  }, [user?.id, appointmentNotificationSoundEnabled]);

  async function handleLogout() {
    setIsLoggingOut(true);
    await onLogout();
  }

  function openSearchResult(result: GlobalSearchResult) {
    setSearchFocused(false);
    updateSearchQuery("");
    navigateToSearchResult(result, onNavigate, onOpenSettingsSection);
  }

  function updateSearchQuery(query: string) {
    setSearchQuery(query);
    setSearchLoading(query.trim().length >= 2);
    setSearchError(false);
    setActiveSearchIndex(-1);
    setExpandedSearchGroups([]);
  }

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    const keyboardAction = searchKeyboardAction(event.key, activeSearchIndex, selectableSearchItems.length, searchError);
    if (keyboardAction?.type === "close") {
      event.preventDefault();
      if (searchFocused) {
        setSearchFocused(false);
        setActiveSearchIndex(-1);
      } else updateSearchQuery("");
      return;
    }
    if (keyboardAction?.type === "move") {
      event.preventDefault();
      setSearchFocused(true);
      setActiveSearchIndex(keyboardAction.index);
      return;
    }
    if (keyboardAction?.type === "retry") {
      event.preventDefault();
      setSearchRetry((attempt) => attempt + 1);
      return;
    }
    if (keyboardAction?.type === "select") {
      event.preventDefault();
      const selected = selectableSearchItems[keyboardAction.index];
      if (!selected) return;
      if (selected.type === "result") openSearchResult(selected.value);
      else if (selected.type === "action") {
        setSearchFocused(false);
        updateSearchQuery("");
        void onQuickCreate(selected.value.section, selected.value.dialog);
      } else if (selected.type === "expand") setExpandedSearchGroups((current) => [...current, selected.value.id]);
      else updateSearchQuery(selected.value);
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 px-4 py-3 text-foreground backdrop-blur-xl sm:px-7 lg:px-9">
      <div className="flex items-center gap-3">
        <div className="lg:hidden">
          <Image alt="Harmonize+" className="hp-logo-light h-auto w-[120px]" height={300} src="/brand/logo-horizontal.svg" unoptimized width={1200} />
          <Image alt="" aria-hidden="true" className="hp-logo-dark h-auto w-[120px]" height={300} src="/brand/logo-horizontal-white.svg" unoptimized width={1200} />
        </div>
        <div className="min-w-0 flex-1" />

        {user?.clinic?.name ? (clinics.length > 1 && onSwitchClinic ? <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="hp-pressable flex h-9 min-w-0 max-w-[150px] items-center gap-1.5 rounded-full border border-border bg-muted px-3 text-xs font-bold text-foreground sm:max-w-[220px]" aria-label="Trocar de clínica">
              <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{user.clinic.name}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {clinics.map((clinic) => (
              <DropdownMenuItem key={clinic.id} onSelect={() => { if (clinic.id !== user.clinicId) void onSwitchClinic(clinic.id); }}>
                <span className="min-w-0 flex-1 truncate">{clinic.name}</span>
                {clinic.id === user.clinicId ? <Check /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu> : <span className="flex h-9 min-w-0 max-w-[150px] items-center gap-1.5 px-1 text-xs font-bold text-foreground sm:max-w-[220px]"><Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{user.clinic.name}</span></span>) : null}

        <div className="relative hidden xl:block">
          <label className="flex h-9 min-w-[230px] items-center gap-2 rounded-full border border-border bg-muted px-4 text-xs text-muted-foreground transition-[border-color,box-shadow,background-color] duration-200 focus-within:border-ring focus-within:bg-background focus-within:shadow-[0_0_0_4px_color-mix(in_srgb,var(--ring)_12%,transparent)] xl:w-[min(28vw,330px)]">
            <Search className="h-4 w-4" />
            <Input
              ref={searchInputRef}
              className="h-auto text-sm border-0 bg-transparent p-0 shadow-none focus-visible:border-0 focus-visible:ring-0"
              placeholder="Buscar no Harmonize+"
              value={searchQuery}
              onChange={(event) => updateSearchQuery(event.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => { setSearchFocused(false); setActiveSearchIndex(-1); }}
              onKeyDown={handleSearchKeyDown}
              aria-label="Buscar no Harmonize+"
              aria-expanded={searchFocused && searchQuery.trim().length >= 2}
              aria-controls="global-search-options"
              aria-activedescendant={activeSearchIndex >= 0 ? `global-search-option-${activeSearchIndex}` : undefined}
              aria-describedby="global-search-shortcut"
              role="combobox"
              aria-autocomplete="list"
            />
            {searchQuery ? <button type="button" className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Limpar busca" onMouseDown={(event) => event.preventDefault()} onClick={() => { updateSearchQuery(""); searchInputRef.current?.focus(); }}><X className="h-3.5 w-3.5" /></button> : <kbd id="global-search-shortcut" className="hidden shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground 2xl:inline">Ctrl K</kbd>}
          </label>
          {searchFocused && searchQuery.trim().length >= 2 ? <div id="global-search-results" role="region" aria-label="Busca no Harmonize+" className="absolute right-0 top-full z-[1100] mt-2 max-h-[min(70vh,560px)] w-[min(480px,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-xl">
            <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-1">
              <p className="text-xs font-semibold text-foreground">Resultados da busca</p>
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground" role="status" aria-live="polite">{searchLoading ? <><Loader2 className="h-3 w-3 animate-spin" />{searchResults.length ? "Atualizando" : "Buscando"}</> : searchError ? "Busca indisponível" : `${searchResults.length} ${searchResults.length === 1 ? "resultado" : "resultados"}`}</span>
            </div>
            {searchLoading && !searchResults.length ? <p className="px-3 py-5 text-center text-sm text-muted-foreground" role="status">Buscando no conteúdo da clínica…</p> : null}
            {searchError ? <div className="px-3 py-5 text-center" role="alert"><p className="text-sm text-muted-foreground">Não foi possível carregar todo o conteúdo agora.</p><button type="button" tabIndex={-1} className="mt-2 text-xs font-semibold text-primary underline-offset-4 hover:underline" onMouseDown={(event) => event.preventDefault()} onClick={() => setSearchRetry((attempt) => attempt + 1)}>Tentar novamente</button><span className="sr-only">Pressione Enter para tentar novamente.</span></div> : null}
            <div id="global-search-options" role="listbox" aria-label="Opções da busca">
            {showSearchSuggestions ? <div role="group" aria-label="Nenhum resultado encontrado" className="px-3 py-5"><p className="text-center text-sm font-medium">Nenhum resultado para “{searchQuery.trim()}”</p><p className="mt-1 text-center text-xs text-muted-foreground">Confira a escrita ou escolha um termo parecido.</p>{searchSuggestions.length ? <div className="mt-3 flex flex-wrap justify-center gap-2" aria-label="Sugestões de busca">{searchSuggestions.map((suggestion) => {
              const optionIndex = selectableSearchItems.findIndex((item) => item.type === "suggestion" && item.value === suggestion);
              return <button key={suggestion} id={`global-search-option-${optionIndex}`} type="button" role="option" aria-selected={activeSearchIndex === optionIndex} tabIndex={-1} className={`rounded-full border border-border px-2.5 py-1 text-xs font-medium transition-colors ${activeSearchIndex === optionIndex ? "bg-accent" : "hover:bg-accent"}`} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveSearchIndex(optionIndex)} onClick={() => updateSearchQuery(suggestion)}>{suggestion}</button>;
            })}</div> : null}</div> : null}
            {quickActions.length ? <section role="group" aria-label="Ações rápidas" className="border-b border-border pb-2">
              <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Ações rápidas</p>
              {quickActions.map((action) => {
                const optionIndex = selectableSearchItems.findIndex((item) => item.type === "action" && item.value.id === action.id);
                return <button key={action.id} id={`global-search-option-${optionIndex}`} type="button" role="option" aria-selected={activeSearchIndex === optionIndex} tabIndex={-1} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${activeSearchIndex === optionIndex ? "bg-accent" : "hover:bg-accent"}`} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveSearchIndex(optionIndex)} onClick={() => { setSearchFocused(false); updateSearchQuery(""); void onQuickCreate(action.section, action.dialog); }}>
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><Sparkles className="h-3.5 w-3.5" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{action.title}</span><span className="block truncate text-xs text-muted-foreground">{action.description}</span></span>
                  <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>;
              })}
            </section> : null}
            {visibleSearchGroups.map((group) => <section key={group.id} role="group" aria-label={group.label} className="py-1">
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
              {group.results.map((result) => {
                const optionIndex = selectableSearchItems.findIndex((item) => item.type === "result" && item.value.id === result.id && item.value.kind === result.kind);
                return <button key={`${result.kind}:${result.id}`} id={`global-search-option-${optionIndex}`} type="button" role="option" aria-selected={activeSearchIndex === optionIndex} tabIndex={-1} className={`flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition-colors ${activeSearchIndex === optionIndex ? "bg-accent" : "hover:bg-accent"}`} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveSearchIndex(optionIndex)} onClick={() => openSearchResult(result)}>
                  <span className="flex w-full min-w-0 items-center gap-2 truncate text-sm font-medium">{result.kind === "Paciente" && result.section === "clientes" ? <PatientAvatar patientId={result.id} name={result.title} size="xs" /> : null}<span className="truncate"><HighlightedSearchText value={result.title} query={searchQuery.trim()} /></span></span>
                  <span className="w-full truncate text-xs text-muted-foreground">{result.kind}{result.description ? <> · <HighlightedSearchText value={result.description} query={searchQuery.trim()} /></> : ""}</span>
                  <span className="w-full truncate text-[10px] text-muted-foreground">Abrir em {result.settingsSection ? `Configurações › ${result.settingsSection}` : ({ dashboard: "Dashboard", agenda: "Agenda", clientes: "Clientes", procedimentos: "Procedimentos", estoque: "Estoque", compras: "Compras", orcamentos: "Orçamentos", pagamentos: "Pagamentos", financeiro: "Financeiro", relatorios: "Relatórios", configuracoes: "Configurações" } as Record<SectionId, string>)[result.section]}</span>
                </button>;
              })}
              {group.hiddenCount && !expandedSearchGroups.includes(group.id) ? (() => {
                const optionIndex = selectableSearchItems.findIndex((item) => item.type === "expand" && item.value.id === group.id);
                return <button id={`global-search-option-${optionIndex}`} type="button" role="option" aria-selected={activeSearchIndex === optionIndex} tabIndex={-1} className={`ml-3 mt-1 rounded px-2 py-1 text-xs font-medium text-primary ${activeSearchIndex === optionIndex ? "bg-accent" : "hover:bg-accent"}`} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveSearchIndex(optionIndex)} onClick={() => setExpandedSearchGroups((current) => [...current, group.id])}>Ver mais {group.hiddenCount} {group.hiddenCount === 1 ? "resultado" : "resultados"} em {group.label.toLocaleLowerCase("pt-BR")}</button>;
              })() : null}
            </section>)}
            </div>
            {searchPartial && searchResults.length ? <p className="px-3 py-2 text-xs text-muted-foreground" role="status">Alguns resultados podem estar indisponíveis no momento.</p> : null}
            <div className="sticky bottom-[-8px] -mx-2 mt-1 flex items-center gap-3 border-t border-border bg-popover px-3 py-2 text-[10px] text-muted-foreground"><span className="flex items-center gap-1"><ArrowUp className="h-3 w-3" /><ArrowDown className="h-3 w-3" /> navegar</span><span className="flex items-center gap-1"><CornerDownLeft className="h-3 w-3" /> abrir</span><span>Esc fechar</span></div>
          </div> : null}
        </div>

        {canAccessDashboard ? <Button className="hidden lg:inline-flex" size="sm" onClick={onDashboard}>
          <Sparkles className="h-3.5 w-3.5" />
          Resumo do dia
        </Button> : null}

        <TrialStatus className="max-md:hidden" trialEndsAt={user?.clinic?.trialEndsAt} />

        <DropdownMenu open={notificationsOpen} onOpenChange={setNotificationsOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Notificações" onClick={primeNotificationAudio} className="relative">
              <Bell className="h-5 w-5" />
              {notificationCount ? <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#c9415e] px-1 text-xs font-black text-white ring-2 ring-background">{notificationCount}</span> : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[70vh] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto p-4 max-lg:border-input">
            <p className="text-xs font-semibold">Notificações</p>
            {appointmentAlerts.length ? appointmentAlerts.map((alert) => <p className="mt-3 rounded-md bg-accent p-3 text-xs leading-5 text-accent-foreground" key={alert.id}>{alert.message}</p>) : <><p className="mt-3 rounded-md bg-muted p-3 text-xs leading-5 text-muted-foreground">Nenhum atendimento no horário neste momento.</p><p className="mt-2 rounded-md bg-muted p-3 text-xs leading-5 text-muted-foreground">As notificações dos próximos atendimentos aparecerão aqui.</p></>}
            {stockAlerts.length ? <>
              <p className="mt-4 text-xs font-semibold">Estoque</p>
              <div className="mt-2 space-y-3"><StockAlertGroups alerts={stockAlerts} onOpen={(alert) => { setNotificationsOpen(false); onOpenStockAlert(alert); }} /></div>
            </> : null}
          </DropdownMenuContent>
        </DropdownMenu>
        {canAccessSettings ? <Button
          className="hidden sm:inline-flex"
          variant="secondary"
          size="icon"
          aria-label="Preferências"
          onClick={onSettings}
        >
          <Settings2 className="h-5 w-5" />
        </Button> : null}
        <Button variant="secondary" size="icon" aria-label={darkMode ? "Ativar tema claro" : "Ativar tema escuro"} title={darkMode ? "Tema claro" : "Tema escuro"} onClick={toggleThemeWithReveal}>
          <span key={darkMode ? "sun" : "moon"} className="hp-theme-icon inline-flex">
            {darkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </span>
        </Button>
        <span className="group/tour relative inline-flex">
          <Button variant="secondary" size="icon" aria-label="Tour guiado" onClick={() => setTourAskOpen(true)}>
            <HelpCircle className="h-5 w-5" />
          </Button>
          <span role="tooltip" className="pointer-events-none invisible absolute right-0 top-full z-50 mt-2 rounded-md border border-border bg-card px-2 py-1 text-xs font-semibold text-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover/tour:visible group-hover/tour:opacity-100 group-focus-within/tour:visible group-focus-within/tour:opacity-100">Tour</span>
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="hp-pressable hidden items-center gap-2 border-l border-border pl-4 lg:flex" disabled={isLoggingOut}>
              <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-xs font-black text-accent-foreground">{initials}</span>
              <span className="text-left leading-tight">
                <span className="block text-xs font-bold text-foreground">{userName}</span>
                <span className="block text-xs text-muted-foreground">{roleLabel}</span>
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
      {/* Mesmo desenho do cartão do tour (guided-tour.tsx): mascote sobreposto, cartão arredondado e a mesma barra de ações. */}
      <Modal open={tourAskOpen} title="Deseja iniciar o tour?" hideHeader panelClassName="max-w-sm border-0 bg-transparent shadow-none" bodyClassName="p-0 sm:p-0" onClose={declineTour}>
        <div className="flex flex-col items-center">
          {/* O mascote sobreposto vem do próprio Modal. */}
          <div className="w-full rounded-2xl border border-border bg-card px-5 pb-4 pt-[52px] text-center text-card-foreground shadow-2xl">
            <h2 className="text-lg font-black tracking-tight text-foreground">Deseja iniciar o tour?</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Sou o Harmo e apresento o Harmonize+ em menos de 1 minuto, passando por cada área do sistema. Dá para pular a qualquer momento.</p>
            <div className="mt-4 flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" className="shrink-0 text-muted-foreground" onClick={declineTour}>Agora não</Button>
              <Button type="button" variant="primary" size="sm" className="ml-auto" onClick={() => { setTourAskOpen(false); window.dispatchEvent(new Event(tourReplayEvent)); }}>
                Iniciar tour
                <ArrowRight aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </header>
  );
}
