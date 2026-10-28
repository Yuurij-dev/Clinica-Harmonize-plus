"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { AppToaster } from "./app-toaster";
import { Dashboard } from "./dashboard";
import { AnimatedPage } from "./animated-page";
import { Sidebar } from "./sidebar";
import { StockSection } from "./stock-section";
import { PurchasesSection, type PurchasesTab } from "./purchases-section";
import { FinanceSection } from "./finance-section";
import { stockAlertSection } from "./stock-alerts";
import { Topbar } from "./topbar";
import {
  ClientsSection,
  PaymentsSection,
  ProceduresSection,
  QuotesSection,
  ReportsSection,
  ScheduleSection,
  SettingsSection,
} from "./sections";
import type { SectionId } from "@/types/clinic";
import type { RolePermissionMatrix } from "@/lib/permissions";
import type { StockAlert } from "@/lib/stock-rules";
import { CLIENT_CACHE_UNAUTHORIZED_EVENT, getCachedJson, setClientCacheScope } from "@/lib/client-cache";
import { visibleSections } from "@/lib/permissions";
import { CurrentRoleProvider } from "./current-user";
import { ClinicEntryTransition } from "./clinic-entry-transition";
import { clientsHomeEvent } from "@/lib/section-events";
import { agendaPeriodKey, agendaPeriodRange } from "@/lib/agenda-period-rules";
import { clinicToday } from "@/lib/clinic-time";
import { patientListKey } from "@/lib/patient-list-rules";
import { guardDraftNavigation } from "./use-draft-autosave";

type CurrentUser = { id: string; clinicId: string; name: string; role: string; isOwner?: boolean; trialExpired?: boolean; rolePermissions?: RolePermissionMatrix; clinic?: { name: string; trialEndsAt?: string | null } };
type AgendaFocus = { date: string; time: string };
type CreateDialog = "appointment" | "client" | "procedure" | "quote" | "payment";
type HarmonizeAppProps = { initialCreate?: CreateDialog };
type UndoNotice = { id: number; message: string; undo: () => void; leaving: boolean } | null;
type StartupState =
  | { status: "checking-session"; sessionConfirmed: false; clinicName?: string; message: string }
  | { status: "loading-data"; sessionConfirmed: true; clinicName?: string; message: string }
  | { status: "error"; sessionConfirmed: boolean; clinicName?: string; message: string }
  | { status: "ready"; sessionConfirmed: true; clinicName?: string; message?: string };

const initialScreenResources: Partial<Record<SectionId, { key: string; extraKeys?: () => string[]; message: string }>> = {
  dashboard: { key: "/api/dashboard/bootstrap", message: "Carregando os indicadores da clínica..." },
  // A agenda abre na semana de hoje; clientes, na primeira página da lista (as mesmas chaves que as telas leem do cache).
  agenda: { key: "/api/agenda/bootstrap", extraKeys: () => [agendaPeriodKey(agendaPeriodRange(clinicToday(), "Semana"))], message: "Carregando os dados da agenda..." },
  clientes: { key: patientListKey(), message: "Carregando a lista de pacientes..." },
  procedimentos: { key: "/api/procedures", message: "Carregando os procedimentos..." },
  estoque: { key: "/api/products", message: "Carregando o estoque..." },
  compras: { key: "/api/purchases", message: "Carregando as compras..." },
  orcamentos: { key: "/api/quotes", message: "Carregando os orçamentos..." },
  pagamentos: { key: "/api/payments", message: "Carregando os pagamentos..." },
  financeiro: { key: "/api/finance/summary?period=month", message: "Carregando o resumo financeiro..." },
  relatorios: { key: "/api/dashboard/bootstrap", message: "Carregando os dados dos relatórios..." },
};

// Sessão inválida no cliente mas aceita pelo servidor (ex.: banco instável) faz /login e / se redirecionarem sem parar.
// Na terceira volta em 30 s o cookie é descartado, o que encerra o ciclo.
async function leaveToLogin(replace: (path: string) => void) {
  try {
    const now = Date.now();
    const recent = (JSON.parse(window.sessionStorage.getItem("harmonize-login-redirects") ?? "[]") as number[]).filter((time) => now - time < 30_000);
    recent.push(now);
    window.sessionStorage.setItem("harmonize-login-redirects", JSON.stringify(recent));
    if (recent.length >= 3) await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
  } catch { /* sessionStorage indisponível: segue só com o redirecionamento */ }
  replace("/login");
}

