import { ArrowRight, FileText, Filter, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, inputVariants } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { staggerDelay } from "@/lib/count-up-rules";

export function SectionIntro({
  title,
  titleAddon,
  description,
  action,
  onAction,
}: {
  title: string;
  titleAddon?: React.ReactNode;
  description: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div data-hp-title className="hp-page-enter mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-primary">{title}</h2>
          {titleAddon}
        </div>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      {action ? (
        <Button onClick={onAction}>
          <Plus className="h-4 w-4" />
          {action}
        </Button>
      ) : null}
    </div>
  );
}

export const PageHeader = SectionIntro;

export function PageContainer({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-5", className)} {...props} />;
}

export function SearchFilterBar({
  placeholder,
  value,
  onChange,
  onFilter,
  trailing,
  showFilter = true,
}: {
  placeholder: string;
  value?: string;
  onChange?: (value: string) => void;
  onFilter?: () => void;
  trailing?: React.ReactNode;
  showFilter?: boolean;
}) {
  return (
    <div className={cn("hp-page-enter mb-4 flex flex-col gap-3", trailing ? "lg:flex-row lg:items-end" : "sm:flex-row sm:items-end")}>
      <label className="group flex h-10 min-w-0 flex-1 items-center gap-3 rounded-[8px] border border-input bg-white px-4 text-xs text-muted-foreground transition-[border-color,box-shadow,background-color] duration-150 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          className="h-auto text-sm border-0 bg-transparent p-0 shadow-none focus-visible:border-0 focus-visible:ring-0"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          aria-label={placeholder}
        />
      </label>
      {showFilter ? <Button variant="secondary" onClick={onFilter}>
        <Filter className="h-4 w-4" />
        Filtrar
      </Button> : null}
      {trailing}
    </div>
  );
}

export function DateRangeFilter({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  clearable = true,
}: {
  startDate: string;
  endDate: string;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  clearable?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1.5 text-xs font-bold uppercase text-[#8c8d9f]">
        De
        <input className={cn(inputVariants, "h-10 min-w-[160px] px-3.5 text-sm font-semibold sm:min-w-[180px]")} type="date" value={startDate} max={endDate || undefined} aria-label="Data inicial" onChange={(event) => onStartDateChange(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1.5 text-xs font-bold uppercase text-[#8c8d9f]">
        Até
        <input className={cn(inputVariants, "h-10 min-w-[160px] px-3.5 text-sm font-semibold sm:min-w-[180px]")} type="date" value={endDate} min={startDate || undefined} aria-label="Data final" onChange={(event) => onEndDateChange(event.target.value)} />
      </label>
      {clearable && (startDate || endDate) ? <Button className="px-3 text-xs" variant="ghost" size="sm" type="button" onClick={() => { onStartDateChange(""); onEndDateChange(""); }}>Limpar datas</Button> : null}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "Pago" ||
    status === "Atendido" ||
    status === "Ativa" ||
    status === "Aprovado"
      ? "green"
      : status === "Faltou" ||
          status === "Cancelado" ||
          status === "Recusado"
        ? "red"
        : status === "Pendente" || status === "Parcial" || status === "Retorno"
          ? "amber"
          : status === "Em atendimento" || status === "Enviado"
            ? "purple"
            : "blue";

  return <Badge variant={variant}>{status}</Badge>;
}

export function MiniTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: (string | React.ReactNode)[][];
}) {
  return (
    <>
    <div className="hp-panel-enter overflow-hidden rounded-lg border border-border bg-card shadow-sm max-lg:hidden">
      <Table className="min-w-[720px]">
        <TableHeader>
          <TableRow className="bg-muted/60 hover:bg-muted/60">
            {columns.map((column) => <TableHead className="h-11 px-4 text-xs font-semibold uppercase" key={column}>{column}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody className="hp-list-stagger">
          {rows.map((row, rowIndex) => <TableRow className="min-h-14 text-foreground" key={rowIndex}>{row.map((cell, cellIndex) => <TableCell className="px-4 py-3.5" key={cellIndex}>{cell}</TableCell>)}</TableRow>)}
        </TableBody>
      </Table>
    </div>
    <RowCards columns={columns} rows={rows} />
    </>
  );
}

const actionColumns = ["Ação", "Ações"];
const statusColumns = ["Status", "Situação"];

/**
 * Versão celular (abaixo de lg) do MiniTable: uma linha vira um cartão.
 * Convenção das colunas: a 1ª identifica a linha, "Status"/"Situação" vira selo no topo,
 * "Ação" fica no rodapé (alvo de 44px) e as demais viram pares rótulo/valor.
 */
function RowCards({ columns, rows }: { columns: string[]; rows: (string | React.ReactNode)[][] }) {
  const actionIndex = actionColumns.includes(columns[columns.length - 1]) ? columns.length - 1 : -1;
  const statusIndex = columns.findIndex((column, index) => index > 0 && statusColumns.includes(column));
  return (
    <ul className="hp-list-stagger space-y-3 lg:hidden">
      {rows.map((row, rowIndex) => (
        <li className="rounded-lg border border-border bg-card p-4 text-foreground shadow-sm" key={rowIndex}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 break-words text-sm font-semibold">{row[0]}</div>
            {statusIndex > 0 ? <div className="shrink-0">{row[statusIndex]}</div> : null}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
            {columns.map((column, index) => index === 0 || index === statusIndex || index === actionIndex ? null : (
              <div className="min-w-0" key={column}>
                <dt className="text-xs font-medium text-muted-foreground">{column}</dt>
                <dd className="mt-0.5 min-w-0 break-words text-sm">{row[index] || "—"}</dd>
              </div>
            ))}
          </dl>
          {actionIndex > 0 ? <div className="mt-3 flex gap-2 border-t border-border pt-3 [&>*]:flex-1">{row[actionIndex]}</div> : null}
        </li>
      ))}
    </ul>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="hp-panel-enter rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center">
      <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-accent text-accent-foreground"><FileText className="h-5 w-5" /></span>
      <p className="mt-3 font-semibold text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function LoadingSkeleton({ className = "" }: { className?: string }) {
  return <Skeleton className={cn("hp-skeleton", className)} />;
}

export function LoadingTable({ columns = 6, rows = 4 }: { columns?: number; rows?: number }) {
  return (
    <>
    <div aria-label="Carregando" aria-busy="true" className="space-y-3 lg:hidden">{Array.from({ length: rows }).map((_, row) => <div className="rounded-lg border border-border bg-card p-4" key={row}><LoadingSkeleton className="h-4 w-2/3" /><LoadingSkeleton className="mt-3 h-3 w-full" /><LoadingSkeleton className="mt-2 h-3 w-1/2" /></div>)}</div>
    <div aria-label="Carregando" aria-busy="true" className="overflow-hidden rounded-lg border border-border bg-card max-lg:hidden">
      <Table className="min-w-[720px]"><TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">{Array.from({ length: columns }).map((_, index) => <TableHead key={index}><LoadingSkeleton className="h-3 w-full" /></TableHead>)}</TableRow></TableHeader><TableBody>{Array.from({ length: rows }).map((_, row) => <TableRow key={row}>{Array.from({ length: columns }).map((__, column) => <TableCell key={column}><LoadingSkeleton className={cn("h-3 w-full", column === 0 && "max-w-32")} /></TableCell>)}</TableRow>)}</TableBody></Table>
    </div>
    </>
  );
}

export function DetailCard({
  title,
  children,
  className,
  onAction,
  expanded = false,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  onAction?: () => void;
  expanded?: boolean;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {onAction ? (
          <button type="button" aria-label={`${expanded ? "Recolher" : "Expandir"} ${title}`} aria-expanded={expanded} className="rounded-sm text-[#7c86a2] max-lg:-m-3.5 max-lg:p-3.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" onClick={onAction}>
            <ArrowRight className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : ""}`} />
          </button>
        ) : <ArrowRight className="h-4 w-4 text-[#7c86a2]" />}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function ProgressBar({
  value,
  tone = "blue",
  index = 0,
}: {
  value: number;
  tone?: "blue" | "green" | "purple" | "amber";
  /** Posição na lista: barras em sequência preenchem em cascata (35ms por item, teto de 5). */
  index?: number;
}) {
  const color = {
    blue: "bg-primary",
    green: "bg-success",
    purple: "bg-primary",
    amber: "bg-warning",
  }[tone];

  return <Progress value={value} indicatorClassName={color} revealDelay={staggerDelay(index, 35, 5)} aria-label="Progresso" />;
}

export function StatCard({ label, value, detail, icon: Icon }: { label: string; value: React.ReactNode; detail?: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return <Card className="p-4">
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs font-bold uppercase text-muted-foreground">{label}</p>
      {Icon ? <Icon className="h-3.5 w-3.5 text-primary" /> : null}
    </div>
    <p className="mt-3 text-xl font-bold text-foreground">{value}</p>
    {detail ? <p className="mt-1 text-xs font-medium text-muted-foreground">{detail}</p> : null}
  </Card>;
}
