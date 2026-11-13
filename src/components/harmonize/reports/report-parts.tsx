"use client";

import { useId, type ComponentType, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { compactMoney, formatDateBr, formatMoneyBr, formatNumberPtBr, variationInfo, type VariationInfo } from "@/lib/reports-ui-rules";
import type { ReportGranularity } from "@/lib/reports-rules";
import { EmptyState } from "../shared";

export const chartColor = "#6d5ae6";
export const chartPreviousColor = "#a99df2";
export const donutColors = ["#6d5ae6", "#2f7bf5", "#16a870", "#f5a524", "#e0559b", "#8b93a7"];

// ---------- Variação ----------

export function VariationLine({ info, suffix, className }: { info: VariationInfo; suffix?: string; className?: string }) {
  const Icon = info.direction === "up" ? ArrowUpRight : info.direction === "down" ? ArrowDownRight : Minus;
  const tone = info.direction === "up" ? "text-success" : info.direction === "down" ? "text-destructive" : "text-muted-foreground";
  const word = info.direction === "up" ? "aumento de" : info.direction === "down" ? "queda de" : info.direction === "flat" ? "sem variação:" : "sem base de comparação";
  return (
    <p className={cn("flex flex-wrap items-center gap-x-1 text-xs font-bold", tone, className)}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span><span className="sr-only">{word} </span>{info.text}</span>
      {suffix ? <span className="font-medium text-muted-foreground">{suffix}</span> : null}
    </p>
  );
}

// ---------- Indicador simples (abas) ----------

export function StatTile({ label, value, note, change, changeKind = "pct", showChange }: { label: string; value: ReactNode; note?: string; change?: number | null; changeKind?: "pct" | "pp"; showChange?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-black text-foreground">{value}</p>
      {showChange ? <VariationLine className="mt-1" info={variationInfo(change, changeKind)} suffix="vs período anterior" /> : null}
      {note ? <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{note}</p> : null}
    </Card>
  );
}

// ---------- Estados de painel ----------

export function PanelSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Carregando" className="space-y-3">
      <Skeleton className="h-8 w-1/3" />
      {Array.from({ length: rows }, (_, index) => <Skeleton key={index} className="h-9 w-full" />)}
    </div>
  );
}

export function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-semibold text-destructive">
      <span>{message}</span>
      <Button size="sm" variant="secondary" onClick={onRetry}>Tentar novamente</Button>
    </div>
  );
}

type PanelResource<T> = { data: T | undefined; loading: boolean; error: string | undefined; reload: () => void };

// Skeleton enquanto carrega, erro com "tentar novamente", vazio e conteúdo.
export function ReportPanel<T>({ resource, isEmpty, emptyTitle, emptyDescription, children }: { resource: PanelResource<T>; isEmpty?: (data: T) => boolean; emptyTitle: string; emptyDescription: string; children: (data: T) => ReactNode }) {
  if (resource.error) return <PanelError message={resource.error} onRetry={resource.reload} />;
  if (resource.loading || resource.data === undefined) return <PanelSkeleton />;
  if (isEmpty?.(resource.data)) return <EmptyState title={emptyTitle} description={emptyDescription} />;
  return <>{children(resource.data)}</>;
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-5 text-muted-foreground">{children}</p>;
}

export function IconBox({ icon: Icon, className }: { icon: ComponentType<{ className?: string }>; className?: string }) {
  return <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", className)}><Icon className="h-5 w-5" aria-hidden /></span>;
}

// ---------- Gráfico de área: atual (sólida) x anterior (tracejada) ----------

export type TrendPoint = { label: string; date: string; current: number; previous: number | null };

function formatTrendValue(value: number, unit: "count" | "money") {
  return unit === "money" ? formatMoneyBr(Math.round(value)) : formatNumberPtBr(value, 0);
}

type ChartDatum = { label: string; date: string; atual: number; anterior: number | null; plotAtual: number; plotAnterior: number | null };

function TrendTooltip({ active, payload, unit, granularity, noun }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }>; unit: "count" | "money"; granularity: ReportGranularity; noun: string }) {
  const point = payload?.[0]?.payload as ChartDatum | undefined;
  if (!active || !point) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <p className="font-bold">{granularity === "day" ? formatDateBr(point.date) : point.label}</p>
      <p className="mt-1 flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: chartColor }} aria-hidden />{noun}: <strong>{formatTrendValue(point.atual, unit)}</strong></p>
      {point.anterior !== null ? <p className="mt-0.5 flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-full" style={{ background: chartPreviousColor }} aria-hidden />Período anterior: <strong>{formatTrendValue(point.anterior, unit)}</strong></p> : null}
    </div>
  );
}

