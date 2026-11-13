"use client";

import { useId, useState, type ComponentType, type KeyboardEvent, type ReactNode } from "react";
import { Award, BarChart3, CalendarCheck, CalendarDays, ChevronDown, Download, FileText, Info, Loader2, Percent, Repeat, Stethoscope, Syringe, Ticket, TrendingDown, TrendingUp, UserPlus, Users, Wallet, CircleDollarSign, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CountUp } from "@/components/ui/count-up";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { fieldClassName } from "@/components/ui/modal";
import type { ExportExtension } from "@/lib/reports-document";
import { exportFormatLabels } from "@/lib/reports-center-rules";
import { exportFormatsFor } from "@/lib/reports-export-rules";
import type { ReportGranularity, ReportPeriod } from "@/lib/reports-rules";
import {
  customRangeError, formatMoneyBr, formatNumberPtBr, formatPctBr, formatRangeLabel, granularityLabels, limitationText, overviewMatchesFilters, periodPresetLabel, periodPresets,
  reportKey, reportQueryString, variationInfo, type ReportFilters,
} from "@/lib/reports-ui-rules";
import { cn } from "@/lib/utils";
import { FinanceHeader, useFinanceResource } from "../finance-shared";
import { ChartLegend, Note, PanelError, TrendChart, VariationLine, IconBox } from "./report-parts";
import { ReportCenter } from "./report-center";
import { ReportTabContent } from "./report-tabs";
import { useReportExport } from "./use-report-export";
import type { OverviewData, ReportTabId } from "./report-types";

const tabDefinitions: Array<{ id: ReportTabId; label: string; icon: ComponentType<{ className?: string }>; needs: "finance" | "quotes" | "stock" | null }> = [
  { id: "procedures", label: "Procedimentos", icon: Syringe, needs: null },
  { id: "professionals", label: "Profissionais", icon: Stethoscope, needs: null },
  { id: "appointments", label: "Agendamentos", icon: CalendarCheck, needs: null },
  { id: "clients", label: "Clientes", icon: Users, needs: null },
  { id: "quotes", label: "Orçamentos", icon: FileText, needs: "quotes" },
  { id: "finance", label: "Financeiro", icon: Wallet, needs: "finance" },
  { id: "stock", label: "Estoque", icon: Package, needs: "stock" },
];

const initialFilters: ReportFilters = { period: "last30", from: "", to: "", compare: false, professional: "", granularity: null };