type SessionCheck = { status: number; user?: CurrentUser };
let sessionCheck: Promise<SessionCheck> | null = null;

function getSessionCheck() {
  if (!sessionCheck) {
    sessionCheck = fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => ({ status: response.status, ...(response.ok ? await response.json() as { user?: CurrentUser } : {}) }))
      .finally(() => { sessionCheck = null; });
  }
  return sessionCheck;
}

const sectionPaths: Record<SectionId, string> = {
  dashboard: "/dashboard",
  agenda: "/",
  clientes: "/clientes",
  procedimentos: "/procedimentos",
  estoque: "/estoque",
  compras: "/compras",
  orcamentos: "/orcamentos",
  pagamentos: "/pagamentos",
  financeiro: "/financeiro",
  relatorios: "/relatorios",
  configuracoes: "/configuracoes",
};

function sectionFromPath(pathname: string | null): SectionId {
  const path = pathname?.split("/")[1] ?? "";
  const entry = Object.entries(sectionPaths).find(([, value]) => value.slice(1) === path);
  return entry?.[0] as SectionId ?? "agenda";
}

export function HarmonizeApp({ initialCreate }: HarmonizeAppProps = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const active = sectionFromPath(pathname);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [createDialog, setCreateDialog] = useState<CreateDialog | null>(initialCreate ?? null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [startup, setStartup] = useState<StartupState>({ status: "checking-session", sessionConfirmed: false, message: "Validando seu acesso..." });
  const [startupAttempt, setStartupAttempt] = useState(0);
  const [agendaFocus, setAgendaFocus] = useState<AgendaFocus | null>(null);
  const [purchasesTab, setPurchasesTab] = useState<PurchasesTab>("purchases");
  const [undoNotice, setUndoNotice] = useState<UndoNotice>(null);
  const undoNoticeId = useRef(0);
  const trialExpired = currentUser?.trialExpired === true;
  const allowedSections = visibleSections(currentUser?.role, currentUser?.rolePermissions, currentUser?.isOwner);
  const initialSection = useRef(active).current;

  const activeUndoNoticeId = undoNotice?.id;
  useEffect(() => {
    if (activeUndoNoticeId === undefined) return;
    const leaveTimer = window.setTimeout(() => setUndoNotice((current) => current?.id === activeUndoNoticeId ? { ...current, leaving: true } : current), 6260);
    const dismissTimer = window.setTimeout(() => setUndoNotice((current) => current?.id === activeUndoNoticeId ? null : current), 6500);
    return () => { window.clearTimeout(leaveTimer); window.clearTimeout(dismissTimer); };
  }, [activeUndoNoticeId]);

  async function selectSection(section: SectionId, focus?: AgendaFocus, tab: PurchasesTab = "purchases") {
    if (!allowedSections.includes(section)) {
      return;
    }
    if (!await guardDraftNavigation()) return;
    setAgendaFocus(section === "agenda" ? focus ?? null : null);
    if (section === "compras") setPurchasesTab(tab);
    setMobileOpen(false);
    setCreateDialog(null);
    // Já em Clientes: a tela está montada e guarda o paciente aberto; avisa para voltar à lista (a URL sozinha não limpa o estado).
    if (section === "clientes" && active === "clientes") window.dispatchEvent(new Event(clientsHomeEvent));
    router.push(sectionPaths[section]);
  }

  // Saídas e conferências pendentes abrem Compras já na aba Pendências; avisos de lote e saldo abrem o Estoque.
  function openStockAlert(alert: StockAlert) {
    selectSection(stockAlertSection(alert), undefined, "pending");
  }

  useEffect(() => {
    let active = true;
    async function initializeApp() {
      let sessionConfirmed = false;
      let clinicName: string | undefined;
      setStartup({ status: "checking-session", sessionConfirmed: false, message: "Validando seu acesso..." });
      try {
        const session = await getSessionCheck();
        if (!active) return;
        if (session.status === 401) {
          setClientCacheScope(null);
          void leaveToLogin(router.replace);
          return;
        }
        if (session.status < 200 || session.status >= 300 || !session.user) {
          throw new Error("Não foi possível validar sua sessão. Tente novamente.");
        }

        const user = session.user;
        sessionConfirmed = true;
        clinicName = user.clinic?.name;
        setClientCacheScope(`${user.id}:${user.clinicId}:${JSON.stringify(user.rolePermissions ?? {})}`);
        setCurrentUser(user);

        const resource = visibleSections(user.role, user.rolePermissions, user.isOwner).includes(initialSection) ? initialScreenResources[initialSection] : undefined;
        setStartup({
          status: "loading-data",
          sessionConfirmed: true,
          clinicName,
          message: resource?.message ?? "Preparando seu ambiente de trabalho...",
        });
        if (resource) await Promise.all([resource.key, ...(resource.extraKeys?.() ?? [])].map((key) => getCachedJson<unknown>(key)));
        if (active) setStartup({ status: "ready", sessionConfirmed: true, clinicName });
      } catch {
        if (!active) return;
        setStartup({
          status: "error",
          sessionConfirmed,
          clinicName,
          message: sessionConfirmed
            ? "Não foi possível carregar os dados necessários para abrir esta tela. Confira sua conexão e tente novamente."
            : "Não foi possível validar sua sessão. Confira sua conexão e tente novamente.",
        });
      }
    }

    void initializeApp();
    return () => { active = false; };
  }, [initialSection, router, startupAttempt]);

  useEffect(() => {
    const handleUnauthorized = () => {
      setCurrentUser(null);
      void leaveToLogin(router.replace);
    };
    const handleSessionChange = (event: StorageEvent) => {
      if (event.key !== "harmonize-session-change") return;
      setClientCacheScope(null);
      setCurrentUser(null);
      window.location.reload();
    };
    window.addEventListener(CLIENT_CACHE_UNAUTHORIZED_EVENT, handleUnauthorized);
    window.addEventListener("storage", handleSessionChange);
    return () => {
      window.removeEventListener(CLIENT_CACHE_UNAUTHORIZED_EVENT, handleUnauthorized);
      window.removeEventListener("storage", handleSessionChange);
    };
  }, [router]);

  async function openCreate(section: SectionId, dialog: NonNullable<typeof createDialog>) {
    if (trialExpired) {
      showNotice("O teste grátis terminou. Ative um plano para continuar alterando os dados.", undefined, "warning");
      return;
    }
    if (!await guardDraftNavigation()) return;
    setCreateDialog(dialog);
    setMobileOpen(false);
    router.push(`${sectionPaths[section]}?create=${dialog}`);
  }

  function closeCreate() {
    setCreateDialog(null);
    router.replace(sectionPaths[active]);
  }

  async function logout() {
    if (!await guardDraftNavigation()) return;
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setClientCacheScope(null);
      setCurrentUser(null);
      window.localStorage.setItem("harmonize-session-change", String(Date.now()));
      setMobileOpen(false);
      setCreateDialog(null);
      router.replace("/login");
    }
  }

  if (startup.status !== "ready" || !currentUser) {
    return (
      <ClinicEntryTransition
        sessionConfirmed={startup.sessionConfirmed}
        clinicName={startup.clinicName ?? currentUser?.clinic?.name}
        message={startup.message ?? "Preparando seu ambiente de trabalho..."}
        error={startup.status === "error" ? startup.message : undefined}
        onRetry={() => setStartupAttempt((attempt) => attempt + 1)}
        onBackToLogin={() => { void logout(); }}
      />
    );
  }

  function showNotice(message: string, undo?: () => void, tone: "success" | "warning" = "success") {
    if (undo) {
      undoNoticeId.current += 1;
      setUndoNotice({ id: undoNoticeId.current, message, undo, leaving: false });
      return;
    }
    const notify = tone === "warning" ? toast.warning : toast.success;
    notify(message, { duration: 3600 });
  }

  return (
    <CurrentRoleProvider value={currentUser ? { role: currentUser.role, isOwner: currentUser.isOwner, rolePermissions: currentUser.rolePermissions } : null}>
    <div className="harmonize-app min-h-screen bg-background text-foreground">
      <Sidebar
        active={active}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        onSelect={selectSection}
        onNewAppointment={() => openCreate("agenda", "appointment")}
        clinicName={currentUser?.clinic?.name}
        role={currentUser?.role}
        isOwner={currentUser?.isOwner}
        rolePermissions={currentUser?.rolePermissions}
      />
      <div className="lg:pl-[220px]">
        <Topbar user={currentUser} onMenu={() => setMobileOpen(true)} onDashboard={() => selectSection("dashboard")} onSettings={() => selectSection("configuracoes")} onNavigate={selectSection} onOpenStockAlert={openStockAlert} onLogout={logout} />
        <main className={`mx-auto w-full ${active === "agenda" ? "max-w-none" : "max-w-[1500px]"} px-4 pb-10 pt-5 sm:px-7 lg:px-9 lg:pb-10 lg:pt-7`}>
          <AnimatedPage routeKey={active}>
          {currentUser && allowedSections.includes("dashboard") && active === "dashboard" ? <Dashboard userName={currentUser?.name} onNavigate={selectSection} /> : null}
          {currentUser && active === "agenda" ? <ScheduleSection focus={agendaFocus} openCreate={createDialog === "appointment"} onCreateOpen={() => openCreate("agenda", "appointment")} onCreateClose={closeCreate} onSaved={showNotice} /> : null}
          {currentUser && active === "clientes" ? <ClientsSection openCreate={createDialog === "client"} onCreateOpen={() => openCreate("clientes", "client")} onCreateClose={closeCreate} onSaved={showNotice} /> : null}
          {currentUser && allowedSections.includes("procedimentos") && active === "procedimentos" ? <ProceduresSection openCreate={createDialog === "procedure"} onCreateOpen={() => openCreate("procedimentos", "procedure")} onCreateClose={closeCreate} onSaved={showNotice} /> : null}
          {currentUser && allowedSections.includes("estoque") && active === "estoque" ? <StockSection onSaved={showNotice} /> : null}
          {currentUser && allowedSections.includes("compras") && active === "compras" ? <PurchasesSection tab={purchasesTab} onTabChange={setPurchasesTab} onSaved={showNotice} /> : null}
          {currentUser && active === "orcamentos" ? <QuotesSection openCreate={createDialog === "quote"} onCreateOpen={() => openCreate("orcamentos", "quote")} onCreateClose={closeCreate} onSaved={showNotice} /> : null}
          {currentUser && allowedSections.includes("pagamentos") && active === "pagamentos" ? <PaymentsSection openCreate={createDialog === "payment"} onCreateOpen={() => openCreate("pagamentos", "payment")} onCreateClose={closeCreate} onSaved={showNotice} /> : null}
          {currentUser && allowedSections.includes("financeiro") && active === "financeiro" ? <FinanceSection /> : null}
          {currentUser && allowedSections.includes("relatorios") && active === "relatorios" ? <ReportsSection /> : null}
          {currentUser && allowedSections.includes("configuracoes") && active === "configuracoes" ? <SettingsSection isOwner={currentUser.isOwner} clinicName={currentUser.clinic?.name} onClinicNameChange={(name) => setCurrentUser((current) => current ? { ...current, clinic: { ...(current.clinic ?? {}), name } } : current)} onRolePermissionsChange={(rolePermissions) => {
            setClientCacheScope(`${currentUser.id}:${currentUser.clinicId}:${JSON.stringify(rolePermissions)}`);
            setCurrentUser((current) => current ? { ...current, rolePermissions } : current);
          }} /> : null}
          </AnimatedPage>
        </main>
      </div>
      <AppToaster />
      {undoNotice ? <div className={`${undoNotice.leaving ? "hp-snackbar-exit" : "hp-snackbar-enter"} fixed bottom-6 left-1/2 z-[90] w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-[8px] border border-border bg-card px-4 py-3 text-xs font-bold text-card-foreground shadow-[0_18px_45px_rgba(31,32,50,0.18)]`} role="status"><div className="flex items-center gap-3"><span className="min-w-0 flex-1">{undoNotice.message}</span><button className="shrink-0 rounded-full bg-muted px-3 py-1.5 text-[11px] font-black text-foreground transition hover:bg-muted/80" onClick={() => { const undo = undoNotice.undo; setUndoNotice(null); undo(); }}>Desfazer</button></div><div className="hp-snackbar-progress mt-3 h-1 rounded-full bg-success" style={{ "--snackbar-duration": "6500ms" } as CSSProperties} /></div> : null}
    </div>
    </CurrentRoleProvider>
  );
}
