"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { AppToaster } from "./app-toaster";
import { Dashboard } from "./dashboard";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import {
  ClientsSection,
  FinanceSection,
  PaymentsSection,
  ProceduresSection,
  QuotesSection,
  ReportsSection,
  ScheduleSection,
  SettingsSection,
} from "./sections";
import type { SectionId } from "@/types/clinic";

type CurrentUser = { name: string; role: string; isOwner?: boolean; trialExpired?: boolean; clinic?: { name: string; trialEndsAt?: string | null } };
type AgendaFocus = { date: string; time: string };
type CreateDialog = "appointment" | "client" | "procedure" | "quote" | "payment";
type HarmonizeAppProps = { initialCreate?: CreateDialog };

const sectionPaths: Record<SectionId, string> = {
  dashboard: "/dashboard",
  agenda: "/",
  clientes: "/clientes",
  procedimentos: "/procedimentos",
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
  const [agendaFocus, setAgendaFocus] = useState<AgendaFocus | null>(null);
  const isAdmin = currentUser?.role === "ADMIN";
  const trialExpired = currentUser?.trialExpired === true;
  const restrictedSections: SectionId[] = ["agenda", "clientes", "orcamentos"];

  function selectSection(section: SectionId, focus?: AgendaFocus) {
    if (!isAdmin && !restrictedSections.includes(section)) {
      return;
    }
    setAgendaFocus(section === "agenda" ? focus ?? null : null);
    setMobileOpen(false);
    setCreateDialog(null);
    router.push(sectionPaths[section]);
  }

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (response) => {
        if (!response.ok) {
          router.replace("/login");
          return null;
        }
        return response.json() as Promise<{ user: CurrentUser }>;
      })
      .then((data) => setCurrentUser(data?.user ?? null))
      .catch(() => {
        router.replace("/login");
      });
  }, [router]);

  function openCreate(section: SectionId, dialog: NonNullable<typeof createDialog>) {
    if (trialExpired) {
      showNotice("O teste grátis terminou. Ative um plano para continuar alterando os dados.", undefined, "warning");
      return;
    }
    setCreateDialog(dialog);
    setMobileOpen(false);
    router.push(`${sectionPaths[section]}?create=${dialog}`);
  }

  function closeCreate() {
    setCreateDialog(null);
    router.replace(sectionPaths[active]);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setMobileOpen(false);
    setCreateDialog(null);
    router.replace("/login");
  }

  function showNotice(message: string, undo?: () => void, tone: "success" | "warning" = "success") {
    const notify = tone === "warning" ? toast.warning : toast.success;
    notify(message, {
      duration: undo ? 6500 : 3600,
      action: undo ? { label: "Desfazer", onClick: undo } : undefined,
    });
  }

  return (
    <div className="harmonize-app min-h-screen bg-background text-foreground">
      <Sidebar
        active={active}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        onSelect={selectSection}
        onNewAppointment={() => openCreate("agenda", "appointment")}
        clinicName={currentUser?.clinic?.name}
        isAdmin={isAdmin}
      />
      <div className="lg:pl-[220px]">
        <Topbar user={currentUser} onMenu={() => setMobileOpen(true)} onDashboard={() => selectSection("dashboard")} onSettings={() => selectSection("configuracoes")} onNavigate={selectSection} onLogout={logout} />
        <main className={`mx-auto w-full ${active === "agenda" ? "max-w-none" : "max-w-[1500px]"} px-4 pb-10 pt-5 sm:px-7 lg:px-9 lg:pb-10 lg:pt-7`}>
          {active === "dashboard" && isAdmin ? <Dashboard userName={currentUser?.name} onAction={(action) => {
            const target = { client: ["clientes", "client"], appointment: ["agenda", "appointment"], quote: ["orcamentos", "quote"], payment: ["pagamentos", "payment"] }[action] as [SectionId, NonNullable<typeof createDialog>];
            openCreate(target[0], target[1]);
          }} onNavigate={selectSection} /> : null}
          {active === "agenda" ? <ScheduleSection focus={agendaFocus} openCreate={createDialog === "appointment"} onCreateOpen={() => openCreate("agenda", "appointment")} onCreateClose={closeCreate} onSaved={showNotice} /> : null}
          {active === "clientes" ? <ClientsSection openCreate={createDialog === "client"} onCreateOpen={() => openCreate("clientes", "client")} onCreateClose={closeCreate} onSaved={showNotice} /> : null}
          {active === "procedimentos" && isAdmin ? <ProceduresSection openCreate={createDialog === "procedure"} onCreateOpen={() => openCreate("procedimentos", "procedure")} onCreateClose={closeCreate} onSaved={showNotice} /> : null}
          {active === "orcamentos" ? <QuotesSection openCreate={createDialog === "quote"} onCreateOpen={() => openCreate("orcamentos", "quote")} onCreateClose={closeCreate} onSaved={showNotice} /> : null}
          {active === "pagamentos" && isAdmin ? <PaymentsSection openCreate={createDialog === "payment"} onCreateOpen={() => openCreate("pagamentos", "payment")} onCreateClose={closeCreate} onSaved={showNotice} /> : null}
          {active === "financeiro" && isAdmin ? <FinanceSection /> : null}
          {active === "relatorios" && isAdmin ? <ReportsSection /> : null}
          {active === "configuracoes" && isAdmin ? <SettingsSection isAdmin isOwner={currentUser?.isOwner} clinicName={currentUser?.clinic?.name} onClinicNameChange={(name) => setCurrentUser((current) => current ? { ...current, clinic: { ...(current.clinic ?? {}), name } } : current)} /> : null}
        </main>
      </div>
      <AppToaster />
    </div>
  );
}