export function ReportsSection() {
  const [filters, setFilters] = useState<ReportFilters>(initialFilters);
  // Filtros que já foram enviados ao servidor: o período personalizado incompleto não consulta nada e mantém o último resultado.
  const [applied, setApplied] = useState<ReportFilters>(initialFilters);
  const [tab, setTab] = useState<ReportTabId>("procedures");
  const { busy: exportBusy, run: runExport } = useReportExport(applied);
  const exporting = exportBusy !== null;
  const rangeError = filters.period === "custom" ? customRangeError(filters.from, filters.to) : null;

  const overview = useFinanceResource<OverviewData>(reportKey("/api/reports/overview", applied), true);
  const data = overview.data;
  const stale = Boolean(data) && !overviewMatchesFilters(data as OverviewData, applied);

  function update(patch: Partial<ReportFilters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    if (next.period !== "custom" || !customRangeError(next.from, next.to)) setApplied(next);
  }

  function changePeriod(period: ReportPeriod) {
    // Ao abrir o personalizado, parte do intervalo que já está na tela.
    if (period === "custom") update({ period, granularity: null, from: data?.range.start ?? filters.from, to: data?.range.end ?? filters.to });
    else update({ period, granularity: null });
  }

  const tabs = tabDefinitions.filter((definition) => data && (definition.needs === null || data.capabilities[definition.needs]));
  const activeTab = tabs.some((definition) => definition.id === tab) ? tab : (tabs[0]?.id ?? "procedures");

  const periodLabel = data && !stale ? formatRangeLabel(data.range) : periodPresetLabel(applied.period);
  const professionals = data?.professionals ?? [];
  const currentTabLabel = tabDefinitions.find((definition) => definition.id === activeTab)?.label ?? "Aba atual";

  return (
    <div>
      <FinanceHeader icon={BarChart3} title="Relatórios e desempenho" description="Análises e indicadores para uma gestão mais inteligente da sua clínica." />

      <div className="mb-5 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" aria-label={`Período: ${periodLabel}. Alterar período`}>
                <CalendarDays className="h-4 w-4 text-primary" aria-hidden />
                <span className="tabular-nums">{periodLabel}</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-52">
              <DropdownMenuLabel className="text-muted-foreground">Período</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={filters.period} onValueChange={(value) => changePeriod(value as ReportPeriod)}>
                {periodPresets.map((preset) => <DropdownMenuRadioItem key={preset.value} value={preset.value} className="min-h-9">{preset.label}</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <CompareSwitch checked={filters.compare} onChange={(compare) => update({ compare })} />

          {professionals.length > 0 ? (
            <label className="flex items-center gap-2">
              <span className="sr-only">Profissional</span>
              <select className={cn(fieldClassName, "h-10 w-auto max-w-56 max-lg:h-11")} value={filters.professional} onChange={(event) => update({ professional: event.target.value })} aria-label="Filtrar por profissional">
                <option value="">Todos os profissionais</option>
                {professionals.map((name) => <option key={name} value={name}>{name}</option>)}
                {filters.professional && !professionals.includes(filters.professional) ? <option value={filters.professional}>{filters.professional}</option> : null}
              </select>
            </label>
          ) : null}

          <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" disabled={exporting || Boolean(rangeError)} aria-busy={exporting} aria-label={exporting ? "Gerando arquivo…" : "Exportar relatório"}>
                  {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
                  Exportar
                  <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-64">
                <ExportGroup label={`Aba atual: ${currentTabLabel}`} formats={exportFormatsFor(activeTab)} onExport={(format) => void runExport(activeTab, format)} />
                <DropdownMenuSeparator />
                <ExportGroup label="Consolidado (todos os relatórios permitidos)" formats={exportFormatsFor("all")} onExport={(format) => void runExport("all", format)} />
                <p className="px-2 pb-1.5 pt-1 text-[11px] leading-4 text-muted-foreground">Excel (.xlsx) é a planilha formatada. CSV é texto simples (UTF-8, separador “;”) e abre sem formatação.</p>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {filters.period === "custom" ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-xs font-semibold text-muted-foreground">De
              <input type="date" className={cn(fieldClassName, "block h-10 w-auto max-lg:h-11")} value={filters.from} max={filters.to || undefined} onChange={(event) => update({ from: event.target.value, granularity: null })} />
            </label>
            <label className="space-y-1 text-xs font-semibold text-muted-foreground">Até
              <input type="date" className={cn(fieldClassName, "block h-10 w-auto max-lg:h-11")} value={filters.to} min={filters.from || undefined} onChange={(event) => update({ to: event.target.value, granularity: null })} />
            </label>
            {rangeError ? <p role="alert" className="pb-2 text-xs font-semibold text-destructive">{rangeError}</p> : null}
          </div>
        ) : null}

        {data && professionals.length === 0 && data.appliedProfessional ? <Note>Mostrando apenas os atendimentos de {data.appliedProfessional}.</Note> : null}
      </div>

      {overview.error ? <PanelError message={overview.error} onRetry={overview.reload} /> : !data ? <OverviewSkeleton /> : (
        <div className={cn("space-y-5 transition-opacity", stale && "opacity-60")} aria-busy={stale}>
          <KpiCards data={data} />
          <TrendCharts data={data} granularity={applied.granularity ?? data.series.granularity} onGranularity={(granularity) => update({ granularity })} stale={stale} />

          <Card>
            <div role="tablist" aria-label="Detalhamento do relatório" className="flex gap-1 overflow-x-auto border-b border-border px-2 pt-2" onKeyDown={(event) => moveTab(event, tabs.map((definition) => definition.id), activeTab, setTab)}>
              {tabs.map((definition) => {
                const selected = definition.id === activeTab;
                return (
                  <button
                    key={definition.id}
                    type="button"
                    role="tab"
                    id={`report-tab-${definition.id}`}
                    aria-selected={selected}
                    aria-controls={`report-panel-${definition.id}`}
                    tabIndex={selected ? 0 : -1}
                    data-report-tab={definition.id}
                    onClick={() => setTab(definition.id)}
                    className={cn("-mb-px flex shrink-0 items-center gap-2 whitespace-nowrap rounded-t-md border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-lg:min-h-11", selected ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
                  >
                    <definition.icon className="h-4 w-4" aria-hidden />
                    {definition.label}
                  </button>
                );
              })}
            </div>
            <div role="tabpanel" id={`report-panel-${activeTab}`} aria-labelledby={`report-tab-${activeTab}`} tabIndex={0} className="p-4 focus-visible:outline-none">
              <ReportTabContent key={`${activeTab}:${reportQueryString(applied)}`} tab={activeTab} filters={applied} />
            </div>
          </Card>

          <Insights data={data} />
          <ReportCenter capabilities={data.capabilities} filters={applied} disabled={Boolean(rangeError)} />
        </div>
      )}
    </div>
  );
}

// Setas, Home e End movem o foco entre as abas (padrão WAI-ARIA).
function moveTab(event: KeyboardEvent<HTMLDivElement>, ids: ReportTabId[], current: ReportTabId, select: (id: ReportTabId) => void) {
  const index = ids.indexOf(current);
  let next = index;
  if (event.key === "ArrowRight") next = (index + 1) % ids.length;
  else if (event.key === "ArrowLeft") next = (index - 1 + ids.length) % ids.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = ids.length - 1;
  else return;
  event.preventDefault();
  select(ids[next]);
  event.currentTarget.querySelector<HTMLButtonElement>(`[data-report-tab="${ids[next]}"]`)?.focus();
}

function CompareSwitch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-center gap-2.5">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 max-lg:bg-clip-content max-lg:py-2.5 max-lg:h-11", checked ? "bg-primary" : "bg-muted-foreground/35")}
      >
        <span aria-hidden className={cn("absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform max-lg:top-3", checked ? "translate-x-5" : "translate-x-0")} />
      </button>
      <label htmlFor={id} className="cursor-pointer text-sm font-semibold text-foreground">Comparar com período anterior</label>
    </div>
  );
}

