"use client";

import { type ReactNode, useMemo } from "react";
import { BarChart3, CalendarDays, ChevronRight, CircleAlert, FileText, Layers3, MessageSquare, Play, ShieldAlert, Syringe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { activeTreatmentSummary, clinicalPendings, latestEvolution, sortEncounters, type EncounterItem, type EncounterStatus, type EncounterType } from "@/lib/clinical-record-rules";
import { cn } from "@/lib/utils";
import { useCan } from "./current-user";
import { ClinicalAlertList, alertsDisclaimer } from "./patient-anamnesis";
import { anamnesisKey, encountersKey, formatDate, formatTime, formatWeekday, useCachedResource, type AnamnesisOverview, type EncountersResponse } from "./patient-clinical-data";
import { EmptyState, LoadingSkeleton } from "./shared";

const encounterTypeIcon: Record<EncounterType, typeof FileText> = { evaluation: FileText, session: Syringe, followup: CalendarDays };
const statusVariant: Record<EncounterStatus, "green" | "blue" | "amber"> = { "Concluído": "green", "Em andamento": "blue", "Com pendência": "amber" };

function RestrictedClinicalNotice({ what }: { what: string }) {
  return <Card className="p-6"><EmptyState title="Área restrita à equipe clínica" description={`${what} é visível apenas para administradores e profissionais.`} /></Card>;
}

function CardTitle({ icon: Icon, title, action }: { icon: typeof Layers3; title: string; action?: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex min-w-0 items-center gap-2 text-sm font-bold"><Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />{title}</h3>{action}</div>;
}

function dateTile(value: string) {
  const date = new Date(value);
  const zone = { timeZone: "America/Sao_Paulo" } as const;
  return { day: new Intl.DateTimeFormat("pt-BR", { day: "2-digit", ...zone }).format(date), month: new Intl.DateTimeFormat("pt-BR", { month: "short", ...zone }).format(date).replace(/\./g, "").toLocaleUpperCase("pt-BR") };
}

export function PatientClinicalSummary({ patientId, onStart, onOpenEncounter, onGoToAppointments, onGoToAnamnesis, onGoToDocuments, onGoToTreatments, onReschedule, observations }: {
  patientId: string;
  onStart: () => void;
  onOpenEncounter: (item: EncounterItem) => void;
  onGoToAppointments: () => void;
  onGoToAnamnesis: () => void;
  onGoToDocuments: () => void;
  onGoToTreatments: () => void;
  onReschedule: (next: { journeyId: string | null; procedure: string; professional: string } | null) => void;
  observations: ReactNode;
}) {
  const canRead = useCan("clinical:read");
  const encounters = useCachedResource<EncountersResponse>(canRead ? encountersKey(patientId) : "");
  const anamnesis = useCachedResource<AnamnesisOverview>(canRead ? anamnesisKey(patientId) : "");
  const items = useMemo(() => sortEncounters(encounters.data?.items ?? []), [encounters.data]);
  const treatment = useMemo(() => activeTreatmentSummary(encounters.data?.journeys ?? [], items), [encounters.data, items]);
  const evolution = useMemo(() => latestEvolution(items), [items]);
  const overview = anamnesis.data && !anamnesis.data.restricted ? anamnesis.data : null;
  const pendings = useMemo(() => clinicalPendings({ anamnesisState: overview ? overview.state : null, draftVersion: overview?.draft?.version ?? null, items }), [overview, items]);

  if (!canRead) return <div className="space-y-4"><RestrictedClinicalNotice what="O resumo clínico" />{observations}</div>;

  if (encounters.error && !encounters.data) {
    return <Card className="space-y-3 p-6 text-center"><p role="alert" className="text-sm font-semibold text-destructive">Não foi possível carregar o resumo clínico.</p><div><Button variant="outline" onClick={encounters.retry}>Tentar novamente</Button></div></Card>;
  }

  const loadingEncounters = encounters.loading && !encounters.data;
  const next = encounters.data?.nextReturn ?? null;
  const nextTile = next ? dateTile(next.date) : null;

  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.9fr)]">
    <div className="min-w-0 space-y-4">
      <Card className="p-4 sm:p-5">
        <CardTitle icon={Layers3} title="Linha do tempo clínica" />
        {loadingEncounters ? <div className="mt-4 space-y-3" aria-busy="true">{[0, 1, 2].map((row) => <LoadingSkeleton className="h-12 w-full" key={row} />)}</div>
          : !items.length ? <div className="mt-4 flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-8 text-center"><span className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary"><Layers3 className="h-6 w-6" aria-hidden="true" /></span><div><p className="text-sm font-bold">Nenhum registro clínico ainda</p><p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">A linha do tempo mostra avaliações, sessões e retornos assim que forem registrados.</p></div><Button onClick={onStart}><Play className="h-4 w-4" />Iniciar atendimento</Button></div>
          : <ol className="mt-4 divide-y divide-border">{items.slice(0, 6).map((item) => {
            const Icon = encounterTypeIcon[item.type];
            return <li key={item.key}><button type="button" className="flex w-full items-center gap-3 py-3 text-left transition hover:bg-muted/40 sm:px-2" onClick={() => onOpenEncounter(item)}>
              <span className="w-24 shrink-0 text-xs"><strong className="block text-foreground">{formatDate(item.occurredAt)}</strong><span className="text-muted-foreground">{formatTime(item.occurredAt)}</span></span>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Icon className="h-4 w-4" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1"><strong className="block truncate text-xs">{item.title}</strong><span className="block truncate text-xs text-muted-foreground">{item.summary || [item.region, item.professional].filter(Boolean).join(" · ") || "Sem resumo registrado."}</span></span>
              <Badge variant={statusVariant[item.status]} className="hidden sm:inline-flex">{item.status}</Badge>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button></li>;
          })}</ol>}
      </Card>

      <Card className="p-4 sm:p-5">
        <CardTitle icon={FileText} title="Evolução clínica" />
        {loadingEncounters ? <LoadingSkeleton className="mt-4 h-16 w-full" /> : evolution ? <div className="mt-4 grid gap-3 rounded-lg bg-primary/5 p-3 sm:grid-cols-[140px_minmax(0,1fr)]"><div className="text-xs"><strong className="block text-foreground">{formatDate(evolution.occurredAt)}</strong><span className="text-muted-foreground">{evolution.professional || "Profissional não informado"}</span></div><p className="whitespace-pre-wrap text-xs leading-5 text-foreground">{evolution.text}</p></div>
          : <p className="mt-4 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">Nenhuma evolução registrada. As observações de sessões e retornos concluídos aparecem aqui.</p>}
      </Card>

      <Card className="p-4 sm:p-5">
        <CardTitle icon={CircleAlert} title="Pendências clínicas" />
        {loadingEncounters || (anamnesis.loading && !anamnesis.data) ? <LoadingSkeleton className="mt-4 h-12 w-full" /> : pendings.length ? <ul className="mt-3 divide-y divide-border">{pendings.map((pending) => <li key={pending.id}><button type="button" className="flex w-full items-center gap-3 py-2.5 text-left transition hover:bg-muted/40 sm:px-2" onClick={() => { if (pending.target === "anamnesis") { onGoToAnamnesis(); return; } const source = items.find((item) => pending.id.startsWith(`${item.key}:`)); if (source) onOpenEncounter(source); }}>
          <span className={cn("h-2 w-2 shrink-0 rounded-full", pending.tone === "required" ? "bg-warning" : "bg-primary/50")} aria-hidden="true" />
          <span className="min-w-0 flex-1"><strong className="block text-xs">{pending.label}</strong><span className="block truncate text-xs text-muted-foreground">{pending.detail}</span></span>
          {pending.tone === "required" ? <Badge variant="amber">Pendente</Badge> : <Badge variant="slate">Sugerido</Badge>}
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button></li>)}</ul> : <p className="mt-4 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">Nenhuma pendência clínica no momento.</p>}
      </Card>

      {observations}
    </div>

    <aside className="space-y-4">
      <Card className="p-4 sm:p-5">
        <CardTitle icon={BarChart3} title="Resumo do tratamento" action={<Button size="sm" variant="outline" onClick={onGoToTreatments}>Ver tratamentos</Button>} />
        {loadingEncounters ? <LoadingSkeleton className="mt-4 h-24 w-full" /> : treatment ? <dl className="mt-4 space-y-2 text-xs">
          {[["Status do plano", <Badge key="s" variant="blue">{treatment.status}</Badge>], ["Tratamento principal", treatment.mainTreatment], ["Região", treatment.region || "Não informada"], ["Profissional responsável", treatment.professional || "Não informado"], ["Início do tratamento", formatDate(treatment.startedAt)]].map(([label, value]) => <div key={String(label)} className="flex items-start justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-semibold">{value}</dd></div>)}
        </dl> : <p className="mt-4 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">Nenhum tratamento em andamento.</p>}
      </Card>

      <Card className="p-4 sm:p-5">
        <CardTitle icon={CalendarDays} title="Próximo retorno" />
        {loadingEncounters ? <LoadingSkeleton className="mt-4 h-20 w-full" /> : next && nextTile ? <div className="mt-4 space-y-3">
          <div className="flex items-center gap-3"><div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-primary/10 text-center text-primary"><span><span className="block text-2xl font-bold leading-none">{nextTile.day}</span><span className="block text-xs font-semibold">{nextTile.month}</span></span></div><div className="min-w-0 text-xs"><strong className="block text-sm capitalize">{formatWeekday(next.date)}, {next.time}</strong><span className="block truncate text-muted-foreground">{next.procedure}</span>{next.professional ? <span className="block truncate text-muted-foreground">{next.professional}</span> : null}</div></div>
          {next.notes ? <p className="line-clamp-2 text-xs text-muted-foreground">{next.notes}</p> : null}
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => onReschedule(next)}>Reagendar retorno<ChevronRight className="h-3.5 w-3.5" /></Button><Button size="sm" variant="ghost" onClick={onGoToAppointments}>Ver agendamentos</Button></div>
        </div> : <div className="mt-4 space-y-3"><p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">Nenhum retorno agendado.</p><Button size="sm" variant="ghost" onClick={onGoToAppointments}>Ver agendamentos</Button></div>}
      </Card>

      <Card className="space-y-3 p-4 sm:p-5">
        <CardTitle icon={ShieldAlert} title="Alertas clínicos" action={<Button size="sm" variant="outline" onClick={onGoToAnamnesis}>Ver anamnese</Button>} />
        {anamnesis.loading && !anamnesis.data ? <LoadingSkeleton className="h-16 w-full" /> : anamnesis.error && !anamnesis.data ? <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">Não foi possível carregar os alertas.</p> : overview ? <>
          {!overview.current && overview.evaluationFallback ? <p className="text-xs text-muted-foreground">Anamnese ainda não preenchida. Mostrando registros da avaliação de {formatDate(overview.evaluationFallback.createdAt)}.</p> : null}
          <ClinicalAlertList alerts={overview.alerts} onOpen={onGoToAnamnesis} emptyText={overview.current ? "Nenhum alerta gerado pelas respostas da anamnese." : "Sem alertas: a anamnese ainda não foi preenchida."} />
          <p className="text-xs leading-4 text-muted-foreground">{alertsDisclaimer}</p>
        </> : null}
      </Card>

      <Card className="p-4 sm:p-5">
        <CardTitle icon={FileText} title="Documentos recentes" action={<Button size="sm" variant="outline" onClick={onGoToDocuments}>Ver todos</Button>} />
        <p className="mt-4 flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground"><MessageSquare className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Nenhum documento clínico anexado a esta cliente.</p>
      </Card>
    </aside>
  </div>;
}
