"use client";

import type { CSSProperties } from "react";
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

type Notice = {
  id: number;
  message: string;
  undo?: () => void;
  duration: number;
};

export function HarmonizeApp() {
  const router = useRouter();
  const [active, setActive] = useState<SectionId>("agenda");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [createDialog, setCreateDialog] = useState<"appointment" | "client" | "procedure" | "quote" | "payment" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [noticeLeaving, setNoticeLeaving] = useState(false);

  useEffect(() => {
    if (!notice) return;
    const leaveTimer = window.setTimeout(() => setNoticeLeaving(true), notice.duration);
    const clearTimer = window.setTimeout(() => {
      setNotice(null);
      setNoticeLeaving(false);
    }, notice.duration + 240);
    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(clearTimer);
    };
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

  function showNotice(message: string, undo?: () => void) {
    setNoticeLeaving(false);
    setNotice({
      id: Date.now(),
      message,
      undo,
      duration: undo ? 6500 : 3600,
    });
  }

  function undoNotice() {
    notice?.undo?.();
    setNotice(null);
    setNoticeLeaving(false);
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
          {active === "agenda" ? <ScheduleSection openCreate={createDialog === "appointment"} onCreateOpen={() => setCreateDialog("appointment")} onCreateClose={() => setCreateDialog(null)} onSaved={showNotice} /> : null}
          {active === "clientes" ? <ClientsSection openCreate={createDialog === "client"} onCreateOpen={() => setCreateDialog("client")} onCreateClose={() => setCreateDialog(null)} onSaved={showNotice} /> : null}
          {active === "procedimentos" ? <ProceduresSection openCreate={createDialog === "procedure"} onCreateOpen={() => setCreateDialog("procedure")} onCreateClose={() => setCreateDialog(null)} onSaved={showNotice} /> : null}
          {active === "orcamentos" ? <QuotesSection openCreate={createDialog === "quote"} onCreateOpen={() => setCreateDialog("quote")} onCreateClose={() => setCreateDialog(null)} onSaved={showNotice} /> : null}
          {active === "pagamentos" ? <PaymentsSection openCreate={createDialog === "payment"} onCreateOpen={() => setCreateDialog("payment")} onCreateClose={() => setCreateDialog(null)} onSaved={showNotice} /> : null}
          {active === "financeiro" ? <FinanceSection /> : null}
          {active === "relatorios" ? <ReportsSection /> : null}
          {active === "configuracoes" ? <SettingsSection /> : null}
        </main>
      </div>
      <MobileNav active={active} onSelect={setActive} />
      {notice ? (
        <div
          className={`${noticeLeaving ? "hp-snackbar-exit" : "hp-snackbar-enter"} fixed bottom-24 left-1/2 z-[90] w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-[8px] bg-[#25263a] text-xs font-bold text-white shadow-[0_18px_45px_rgba(31,32,50,0.24)] lg:bottom-6`}
          key={notice.id}
        >
          <div className="flex items-center gap-3 px-4 py-3">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[#78e6a1]" />
            <span className="min-w-0 flex-1">{notice.message}</span>
            {notice.undo ? (
              <button className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-black text-white transition hover:bg-white/18" onClick={undoNotice}>
                Desfazer
              </button>
            ) : null}
          </div>
          <div className="h-1.5 bg-white/14">
            <div
              className="hp-snackbar-progress h-full bg-[#7cffb2] shadow-[0_0_14px_rgba(124,255,178,0.38)]"
              style={{ "--snackbar-duration": `${notice.duration}ms` } as CSSProperties}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