// O consolidado não tem CSV (exportFormatsFor): o menu só oferece Excel e PDF nele.
function ExportGroup({ label, formats, onExport }: { label: string; formats: readonly ExportExtension[]; onExport: (format: ExportExtension) => void }) {
  return (
    <>
      <DropdownMenuLabel className="text-muted-foreground">{label}</DropdownMenuLabel>
      {formats.map((format) => (
        <DropdownMenuItem key={format} className="min-h-9 gap-2" onSelect={() => onExport(format)}>
          {format === "pdf" ? <FileText className="h-4 w-4" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
          Baixar {exportFormatLabels[format]}
        </DropdownMenuItem>
      ))}
    </>
  );
}

// ---------- Cards ----------

function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <span tabIndex={0} role="img" aria-label={text} className="cursor-help rounded text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"><Info className="h-3.5 w-3.5" aria-hidden /></span>
      <span aria-hidden className="pointer-events-none absolute bottom-full right-0 z-50 mb-2 w-60 rounded-lg border border-border bg-popover px-3 py-2 text-xs font-normal leading-5 text-popover-foreground opacity-0 shadow-xl transition group-hover:opacity-100 group-focus-within:opacity-100">{text}</span>
    </span>
  );
}

type KpiProps = { icon: ComponentType<{ className?: string }>; tone: string; label: ReactNode; value: ReactNode; variation?: ReactNode; note?: string; tip?: string };

function Kpi({ icon, tone, label, value, variation, note, tip }: KpiProps) {
  return (
    <Card className="flex items-start gap-3 p-4">
      <IconBox icon={icon} className={tone} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-1">
          <p className="text-xs font-semibold leading-4 text-muted-foreground">{label}</p>
          {tip ? <InfoTip text={tip} /> : null}
        </div>
        <p className="mt-0.5 truncate text-2xl font-black text-foreground">{value}</p>
        {variation}
        {note ? <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{note}</p> : null}
      </div>
    </Card>
  );
}

