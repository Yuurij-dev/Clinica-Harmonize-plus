"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Dashboard } from "./dashboard";
import { MobileNav } from "./mobile-nav";
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
import { navItems } from "@/data/mock";
import type { SectionId } from "@/types/clinic";

export function HarmonizeApp() {
  const router = useRouter();
  const [active, setActive] = useState<SectionId>("agenda");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [createDialog, setCreateDialog] = useState<"appointment" | "client" | "procedure" | "quote" | "payment" | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function openCreate(section: SectionId, dialog: NonNullable<typeof createDialog>) {
    setActive(section);
    setCreateDialog(dialog);
    setMobileOpen(false);
  }

  const title = useMemo(
    () => navItems.find((item) => item.id === active)?.label ?? "Dashboard",
    [active],
  );

  function logout() {
    setActive("agenda");
    setMobileOpen(false);
    setCreateDialog(null);
    router.push("/login");
  }

  return (
    <div className="min-h-screen bg-[#f8f9fc] text-[#191a2e]">
      <Sidebar
        active={active}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        onSelect={setActive}
        onNewAppointment={() => openCreate("agenda", "appointment")}
      />
      <div className="lg:pl-[220px]">
        <Topbar title={title} onMenu={() => setMobileOpen(true)} onDashboard={() => setActive("dashboard")} onSettings={() => setActive("configuracoes")} onNavigate={setActive} onLogout={logout} />
        <main className="hp-page-enter mx-auto w-full max-w-[1500px] px-4 pb-28 pt-5 sm:px-7 lg:px-9 lg:pb-10 lg:pt-7">
          {active === "dashboard" ? <Dashboard onAction={(action) => {
            const target = { client: ["clientes", "client"], appointment: ["agenda", "appointment"], quote: ["orcamentos", "quote"], payment: ["pagamentos", "payment"] }[action] as [SectionId, NonNullable<typeof createDialog>];
            openCreate(target[0], target[1]);
          }} onNavigate={setActive} /> : null}
          {active === "agenda" ? <ScheduleSection openCreate={createDialog === "appointment"} onCreateOpen={() => setCreateDialog("appointment")} onCreateClose={() => setCreateDialog(null)} onSaved={setNotice} /> : null}
          {active === "clientes" ? <ClientsSection openCreate={createDialog === "client"} onCreateOpen={() => setCreateDialog("client")} onCreateClose={() => setCreateDialog(null)} onSaved={setNotice} /> : null}
          {active === "procedimentos" ? <ProceduresSection openCreate={createDialog === "procedure"} onCreateOpen={() => setCreateDialog("procedure")} onCreateClose={() => setCreateDialog(null)} onSaved={setNotice} /> : null}
          {active === "orcamentos" ? <QuotesSection openCreate={createDialog === "quote"} onCreateOpen={() => setCreateDialog("quote")} onCreateClose={() => setCreateDialog(null)} onSaved={setNotice} /> : null}
          {active === "pagamentos" ? <PaymentsSection openCreate={createDialog === "payment"} onCreateOpen={() => setCreateDialog("payment")} onCreateClose={() => setCreateDialog(null)} onSaved={setNotice} /> : null}
          {active === "financeiro" ? <FinanceSection /> : null}
          {active === "relatorios" ? <ReportsSection /> : null}
          {active === "configuracoes" ? <SettingsSection /> : null}
        </main>
      </div>
      <MobileNav active={active} onSelect={setActive} />
      {notice ? <div className="fixed bottom-24 right-4 z-[90] flex max-w-sm items-center gap-3 rounded-[7px] bg-[#25263a] px-4 py-3 text-xs font-bold text-white shadow-xl lg:bottom-6"><CheckCircle2 className="h-4 w-4 text-[#78e6a1]" />{notice}</div> : null}
    </div>
  );
}
