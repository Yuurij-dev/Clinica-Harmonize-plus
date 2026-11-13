"use client";

import { useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell as PieCell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { columnAlign, type Cell, type ChartSection, type KpiItem, type KpiSection, type ReportDocument, type Row, type TableSection, type Tone } from "@/lib/reports-document";
import { cellView, groupSections, tableUnknownReasons, visibleRowCount, TABLE_PAGE_SIZE } from "@/lib/reports-center-rules";
import { compactMoney, formatMoneyBr, formatNumberPtBr, formatPctBr, variationInfo } from "@/lib/reports-ui-rules";
import { EmptyState } from "../shared";
import { Note, VariationLine, chartColor, chartPreviousColor, donutColors } from "./report-parts";

const toneText: Record<Tone, string> = { negative: "text-destructive", positive: "text-success", warning: "text-warning", muted: "text-muted-foreground" };

// Célula tipada: desconhecido vira "—" com o motivo em dica (title) e para leitores de tela; nunca R$ 0,00.
function CellContent({ cell }: { cell: Cell }) {
  const view = cellView(cell);
  if (!view.unknown) return <>{view.text}</>;
  return <span title={view.reason ?? undefined} className="text-muted-foreground">{view.text}<span className="sr-only"> ({view.reason})</span></span>;
}

// ---------- KPIs ----------

function KpiTile({ item, comparing }: { item: KpiItem; comparing: boolean }) {
  const view = cellView(item.value);
  const previous = item.previous ? cellView(item.previous) : null;
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold leading-4 text-muted-foreground">{item.label}</p>
      <p className={cn("mt-1 break-words text-xl font-black text-foreground", item.tone && toneText[item.tone], view.unknown && "text-muted-foreground")} title={view.reason ?? undefined}>
        {view.text}
        {view.unknown ? <span className="sr-only"> ({view.reason})</span> : null}
      </p>
      {view.unknown && view.reason ? <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{capitalize(view.reason)}.</p> : null}
      {comparing ? <VariationLine className="mt-1" info={variationInfo(item.change, item.changeKind ?? "pct")} suffix="vs período anterior" /> : null}
      {comparing && previous && !previous.unknown ? <p className="text-[11px] leading-4 text-muted-foreground">Período anterior: {previous.text}</p> : null}
      {item.hint ? <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{item.hint}</p> : null}
    </Card>
  );
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

function KpiGrid({ section, comparing }: { section: KpiSection; comparing: boolean }) {
  return (
    <section aria-label={section.title ?? "Indicadores"} className="space-y-2">
      {section.title ? <h3 className="text-sm font-bold text-foreground">{section.title}</h3> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {section.items.map((item) => <KpiTile key={item.key} item={item} comparing={comparing} />)}
      </div>
    </section>
  );
}

// ---------- Tabelas ----------

const alignClass = { left: "text-left", right: "text-right tabular-nums", center: "text-center tabular-nums" } as const;

function DocumentTable({ section }: { section: TableSection }) {
  const [pages, setPages] = useState(1);
  const shown = visibleRowCount(section.rows.length, pages);
  const rows: Row[] = section.rows.slice(0, shown);
  const reasons = tableUnknownReasons(section);
  const aligns = section.columns.map(columnAlign);
  const minWidth = Math.max(360, section.columns.length * 120);
  const renderRow = (row: Row, key: string, strong = false) => (
    <TableRow key={key} className={cn(strong && "bg-muted/40 font-bold hover:bg-muted/40")}>
      {row.cells.map((cell, index) => (
        <TableCell key={index} className={cn("px-3 py-2.5", alignClass[aligns[index] ?? "left"], row.tone && toneText[row.tone])}>
          <CellContent cell={cell} />
        </TableCell>
      ))}
    </TableRow>
  );
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{section.title}</CardTitle></CardHeader>
      <CardContent>
        {section.rows.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum registro no período.</p> : (
          <>
            <Table className="text-sm" style={{ minWidth }}>
              <TableCaption className="sr-only">{section.title}</TableCaption>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {section.columns.map((column, index) => <TableHead key={column.key} scope="col" className={cn("h-9 whitespace-nowrap px-3", alignClass[aligns[index]])}>{column.label}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => renderRow(row, String(index)))}
                {section.total && shown >= section.rows.length ? renderRow(section.total, "total", true) : null}
              </TableBody>
            </Table>
            {shown < section.rows.length ? (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <p className="text-xs text-muted-foreground" role="status">Exibindo {formatNumberPtBr(shown)} de {formatNumberPtBr(section.rows.length)} linhas.</p>
                <Button size="sm" variant="ghost" className="text-primary" onClick={() => setPages((current) => current + 1)}>Mostrar mais {TABLE_PAGE_SIZE}</Button>
                <Button size="sm" variant="ghost" onClick={() => setPages(Math.ceil(section.rows.length / TABLE_PAGE_SIZE))}>Mostrar todas</Button>
              </div>
            ) : null}
          </>
        )}
        <div className="mt-2 space-y-1">
          {section.notes.map((text) => <Note key={text}>{text}</Note>)}
          {reasons.length > 0 ? <Note>“—” = {reasons.join("; ")}.</Note> : null}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Gráficos (só quando há dados; o documento já omite gráfico vazio) ----------

function formatUnit(value: number, unit: ChartSection["unit"]) {
  return unit === "money" ? formatMoneyBr(Math.round(value)) : unit === "percent" ? formatPctBr(value) : formatNumberPtBr(value, 0);
}

function DocumentChart({ section }: { section: ChartSection }) {
  const scale = section.unit === "money" ? 100 : 1;
  const colorOf = (index: number, style?: string) => (style === "previous" ? chartPreviousColor : index === 0 ? chartColor : donutColors[index % donutColors.length]);
  const data = section.categories.map((label, index) => ({
    label,
    ...Object.fromEntries(section.series.map((series, seriesIndex) => [`s${seriesIndex}`, series.values[index] === null || series.values[index] === undefined ? null : (series.values[index] as number) / scale])),
  }));
  const axis = (value: number) => (section.unit === "money" ? compactMoney(value) : section.unit === "percent" ? formatPctBr(value, 0) : formatNumberPtBr(value, 0));
  const tooltipFormatter = (value: unknown) => formatUnit(Number(value) * scale, section.unit);
  const legend = (
    <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {section.series.map((series, index) => <span key={series.name} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: colorOf(index, series.style) }} aria-hidden />{series.name}</span>)}
    </div>
  );

  if (section.kind === "donut") {
    const values = section.series[0]?.values ?? [];
    const slices = section.categories.map((name, index) => ({ name, value: Math.max(0, values[index] ?? 0) })).filter((slice) => slice.value > 0);
    const total = slices.reduce((sum, slice) => sum + slice.value, 0);
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{section.title}</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <div className="h-44 w-44 shrink-0" role="img" aria-label={`${section.title}: ${slices.map((slice) => `${slice.name} ${formatUnit(slice.value, section.unit)}`).join("; ")}`}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={slices} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={slices.length > 1 ? 2 : 0} stroke="none">
                    {slices.map((slice, index) => <PieCell key={slice.name} fill={donutColors[index % donutColors.length]} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="min-w-0 flex-1 space-y-1.5 self-stretch text-xs">
              {slices.map((slice, index) => (
                <li key={slice.name} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: donutColors[index % donutColors.length] }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-semibold text-foreground" title={slice.name}>{slice.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{formatPctBr((slice.value / total) * 100)} · {formatUnit(slice.value, section.unit)}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    );
  }

  const margin = { top: 8, right: 8, bottom: 0, left: 0 };
  const commonAxes = (
    <>
      <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.15} />
      <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} interval="preserveStartEnd" minTickGap={28} stroke="currentColor" />
      <YAxis tickLine={false} axisLine={false} fontSize={11} width={section.unit === "money" ? 64 : 40} allowDecimals={false} stroke="currentColor" tickFormatter={(value) => axis(Number(value))} />
      <Tooltip cursor={{ fill: "rgba(109, 90, 230, 0.08)" }} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--popover-foreground)", fontSize: 12 }} formatter={tooltipFormatter} />
    </>
  );
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{section.title}</CardTitle></CardHeader>
      <CardContent>
        {legend}
        <div className="h-56 w-full text-muted-foreground" role="img" aria-label={`${section.title}. Os mesmos valores estão nas tabelas.`}>
          <ResponsiveContainer width="100%" height="100%">
            {section.kind === "line" ? (
              <LineChart data={data} margin={margin}>
                {commonAxes}
                {section.series.map((series, index) => <Line key={series.name} dataKey={`s${index}`} name={series.name} type="monotone" stroke={colorOf(index, series.style)} strokeWidth={series.style === "previous" ? 2 : 2.5} strokeDasharray={series.style === "previous" ? "5 4" : undefined} dot={section.categories.length <= 1 ? { r: 3 } : false} connectNulls isAnimationActive={false} />)}
              </LineChart>
            ) : (
              <BarChart data={data} margin={margin} barGap={2} barCategoryGap="18%">
                {commonAxes}
                {section.series.map((series, index) => <Bar key={series.name} dataKey={`s${index}`} name={series.name} fill={colorOf(index, series.style)} radius={[4, 4, 0, 0]} maxBarSize={28} />)}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Notas ----------

function DocumentNote({ tone, text }: { tone: "info" | "warning"; text: string }) {
  return (
    <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5", tone === "warning" ? "border-warning/30 bg-warning/10 text-foreground" : "border-border bg-muted/30 text-muted-foreground")}>
      <Info className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", tone === "warning" ? "text-warning" : "text-muted-foreground")} aria-hidden />
      <p>{text}</p>
    </div>
  );
}

// ---------- Documento ----------

export function ReportDocumentView({ doc, showMeta = true }: { doc: ReportDocument; showMeta?: boolean }): ReactNode {
  const comparing = doc.comparePeriod !== null;
  const meta = [`Período: ${doc.period.label}`, comparing ? `Comparado com ${doc.comparePeriod?.label}` : null, ...doc.filters.map((filter) => `${filter.label}: ${filter.value}`)].filter(Boolean).join(" · ");

  // Sem movimentação: mensagem clara, sem gráficos nem tabelas vazias.
  if (!doc.hasData) {
    const messages = doc.sections.flatMap((section) => (section.type === "note" ? [section.text] : []));
    return (
      <div className="space-y-3">
        {showMeta ? <Note>{meta}</Note> : null}
        <EmptyState title="Sem movimentações no período" description={messages.join(" ") || "Nenhuma movimentação no período."} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showMeta ? <Note>{meta}</Note> : null}
      {groupSections(doc.sections).map((group, index) => {
        if (group.kind === "charts") {
          return (
            <div key={`charts-${index}`} className={cn("grid gap-4", group.sections.length > 1 && "lg:grid-cols-2")}>
              {group.sections.map((section) => (section.type === "chart" ? <DocumentChart key={section.id} section={section} /> : null))}
            </div>
          );
        }
        const section = group.section;
        if (section.type === "kpis") return <KpiGrid key={section.id} section={section} comparing={comparing} />;
        if (section.type === "table") return <DocumentTable key={section.id} section={section} />;
        if (section.type === "note") return <DocumentNote key={section.id} tone={section.tone} text={section.text} />;
        return null;
      })}
    </div>
  );
}