function KpiCards({ data }: { data: OverviewData }) {
  const { cards } = data;
  const comparing = data.previousRange !== null;
  const variation = (value: number | null | undefined, kind: "pct" | "pp" = "pct") => (comparing ? <VariationLine info={variationInfo(value, kind)} suffix="vs período anterior" /> : <p className="text-xs text-muted-foreground">Sem comparação</p>);
  const blocked = cards.revenueLimitation === "payment_without_professional";
  const hideRevenue = cards.revenueLimitation === "forbidden";
  const limitNote = blocked ? "Indisponível com filtro de profissional: o pagamento não é vinculado ao profissional." : undefined;
  const items: ReactNode[] = [
    <Kpi key="appointments" icon={CircleDollarSign} tone="bg-accent text-primary" label="Atendimentos realizados" value={<CountUp value={cards.appointments.value} format={(value) => formatNumberPtBr(Math.round(value), 0)} />} variation={variation(cards.appointments.changePct)} />,
  ];
  if (!hideRevenue) {
    items.push(<Kpi key="revenue" icon={TrendingUp} tone="bg-success/10 text-success" label="Receita recebida" value={cards.revenue ? <CountUp value={(cards.revenue.value ?? 0) / 100} format={(value) => formatMoneyBr(Math.round(value * 100))} /> : "—"} variation={cards.revenue ? variation(cards.revenue.changePct) : undefined} note={limitNote} />);
  }
  items.push(<Kpi key="newPatients" icon={UserPlus} tone="bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300" label="Novos pacientes" value={<CountUp value={cards.newPatients.value} format={(value) => formatNumberPtBr(Math.round(value), 0)} />} variation={variation(cards.newPatients.changePct)} />);
  items.push(<Kpi key="returnRate" icon={Repeat} tone="bg-warning/10 text-warning" label="Taxa de retorno" value={cards.returnRate.value === null ? "—" : <CountUp value={cards.returnRate.value} format={(value) => formatPctBr(value)} />} variation={variation(cards.returnRate.changePp, "pp")} note={cards.returnRate.value === null ? "Sem pacientes atendidos no período." : undefined} />);
  if (!hideRevenue) {
    items.push(<Kpi key="avgTicket" icon={Ticket} tone="bg-pink-100 text-pink-600 dark:bg-pink-500/15 dark:text-pink-300" label={<>Ticket médio <span className="font-medium">(receita ÷ atendimentos)</span></>} tip={cards.avgTicketNote} value={cards.avgTicket && cards.avgTicket.value !== null ? <CountUp value={cards.avgTicket.value / 100} format={(value) => formatMoneyBr(Math.round(value * 100))} /> : "—"} variation={cards.avgTicket && cards.avgTicket.value !== null ? variation(cards.avgTicket.changePct) : undefined} note={limitNote ?? (cards.avgTicket && cards.avgTicket.value === null ? "Sem receita ou sem atendimentos no período." : "Aproximação gerencial.")} />);
  }
  return (
    <div className={cn("hp-list-stagger grid gap-4 sm:grid-cols-2", items.length >= 5 ? "xl:grid-cols-5" : "xl:grid-cols-3")}>
      {items}
    </div>
  );
}

// ---------- Gráficos ----------

function GranularitySelect({ value, onChange, label }: { value: ReportGranularity; onChange: (value: ReportGranularity) => void; label: string }) {
  return (
    <select className={cn(fieldClassName, "h-9 w-auto shrink-0 max-lg:h-11")} value={value} onChange={(event) => onChange(event.target.value as ReportGranularity)} aria-label={label}>
      {(Object.keys(granularityLabels) as ReportGranularity[]).map((key) => <option key={key} value={key}>{granularityLabels[key]}</option>)}
    </select>
  );
}

