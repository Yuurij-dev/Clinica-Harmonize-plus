"use client";

import { useMemo, useState } from "react";
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
  const [active, setActive] = useState<SectionId>("agenda");
  const [mobileOpen, setMobileOpen] = useState(false);

  const title = useMemo(
    () => navItems.find((item) => item.id === active)?.label ?? "Dashboard",
    [active],
  );

  return (
    <div className="min-h-screen bg-[#f8f9fc] text-[#191a2e]">
      <Sidebar
        active={active}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        onSelect={setActive}
      />
      <div className="lg:pl-[220px]">
        <Topbar title={title} onMenu={() => setMobileOpen(true)} />
        <main className="mx-auto w-full max-w-[1500px] px-4 pb-28 pt-5 sm:px-7 lg:px-9 lg:pb-10 lg:pt-7">
          {active === "dashboard" ? <Dashboard /> : null}
          {active === "agenda" ? <ScheduleSection /> : null}
          {active === "clientes" ? <ClientsSection /> : null}
          {active === "procedimentos" ? <ProceduresSection /> : null}
          {active === "orcamentos" ? <QuotesSection /> : null}
          {active === "pagamentos" ? <PaymentsSection /> : null}
          {active === "financeiro" ? <FinanceSection /> : null}
          {active === "relatorios" ? <ReportsSection /> : null}
          {active === "configuracoes" ? <SettingsSection /> : null}
        </main>
      </div>
      <MobileNav active={active} onSelect={setActive} />
    </div>
  );
}
