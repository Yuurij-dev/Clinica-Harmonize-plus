"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CalendarClock, ChevronLeft, ChevronRight, CircleDollarSign, Clock3, Plus, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CountUp } from "@/components/ui/count-up";
import { fieldClassName } from "@/components/ui/modal";
import { addDays, addMonths, type FinancePeriod, type FlowGranularity } from "@/lib/finance-rules";
import { cn } from "@/lib/utils";
import { useCan } from "./current-user";
import { ErrorNote, ExpenseFormModal, FinanceHeader, financeKey, formatCents, formatDate, LoadingBlock, useFinanceResource } from "./finance-shared";
import type { MovementsResponse } from "./finance-movements";
import { PaymentCreateModal } from "./payment-modals";
import { type RecurringList, recurringKey, scheduleLabel } from "./recurring-expenses";
import { EmptyState } from "./shared";

type Totals = { revenueCents: number; receivedCents: number; pendingReceivableCents: number; expensesCents: number; resultCents: number; payableCents: number };
type Summary = { period: FinancePeriod; date: string; range: { start: string; end: string }; totals: Totals; previousRange: { start: string; end: string }; previousTotals: Totals; counts: { pendingReceivable: number; payable: number } };
type Flow = { granularity: FlowGranularity; period: FinancePeriod; date: string; series: Array<{ key: string; label: string; revenueCents: number; expensesCents: number }> };

const periodLabels: Record<FinancePeriod, string> = { today: "Hoje", week: "Semana", month: "Mês" };
const previousLabels: Record<FinancePeriod, string> = { today: "dia anterior", week: "semana anterior", month: "mês anterior" };
const granularityLabels: Record<FlowGranularity, string> = { day: "Diário", week: "Semanal", month: "Mensal" };
const revenueColor = "#6d5ae6";
const expenseColor = "#f5a524";

function monthLabel(date: string) {
  const text = new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(" de ", " ");
  return text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1);
}

