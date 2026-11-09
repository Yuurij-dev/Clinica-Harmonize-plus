"use client";

import { Suspense } from "react";
import { clinicToday } from "@/lib/clinic-time";
import { financePeriods, isFinancePeriod, type FinancePeriod } from "@/lib/finance-rules";
import { FinanceAccounts, type AccountsTab } from "./finance-accounts";
import { FinanceDashboard } from "./finance-dashboard";
import { FinanceMovements } from "./finance-movements";
import { FinanceRecurring } from "./finance-recurring";
import { LoadingBlock, useFinanceUrl } from "./finance-shared";

// Importados por Compras e Estoque.
export { invalidateFinanceCache, paymentMethods } from "./finance-shared";
export type { ExpenseRow } from "./finance-shared";

// Navegação interna pela URL: /financeiro?view=movimentacoes|recorrentes|contas (&tab=receber|pagar); sem view = painel.
// No painel, period=today|week|month e date=AAAA-MM-DD também ficam na URL para voltar/atualizar manterem o filtro.
function FinanceRouter() {
  const { view, get, update } = useFinanceUrl();
  const today = clinicToday();
  const rawPeriod = get("period");
  const period: FinancePeriod = isFinancePeriod(rawPeriod) && financePeriods.includes(rawPeriod) ? rawPeriod : "month";
  const validDay = (value: string | null): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
  const rawDate = get("date");
  const date = validDay(rawDate) ? rawDate : today;
  const tab = get("tab");
  const back = () => update({ view: null, tab: null, from: null, to: null });
  const from = get("from");
  const to = get("to");
  const initialRange = validDay(from) && validDay(to) && from <= to ? { from, to } : null;

  if (view === "movimentacoes") return <FinanceMovements reference={date} initialRange={initialRange} onBack={back} />;
  if (view === "recorrentes") return <FinanceRecurring onBack={back} />;
  if (view === "contas") return <FinanceAccounts tab={tab === "pagar" ? "pagar" : tab === "receber" ? "receber" : null} onTab={(next: AccountsTab) => update({ tab: next }, "replace")} onBack={back} />;
  return (
    <FinanceDashboard
      period={period}
      date={date}
      today={today}
      onPeriod={(next) => update({ period: next === "month" ? null : next }, "replace")}
      onDate={(next) => update({ date: next === today ? null : next }, "replace")}
      onGo={(next, nextTab, range) => update({ view: next, tab: nextTab ?? null, from: range?.from ?? null, to: range?.to ?? null })}
    />
  );
}

export function FinanceSection() {
  return <Suspense fallback={<LoadingBlock className="py-16" />}><FinanceRouter /></Suspense>;
}