// Valores em centavos quando unit = "money" (o eixo usa reais).
export function TrendChart({ points, unit, granularity, compare, noun, ariaLabel, stale }: { points: TrendPoint[]; unit: "count" | "money"; granularity: ReportGranularity; compare: boolean; noun: string; ariaLabel: string; stale?: boolean }) {
  const gradient = useId().replace(/[^a-zA-Z0-9]/g, "");
  const scale = unit === "money" ? 100 : 1;
  // plot* = valor no eixo (reais no dinheiro); atual/anterior = valor original para o tooltip.
  const data: ChartDatum[] = points.map((point) => ({ label: point.label, date: point.date, atual: point.current, anterior: point.previous, plotAtual: point.current / scale, plotAnterior: point.previous === null ? null : point.previous / scale }));
  const total = points.reduce((sum, point) => sum + point.current, 0);
  const summary = `${ariaLabel}. Total no período: ${formatTrendValue(total, unit)}.`;
  return (
    <div className={cn("h-64 w-full text-muted-foreground transition-opacity", stale && "opacity-50")} role="img" aria-label={summary} aria-busy={stale}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={chartColor} stopOpacity={0.28} />
              <stop offset="95%" stopColor={chartColor} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.15} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} interval="preserveStartEnd" minTickGap={28} stroke="currentColor" />
          <YAxis tickLine={false} axisLine={false} fontSize={11} width={unit === "money" ? 64 : 36} allowDecimals={false} stroke="currentColor" tickFormatter={(value) => (unit === "money" ? compactMoney(Number(value)) : formatNumberPtBr(Number(value), 0))} />
          <Tooltip cursor={{ stroke: chartColor, strokeOpacity: 0.3 }} content={({ active, payload }) => <TrendTooltip active={active} unit={unit} granularity={granularity} noun={noun} payload={payload} />} />
          {compare ? <Area dataKey="plotAnterior" type="monotone" stroke={chartPreviousColor} strokeWidth={2} strokeDasharray="5 4" fill="none" dot={false} activeDot={false} connectNulls isAnimationActive={false} /> : null}
          <Area dataKey="plotAtual" type="monotone" stroke={chartColor} strokeWidth={2.5} fill={`url(#${gradient})`} dot={points.length <= 1 ? { r: 3 } : false} activeDot={{ r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- Barras (uma ou mais séries do período atual) ----------

export function BarsChart({ data, series, unit, ariaLabel }: { data: Array<{ label: string; date: string; [key: string]: number | string }>; series: Array<{ key: string; label: string; color: string }>; unit: "count" | "money"; ariaLabel: string }) {
  const scale = unit === "money" ? 100 : 1;
  const plot = data.map((item) => ({ ...item, ...Object.fromEntries(series.map((entry) => [entry.key, Number(item[entry.key] ?? 0) / scale])) }));
  const empty = data.every((item) => series.every((entry) => !Number(item[entry.key])));
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((entry) => <span key={entry.key} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: entry.color }} aria-hidden />{entry.label}</span>)}
      </div>
      {empty ? <p className="py-10 text-center text-sm text-muted-foreground">Sem movimento no período.</p> : (
        <div className="h-56 w-full text-muted-foreground" role="img" aria-label={ariaLabel}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={plot} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="18%">
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.15} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} interval="preserveStartEnd" minTickGap={28} stroke="currentColor" />
              <YAxis tickLine={false} axisLine={false} fontSize={11} width={unit === "money" ? 64 : 36} allowDecimals={false} stroke="currentColor" tickFormatter={(value) => (unit === "money" ? compactMoney(Number(value)) : formatNumberPtBr(Number(value), 0))} />
              <Tooltip
                cursor={{ fill: "rgba(109, 90, 230, 0.08)" }}
                contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--popover-foreground)", fontSize: 12 }}
                formatter={(value) => (unit === "money" ? formatMoneyBr(Math.round(Number(value) * 100)) : formatNumberPtBr(Number(value), 0))}
              />
              {series.map((entry) => <Bar key={entry.key} dataKey={entry.key} name={entry.label} fill={entry.color} radius={[4, 4, 0, 0]} maxBarSize={28} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ---------- Tabela com rolagem interna ----------

export type ReportColumn = { header: string; align?: "left" | "right" };

export function ReportTable({ caption, columns, rows, minWidth = 520 }: { caption: string; columns: ReportColumn[]; rows: Array<{ key: string; cells: ReactNode[] }>; minWidth?: number }) {
  return (
    <Table className="text-sm" style={{ minWidth }}>
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columns.map((column) => <TableHead key={column.header} scope="col" className={cn("h-9 whitespace-nowrap px-3", column.align === "right" && "text-right")}>{column.header}</TableHead>)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            {row.cells.map((cell, index) => <TableCell key={index} className={cn("px-3 py-2.5", columns[index]?.align === "right" && "text-right tabular-nums")}>{cell}</TableCell>)}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ChartLegend({ compare }: { compare: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 rounded" style={{ background: chartColor }} aria-hidden />Período atual</span>
      {compare ? <span className="flex items-center gap-1.5"><span className="w-5 border-t-2 border-dashed" style={{ borderColor: chartPreviousColor }} aria-hidden />Período anterior</span> : null}
    </div>
  );
}