function TrendCharts({ data, granularity, onGranularity, stale }: { data: OverviewData; granularity: ReportGranularity; onGranularity: (value: ReportGranularity) => void; stale: boolean }) {
  const compare = data.previousRange !== null;
  const revenueBlocked = data.cards.revenueLimitation === "payment_without_professional";
  const showRevenue = data.cards.revenueLimitation !== "forbidden";
  return (
    <div className={cn("grid gap-5", showRevenue && "lg:grid-cols-2")}>
      <Card>
        <CardHeader className="flex-wrap items-center">
          <div className="space-y-1"><CardTitle className="text-base">Atendimentos realizados</CardTitle><ChartLegend compare={compare} /></div>
          <GranularitySelect value={granularity} onChange={onGranularity} label="Agrupamento do gráfico de atendimentos" />
        </CardHeader>
        <CardContent>
          <TrendChart points={data.series.appointments} unit="count" granularity={data.series.granularity} compare={compare} noun="Atendimentos" ariaLabel="Gráfico de área com os atendimentos realizados por período" stale={stale} />
        </CardContent>
      </Card>
      {showRevenue ? (
        <Card>
          <CardHeader className="flex-wrap items-center">
            <div className="space-y-1"><CardTitle className="text-base">Receita recebida</CardTitle><ChartLegend compare={compare} /></div>
            <GranularitySelect value={granularity} onChange={onGranularity} label="Agrupamento do gráfico de receita" />
          </CardHeader>
          <CardContent>
            {data.series.revenue ? (
              <TrendChart points={data.series.revenue} unit="money" granularity={data.series.granularity} compare={compare} noun="Receita" ariaLabel="Gráfico de área com a receita recebida por período" stale={stale} />
            ) : (
              <div className="grid h-64 place-items-center rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                {revenueBlocked ? limitationText(data.cards.revenueLimitation) : "Receita indisponível."} Remova o filtro de profissional para ver a receita da clínica.
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

// ---------- Insights ----------

const insightMeta: Record<string, { label: string; icon: ComponentType<{ className?: string }> }> = {
  revenue: { label: "Receita", icon: TrendingUp },
  topProcedure: { label: "Procedimento mais realizado", icon: Award },
  topProfessional: { label: "Profissional com mais atendimentos", icon: Stethoscope },
  busiestWeekday: { label: "Dia de maior movimento", icon: CalendarDays },
  returnRate: { label: "Taxa de retorno", icon: Repeat },
  quoteConversion: { label: "Conversão de orçamentos", icon: Percent },
};
const comparisonInsights = new Set(["revenue", "returnRate", "quoteConversion"]);

function Insights({ data }: { data: OverviewData }) {
  const comparing = data.previousRange !== null;
  return (
    <section aria-labelledby="report-insights-title">
      <h3 id="report-insights-title" className="mb-3 text-base font-bold text-foreground">Insights do período</h3>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.insights.map((insight) => {
          const meta = insightMeta[insight.id] ?? { label: "Insight", icon: Info };
          const needsComparison = !comparing && comparisonInsights.has(insight.id);
          const unavailable = !insight.available || needsComparison;
          const Icon = insight.id === "revenue" && insight.tone === "negative" ? TrendingDown : meta.icon;
          const tone = unavailable ? "bg-muted text-muted-foreground" : insight.tone === "positive" ? "bg-success/10 text-success" : insight.tone === "negative" ? "bg-destructive/10 text-destructive" : "bg-accent text-primary";
          return (
            <Card key={insight.id} className="flex items-start gap-3 p-4">
              <IconBox icon={Icon} className={tone} />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-muted-foreground">{meta.label}</p>
                {unavailable ? (
                  <>
                    <p className="mt-0.5 text-sm font-bold text-muted-foreground">{needsComparison ? "Comparação desligada" : "Dados insuficientes"}</p>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{needsComparison ? "Ative “Comparar com período anterior” para ver esta evolução." : insight.message}</p>
                  </>
                ) : (
                  <p className={cn("mt-0.5 text-sm font-bold leading-5", insight.tone === "positive" ? "text-success" : insight.tone === "negative" ? "text-destructive" : "text-foreground")}>{insight.message}</p>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

// ---------- Carregando ----------

function OverviewSkeleton() {
  return (
    <div role="status" aria-label="Carregando relatórios" className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-28" />)}</div>
      <div className="grid gap-5 lg:grid-cols-2"><Skeleton className="h-80" /><Skeleton className="h-80" /></div>
      <Skeleton className="h-72" />
    </div>
  );
}
