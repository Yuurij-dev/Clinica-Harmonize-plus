import { ArrowRight, Filter, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function SectionIntro({
  title,
  description,
  action,
  onAction,
}: {
  title: string;
  description: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="hp-page-enter mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-lg font-bold text-[#3026a8]">{title}</h2>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-[#8a8b9c]">
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

export function SearchFilterBar({
  placeholder,
  value,
  onChange,
  onFilter,
}: {
  placeholder: string;
  value?: string;
  onChange?: (value: string) => void;
  onFilter?: () => void;
}) {
  return (
    <div className="hp-page-enter mb-4 flex flex-col gap-3 sm:flex-row">
      <label className="flex h-10 flex-1 items-center gap-3 rounded-[7px] border border-[#e5e5ec] bg-white px-4 text-xs text-[#8b8c9d] transition-[border-color,box-shadow,background-color] duration-200 focus-within:border-[#5147dc] focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(81,71,220,0.08)]">
        <Search className="h-4 w-4" />
        <input
          className="w-full bg-transparent outline-none placeholder:text-[#8b93aa]"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
        />
      </label>
      <Button variant="secondary" onClick={onFilter}>
        <Filter className="h-4 w-4" />
        Filtrar
      </Button>
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
    <div className="hp-panel-enter overflow-hidden rounded-[7px] border border-[#ebebf1] bg-white shadow-[0_4px_18px_rgba(36,37,58,0.025)]">
      <div
        className="grid min-w-[720px] border-b border-[#eeeeF3] bg-[#fbfbfd] text-[9px] font-bold uppercase text-[#a3a4b2]"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
      >
        {columns.map((column) => (
          <div className="px-4 py-3.5" key={column}>
            {column}
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <div className="hp-list-stagger min-w-[720px] divide-y divide-[#f0f0f4]">
          {rows.map((row, rowIndex) => (
            <div
              className="grid min-h-14 items-center text-xs text-[#555668] transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-[#fafaff]"
              key={rowIndex}
              style={{
                gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`,
              }}
            >
              {row.map((cell, cellIndex) => (
                <div className="px-4 py-3.5" key={cellIndex}>
                  {cell}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="hp-panel-enter rounded-[7px] border border-dashed border-[#d9d9e2] bg-[#fafafd] p-6 text-center">
      <p className="font-bold text-[#121733]">{title}</p>
      <p className="mt-1 text-sm text-[#65708b]">{description}</p>
    </div>
  );
}

export function LoadingSkeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-[6px] bg-[#ececf3]", className)} />;
}

export function LoadingTable({ columns = 6, rows = 4 }: { columns?: number; rows?: number }) {
  return (
    <div aria-label="Carregando" className="overflow-hidden rounded-[7px] border border-[#ebebf1] bg-white">
      <div className="flex gap-4 border-b border-[#eeeeF3] bg-[#fbfbfd] px-4 py-4">
        {Array.from({ length: columns }).map((_, index) => <LoadingSkeleton className="h-2.5 flex-1" key={index} />)}
      </div>
      <div className="divide-y divide-[#f0f0f4]">
        {Array.from({ length: rows }).map((_, row) => <div className="flex min-h-14 items-center gap-4 px-4" key={row}>{Array.from({ length: columns }).map((__, column) => <LoadingSkeleton className={cn("h-3 flex-1", column === 0 && "max-w-32")} key={column} />)}</div>)}
      </div>
    </div>
  );
}

export function DetailCard({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <ArrowRight className="h-4 w-4 text-[#7c86a2]" />
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function ProgressBar({
  value,
  tone = "blue",
}: {
  value: number;
  tone?: "blue" | "green" | "purple" | "amber";
}) {
  const color = {
    blue: "bg-[#1438ff]",
    green: "bg-[#16a34a]",
    purple: "bg-[#7c3aed]",
    amber: "bg-[#f59e0b]",
  }[tone];

  return (
    <div className="h-2 overflow-hidden rounded-full bg-[#edf0f7]">
      <div
        className={cn("h-full rounded-full transition-[width] duration-700 ease-out", color)}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}