// Variação em % contra o período anterior; sem percentual quando o anterior é zero.
function variation(current: number, previous: number) {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

function compactCurrency(value: number) {
  if (value >= 1000) return `R$ ${(value / 1000).toFixed(value % 1000 ? 1 : 0).replace(".", ",")}k`;
  return `R$ ${value}`;
}

export function FinanceDashboard({ period, date, today, onPeriod, onDate, onGo }: { period: FinancePeriod; date: string; today: string; onPeriod: (period: FinancePeriod) => void; onDate: (date: string) => void; onGo: (view: "movimentacoes" | "recorrentes" | "contas", tab?: "receber" | "pagar", range?: { from: string; to: string }) => void }) {
  const canRevenue = useCan("payments:access");
  const canReceive = useCan("payments:manage");
  const canExpense = useCan("finance:manage");
  const [granularity, setGranularity] = useState<FlowGranularity>("day");
  const [modal, setModal] = useState<"revenue" | "expense" | null>(null);
  const dateParam = date === today ? "" : date;

  const summaryState = useFinanceResource<Summary>(financeKey("/api/finance/summary", { period, date: dateParam }), true);
  const flowState = useFinanceResource<Flow>(financeKey("/api/finance/flow", { granularity, period, date: dateParam }), true);
  const summary = summaryState.data;
  const recentKey = summary && (canRevenue || canExpense) ? financeKey("/api/finance/movements", { type: "all", from: summary.range.start, to: summary.range.end, sort: "desc", page: 1, pageSize: 4 }) : null;
  const recentState = useFinanceResource<MovementsResponse>(recentKey, true);
  const recurringState = useFinanceResource<RecurringList>(canExpense ? recurringKey : null);

  function shift(direction: 1 | -1) {
    onDate(period === "month" ? addMonths(date, direction, 1) : addDays(date, direction * (period === "week" ? 7 : 1)));
  }
  const dateLabel = period === "month" ? monthLabel(date) : summary && period === "week" ? `${formatDate(summary.range.start).slice(0, 5)} – ${formatDate(summary.range.end).slice(0, 5)}` : formatDate(date);

  const totals = summary?.totals;
  const previous = summary?.previousTotals;
  const cards: Array<{ label: string; value?: number; delta: number | null; goodWhenUp: boolean; hint?: string; icon: React.ComponentType<{ className?: string }>; tone: string; negative?: boolean }> = [
    { label: "Receita total", value: totals?.revenueCents, delta: totals && previous ? variation(totals.revenueCents, previous.revenueCents) : null, goodWhenUp: true, icon: TrendingUp, tone: "bg-success/10 text-success" },
    { label: "Despesas", value: totals?.expensesCents, delta: totals && previous ? variation(totals.expensesCents, previous.expensesCents) : null, goodWhenUp: false, icon: TrendingDown, tone: "bg-destructive/10 text-destructive" },
    { label: "Lucro líquido", value: totals?.resultCents, delta: totals && previous ? variation(totals.resultCents, previous.resultCents) : null, goodWhenUp: true, icon: Wallet, tone: "bg-accent text-primary", negative: (totals?.resultCents ?? 0) < 0 },
    { label: "Em aberto", value: totals?.pendingReceivableCents, delta: null, goodWhenUp: true, hint: "Valores a receber", icon: Clock3, tone: "bg-warning/10 text-warning" },
  ];

  const flowStale = Boolean(flowState.data) && (flowState.data?.granularity !== granularity || flowState.data?.period !== period || flowState.data?.date !== date);
  const series = flowState.data?.series ?? [];
  const chartData = series.map((item) => ({ label: item.label, Receitas: item.revenueCents / 100, Despesas: item.expensesCents / 100 }));
  const chartEmpty = series.every((item) => item.revenueCents === 0 && item.expensesCents === 0);
  const recent = recentState.data?.items ?? [];
  const activeRecurring = (recurringState.data?.recurringExpenses ?? []).filter((item) => item.active).slice(0, 3);

  return (
    <div>
      <FinanceHeader icon={CircleDollarSign} title="Financeiro" description="Visão geral da saúde financeira da clínica."
        actions={<>
          <div className="flex gap-1" role="group" aria-label="Período">
            {(Object.keys(periodLabels) as FinancePeriod[]).map((value) => <Button key={value} size="sm" variant={period === value ? "primary" : "secondary"} aria-pressed={period === value} onClick={() => onPeriod(value)}>{periodLabels[value]}</Button>)}
          </div>
          <div className="flex items-center gap-1 rounded-[8px] border border-input bg-white px-1 shadow-sm">
            <Button size="icon" variant="ghost" aria-label="Período anterior" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="min-w-[110px] text-center text-sm font-semibold text-foreground" aria-live="polite">{dateLabel}</span>
            <Button size="icon" variant="ghost" aria-label="Próximo período" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
          {date !== today ? <Button size="sm" variant="ghost" onClick={() => onDate(today)}>Voltar para hoje</Button> : null}
          {canReceive && canRevenue ? <Button onClick={() => setModal("revenue")}><Plus className="h-4 w-4" />Nova receita</Button> : null}
          {canExpense ? <Button variant="secondary" onClick={() => setModal("expense")}><Plus className="h-4 w-4" />Nova despesa</Button> : null}
        </>} />

      {summaryState.error ? <div className="mb-4"><ErrorNote message={summaryState.error} onRetry={summaryState.reload} /></div> : null}
      <div className="hp-list-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card className="flex items-center gap-3 p-4" key={card.label}>
            <span className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-xl", card.tone)}><card.icon className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-muted-foreground">{card.label}</p>
              <p className={cn("truncate text-xl font-black", card.negative ? "text-destructive" : "text-foreground")}>
                {card.value === undefined ? <span className="text-muted-foreground">—</span> : <CountUp value={card.value / 100} format={(current) => formatCents(Math.round(current * 100))} />}
              </p>
              {card.delta !== null ? (
                <p className={cn("flex items-center gap-0.5 text-[11px] font-bold", (card.delta >= 0) === card.goodWhenUp ? "text-success" : "text-destructive")}>
                  {card.delta >= 0 ? <ArrowUpRight className="h-3 w-3" aria-hidden /> : <ArrowDownLeft className="h-3 w-3" aria-hidden />}
                  {card.delta > 0 ? "+" : ""}{card.delta}% vs. {previousLabels[period]}
                </p>
              ) : card.hint ? <p className="text-[11px] font-semibold text-muted-foreground">{card.hint}</p> : null}
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-5">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle className="text-base">Fluxo financeiro</CardTitle>
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full" style={{ background: revenueColor }} />Receitas</span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full" style={{ background: expenseColor }} />Despesas</span>
          </div>
          <select className={`${fieldClassName} h-9 w-auto`} value={granularity} onChange={(event) => setGranularity(event.target.value as FlowGranularity)} aria-label="Agrupamento do fluxo">
            {(Object.keys(granularityLabels) as FlowGranularity[]).map((value) => <option key={value} value={value}>{granularityLabels[value]}</option>)}
          </select>
        </CardHeader>
        <CardContent>
          {flowState.loading ? <LoadingBlock className="h-64" /> : flowState.error ? <ErrorNote message={flowState.error} onRetry={flowState.reload} /> : chartEmpty ? <EmptyState title="Sem movimentações no período" description="Receitas e despesas pagas aparecem aqui." /> : (
            <div className={cn("h-64 transition-opacity", flowStale && "opacity-40")} aria-busy={flowStale} role="img" aria-label="Gráfico de barras com receitas e despesas por período">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={4}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e8e9f2" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} interval="preserveStartEnd" />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} width={56} tickFormatter={(value) => compactCurrency(Number(value))} />
                  <Tooltip cursor={{ fill: "rgba(109, 90, 230, 0.06)" }} formatter={(value) => formatCents(Math.round(Number(value) * 100))} />
                  <Bar dataKey="Receitas" fill={revenueColor} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="Despesas" fill={expenseColor} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Movimentações recentes</CardTitle><Button size="sm" variant="ghost" className="text-primary" onClick={() => onGo("movimentacoes", undefined, summary ? { from: summary.range.start, to: summary.range.end } : undefined)}>Ver todas<ArrowRight className="h-3.5 w-3.5" /></Button></CardHeader>
          <CardContent>
            {!recentKey ? <p className="text-sm text-muted-foreground">{summaryState.error ? "Indisponível." : canRevenue || canExpense ? "Carregando..." : "Sem permissão para ver movimentações."}</p> : recentState.loading ? <LoadingBlock className="py-4" /> : recentState.error ? <ErrorNote message={recentState.error} onRetry={recentState.reload} /> : recent.length ? (
              <ul className="space-y-3">
                {recent.map((item) => (
                  <li key={`${item.kind}-${item.id}`} className="flex items-center gap-3">
                    <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", item.kind === "revenue" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>{item.kind === "revenue" ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}</span>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-foreground">{item.description}</p><p className="text-[11px] text-muted-foreground">{formatDate(item.date)} · {item.kind === "revenue" ? "Receita" : "Despesa"}</p></div>
                    <strong className={cn("shrink-0 text-sm", item.kind === "revenue" ? "text-success" : "text-destructive")}>{item.kind === "revenue" ? "+ " : "− "}{formatCents(item.amountCents)}</strong>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">Nenhuma movimentação neste período.</p>}
          </CardContent>
        </Card>

        {canExpense ? <Card>
          <CardHeader><CardTitle className="text-base">Despesas recorrentes</CardTitle><Button size="sm" variant="ghost" className="text-primary" data-setup-target="financeiro" onClick={() => onGo("recorrentes")}>Ver todas<ArrowRight className="h-3.5 w-3.5" /></Button></CardHeader>
          <CardContent>
            {recurringState.loading ? <LoadingBlock className="py-4" /> : recurringState.error ? <ErrorNote message={recurringState.error} onRetry={recurringState.reload} /> : activeRecurring.length ? (
              <ul className="space-y-3">
                {activeRecurring.map((item) => (
                  <li key={item.id} className="flex items-center gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-primary"><CalendarClock className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-foreground">{item.description}</p><p className="text-[11px] text-muted-foreground">{scheduleLabel(item)}</p></div>
                    <strong className="shrink-0 text-sm text-foreground">{formatCents(item.amountCents)}</strong>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">Nenhuma despesa fixa ativa.</p>}
          </CardContent>
        </Card> : null}

        <Card>
          <CardHeader><CardTitle className="text-base">Contas a pagar e receber</CardTitle><Button size="sm" variant="ghost" className="text-primary" onClick={() => onGo("contas", canRevenue ? "receber" : "pagar")}>Ver todas<ArrowRight className="h-3.5 w-3.5" /></Button></CardHeader>
          <CardContent className="space-y-3">
            {!canRevenue && !canExpense ? <p className="text-sm text-muted-foreground">Sem permissão para ver contas.</p> : !summary ? <LoadingBlock className="py-4" /> : <>
              {canRevenue ? <AccountBlock tone="green" label="A receber" value={summary.totals.pendingReceivableCents} count={summary.counts.pendingReceivable} onClick={() => onGo("contas", "receber")} /> : null}
              {canExpense ? <AccountBlock tone="red" label="A pagar" value={summary.totals.payableCents} count={summary.counts.payable} onClick={() => onGo("contas", "pagar")} /> : null}
            </>}
          </CardContent>
        </Card>
      </div>

      <PaymentCreateModal open={modal === "revenue"} onClose={() => setModal(null)} onCreated={(_, patient) => toast.success(`Pagamento de ${patient} foi registrado.`)} />
      {modal === "expense" ? <ExpenseFormModal expense={null} onClose={() => setModal(null)} onSaved={() => { setModal(null); toast.success("Despesa registrada."); }} /> : null}
    </div>
  );
}

function AccountBlock({ tone, label, value, count, onClick }: { tone: "green" | "red"; label: string; value: number; count: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition hover:shadow-sm", tone === "green" ? "border-success/20 bg-success/5" : "border-destructive/20 bg-destructive/5")}>
      <div>
        <p className={cn("text-xs font-bold", tone === "green" ? "text-success" : "text-destructive")}>{label}</p>
        <p className="text-lg font-black text-foreground">{formatCents(value)}</p>
        <p className="text-[11px] text-muted-foreground">{count} {count === 1 ? "pendência" : "pendências"}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
    </button>
  );
}
