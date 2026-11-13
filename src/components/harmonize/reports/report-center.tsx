"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { BarChart3, CalendarDays, FileText, Loader2, Package, Syringe, UserRound, Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ExportExtension, ReportDefinition, ReportDocument } from "@/lib/reports-document";
import { exportFormatShort, previewIsEmpty, previewItems, previewKey, reportCenterGroups, type ReportCapabilities } from "@/lib/reports-center-rules";
import type { ReportFilters } from "@/lib/reports-ui-rules";
import { useFinanceResource } from "../finance-shared";
import { IconBox, PanelError } from "./report-parts";
import { useReportExport } from "./use-report-export";

const icons: Record<string, ComponentType<{ className?: string }>> = {
  wallet: Wallet, "file-text": FileText, syringe: Syringe, users: Users, calendar: CalendarDays, "user-round": UserRound, package: Package,
};
const formats: ExportExtension[] = ["xlsx", "pdf", "csv"];

// Seção "Central de relatórios": cartões por categoria; prévias (KPIs) só carregam quando a categoria entra na tela.
export function ReportCenter({ capabilities, filters, disabled }: { capabilities: ReportCapabilities; filters: ReportFilters; disabled?: boolean }) {
  const groups = reportCenterGroups(capabilities);
  if (groups.length === 0) return null;
  return (
    <section aria-labelledby="report-center-title">
      <h3 id="report-center-title" className="text-base font-bold text-foreground">Central de relatórios</h3>
      <p className="mb-3 text-xs leading-5 text-muted-foreground">Prévia e download (Excel, PDF ou CSV) de cada relatório, com o período, a comparação e o profissional escolhidos acima.</p>
      <div className="space-y-5">
        {groups.map((group) => <CategoryBlock key={group.category} category={group.category} reports={group.reports} filters={filters} disabled={disabled} />)}
      </div>
    </section>
  );
}

// Marca a categoria como visível uma vez (IntersectionObserver); sem suporte, carrega direto.
function useOnceVisible() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const node = ref.current;
    if (visible || !node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "200px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);
  return { ref, visible };
}

function CategoryBlock({ category, reports, filters, disabled }: { category: string; reports: ReportDefinition[]; filters: ReportFilters; disabled?: boolean }) {
  const { ref, visible } = useOnceVisible();
  return (
    <div ref={ref} role="group" aria-label={`Relatórios de ${category}`}>
      <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{category}</h4>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {reports.map((report) => <ReportCard key={report.id} report={report} filters={filters} enabled={visible && !disabled} disabled={disabled} />)}
      </div>
    </div>
  );
}

function ReportCard({ report, filters, enabled, disabled }: { report: ReportDefinition; filters: ReportFilters; enabled: boolean; disabled?: boolean }) {
  const resource = useFinanceResource<ReportDocument>(enabled ? previewKey(report.id, filters) : null, true);
  const { busy, run } = useReportExport(filters);
  const Icon = icons[report.icon] ?? BarChart3;
  const generating = busy?.kind === report.id;
  return (
    <Card className="flex flex-col gap-3 p-4" aria-busy={generating}>
      <div className="flex items-start gap-3">
        <IconBox icon={Icon} className="bg-accent text-primary" />
        <div className="min-w-0">
          <h5 className="text-sm font-bold text-foreground">{report.label}</h5>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{report.description}</p>
        </div>
      </div>

      <div className="min-h-14" aria-live="polite">
        <Preview resource={resource} enabled={enabled} />
      </div>

      <div className="mt-auto flex flex-wrap gap-2" role="group" aria-label={`Baixar ${report.label}`}>
        {formats.map((format) => {
          const active = generating && busy?.format === format;
          return (
            <Button key={format} size="sm" variant="secondary" className="max-lg:min-h-11" disabled={Boolean(busy) || disabled} onClick={() => void run(report.id, format)} aria-label={active ? `Gerando ${report.label} em ${exportFormatShort[format]}` : `Baixar ${report.label} em ${exportFormatShort[format]}`}>
              {active ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {active ? "Gerando…" : exportFormatShort[format]}
            </Button>
          );
        })}
      </div>
    </Card>
  );
}

function Preview({ resource, enabled }: { resource: { data: ReportDocument | undefined; loading: boolean; error: string | undefined; reload: () => void }; enabled: boolean }) {
  if (resource.error) return <PanelError message="Não foi possível carregar a prévia." onRetry={resource.reload} />;
  if (!enabled || resource.data === undefined) {
    return <div role="status" aria-label="Carregando prévia" className="grid grid-cols-2 gap-3"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>;
  }
  if (previewIsEmpty(resource.data)) return <p className="rounded-md bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground">Sem movimentações no período</p>;
  const items = previewItems(resource.data);
  if (items.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-3">
      {items.map((item) => (
        <div key={item.key} className="min-w-0 rounded-md bg-muted/40 px-3 py-2" title={item.reason ?? undefined}>
          <dt className="truncate text-[11px] font-semibold text-muted-foreground">{item.label}</dt>
          <dd className="truncate text-sm font-black text-foreground">{item.text}{item.reason ? <span className="sr-only"> ({item.reason})</span> : null}</dd>
        </div>
      ))}
    </dl>
  );
}
