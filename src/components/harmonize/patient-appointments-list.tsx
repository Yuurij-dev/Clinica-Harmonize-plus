"use client";

import { useMemo, useState } from "react";
import { CalendarDays, CalendarPlus, CheckCircle2, Clock3, Loader2, Layers3, PencilLine, Search, Syringe, Tag, UserRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  appointmentDateKey, appointmentGroupChips, appointmentGroupCounts, appointmentKind, appointmentPageSizes, appointmentWeekday, defaultAppointmentFilters,
  filterAppointments, paginateAppointments, sortAppointments, type AppointmentFilters, type AppointmentGroupFilter, type AppointmentListItem, type AppointmentSort,
} from "@/lib/appointment-list-rules";
import { cn } from "@/lib/utils";
import { ProcedureImage } from "./procedure-image";
import { PaginationBar } from "./clinical-pagination";
import { FilterSelect } from "./patient-clinical-documents";
import { LoadingSkeleton } from "./shared";

const statusVariant: Record<string, "blue" | "green" | "amber" | "red" | "slate"> = { Agendado: "blue", Atendido: "green", Finalizado: "green", "Em atendimento": "amber", Faltou: "red", Cancelado: "slate" };

const emptyByGroup: Record<AppointmentGroupFilter, string> = {
  upcoming: "Nenhum agendamento futuro.", done: "Nenhum atendimento realizado.", running: "Nenhum atendimento em andamento.",
  missed: "Nenhuma falta registrada.", cancelled: "Nenhum agendamento cancelado.", all: "Nenhum agendamento encontrado.",
};

export type AppointmentStartState = { allowed: boolean; title: string; updating: boolean };

export function PatientAppointmentsList<T extends AppointmentListItem>({ appointments, loading, error, onRetry, journeyNames, canRun, updatingId, startState, materialsPendingIds, onNew, onStart, onFinish, onReschedule, onOpenJourney, onCheckMaterials }: {
  appointments: T[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  journeyNames: Record<string, string>;
  canRun: boolean;
  updatingId: string | null;
  startState: (appointment: T) => AppointmentStartState;
  materialsPendingIds: ReadonlySet<string>;
  onNew: () => void;
  onStart: (appointment: T) => void;
  onFinish: (appointment: T) => void;
  onReschedule: (appointment: T) => void;
  onOpenJourney: (journeyId: string) => void;
  onCheckMaterials: (appointment: T) => void;
}) {
  const [filters, setFilters] = useState<AppointmentFilters>(defaultAppointmentFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(appointmentPageSizes[0]);
  const counts = useMemo(() => appointmentGroupCounts(appointments), [appointments]);
  const visible = useMemo(() => sortAppointments(filterAppointments(appointments, filters), filters.sort), [appointments, filters]);
  const paged = paginateAppointments(visible, page, pageSize);
  const refine = (patch: Partial<AppointmentFilters>) => { setFilters((current) => ({ ...current, ...patch })); setPage(1); };
  const filtered = filters.search.trim() !== "" || filters.from !== "" || filters.to !== "";

  return <Card className="p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><CalendarDays className="h-5 w-5" aria-hidden="true" /></span>
        <div className="min-w-0"><h3 className="text-base font-bold">Agendamentos</h3><p className="mt-0.5 text-xs text-muted-foreground">Horários marcados para este cliente na Agenda.</p></div>
      </div>
      <Button onClick={onNew}><CalendarPlus className="h-4 w-4" />Novo agendamento</Button>
    </div>

    <div className="mt-4 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtrar por situação">
      {appointmentGroupChips.map((chip) => {
        const active = filters.group === chip.id;
        return <button key={chip.id} type="button" aria-pressed={active} onClick={() => refine({ group: chip.id })} className={cn("min-w-26 shrink-0 rounded-lg border p-3 text-left transition hover:border-primary/50", active ? "border-primary bg-primary/5" : "border-border bg-card")}>
          <span className="block text-xs font-medium leading-tight text-muted-foreground">{chip.label}</span>
          <strong className="mt-2 block text-xl text-foreground">{loading || error ? "–" : counts[chip.id]}</strong>
        </button>;
      })}
    </div>

    <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
      <label className="relative col-span-2 lg:col-span-1"><span className="sr-only">Buscar agendamentos</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><input type="search" className="h-11 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-primary" placeholder="Buscar por procedimento ou observação..." value={filters.search} onChange={(event) => refine({ search: event.target.value })} /></label>
      <label className="block rounded-lg border border-input bg-background px-3 py-1.5"><span className="block text-xs text-muted-foreground">De</span><input type="date" className="w-full min-w-0 bg-transparent text-sm font-medium outline-none" value={filters.from} max={filters.to || undefined} onChange={(event) => refine({ from: event.target.value })} /></label>
      <label className="block rounded-lg border border-input bg-background px-3 py-1.5"><span className="block text-xs text-muted-foreground">Até</span><input type="date" className="w-full min-w-0 bg-transparent text-sm font-medium outline-none" value={filters.to} min={filters.from || undefined} onChange={(event) => refine({ to: event.target.value })} /></label>
      <div className="col-span-2 lg:col-span-1"><FilterSelect label="Ordenar por" value={filters.sort} onChange={(value) => refine({ sort: value as AppointmentSort })}><option value="smart">Próximos primeiro</option><option value="recent">Mais recentes</option><option value="oldest">Mais antigos</option></FilterSelect></div>
    </div>

    <div className="mt-4">
      {loading ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">{[0, 1, 2].map((item) => <LoadingSkeleton key={item} className="h-40 w-full" />)}</div>
        : error ? <div className="space-y-3 rounded-lg border border-dashed border-border p-6 text-center"><p role="alert" className="text-sm font-semibold text-destructive">Não foi possível carregar os agendamentos.</p><Button size="sm" variant="outline" onClick={onRetry}>Tentar novamente</Button></div>
          : !appointments.length ? <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-8 text-center"><span className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary"><Layers3 className="h-6 w-6" aria-hidden="true" /></span><div><p className="text-sm font-bold">Nenhum agendamento ainda</p><p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">Quando houver horários marcados para este cliente, eles aparecem aqui.</p></div><Button onClick={onNew}><CalendarPlus className="h-4 w-4" />Novo agendamento</Button></div>
            : !visible.length ? <div className="space-y-3 rounded-lg border border-dashed border-border p-6 text-center"><p className="text-sm font-semibold">{emptyByGroup[filters.group]}</p><p className="text-xs text-muted-foreground">Ajuste a busca ou os filtros para ver outros agendamentos.</p>{filtered || filters.group !== "all" ? <div className="flex flex-wrap justify-center gap-2">{filters.group !== "all" ? <Button size="sm" variant="outline" onClick={() => refine({ group: "all" })}>Ver todos</Button> : null}{filtered ? <Button size="sm" variant="outline" onClick={() => refine({ search: "", from: "", to: "" })}><X className="h-4 w-4" />Limpar filtros</Button> : null}</div> : null}</div>
              : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{paged.items.map((appointment, index) => {
                const dateKey = appointmentDateKey(appointment);
                const weekday = appointmentWeekday(dateKey);
                const journeyName = appointment.journeyId ? journeyNames[appointment.journeyId] : undefined;
                const start = startState(appointment);
                const busy = Boolean(appointment.id) && updatingId === appointment.id;
                return <article key={appointment.id ?? `${dateKey}-${appointment.time}-${index}`} className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><strong className="block text-sm">{appointment.date} · {appointment.time}</strong><span className="block text-xs capitalize text-muted-foreground">{weekday}</span></div>
                    <Badge variant={statusVariant[appointment.status] ?? "slate"} className="shrink-0">{appointment.status}</Badge>
                  </div>
                  <div className="mt-3 flex min-w-0 items-center gap-2"><ProcedureImage name={appointment.procedure} decorative className="h-9 w-9 rounded" /><h4 className="min-w-0 wrap-break-word text-sm font-bold">{appointment.procedure}</h4></div>
                  <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Tag className="h-3 w-3" aria-hidden="true" />{appointmentKind(appointment.procedure)}</span>
                    <span className="inline-flex min-w-0 items-center gap-1"><UserRound className="h-3 w-3 shrink-0" aria-hidden="true" /><span className="truncate">{appointment.professional || "Profissional não informado"}</span></span>
                    {journeyName ? <span className="inline-flex min-w-0 items-center gap-1"><Syringe className="h-3 w-3 shrink-0" aria-hidden="true" /><span className="truncate">{journeyName}</span></span> : null}
                  </p>
                  {appointment.notes ? <p className="mt-2 line-clamp-2 wrap-break-word text-xs text-muted-foreground">{appointment.notes}</p> : null}
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                    {canRun && appointment.status === "Agendado" && appointment.id ? <Button size="sm" disabled={!start.allowed} title={start.title} onClick={() => onStart(appointment)}>{start.updating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock3 className="h-3.5 w-3.5" />}{start.updating ? "Atualizando..." : "Iniciar atendimento"}</Button> : null}
                    {canRun && appointment.status === "Em atendimento" && appointment.id ? <Button size="sm" disabled={busy} onClick={() => onFinish(appointment)}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{busy ? "Atualizando..." : "Finalizar atendimento"}</Button> : null}
                    {canRun && appointment.id && appointment.status === "Atendido" && materialsPendingIds.has(appointment.id) ? <Button size="sm" variant="outline" onClick={() => onCheckMaterials(appointment)}>Conferir materiais</Button> : null}
                    {appointment.status === "Agendado" && appointment.id ? <Button size="sm" variant="outline" onClick={() => onReschedule(appointment)}><PencilLine className="h-3.5 w-3.5" />Reagendar</Button> : null}
                    {appointment.journeyId && journeyName ? <Button size="sm" variant="ghost" onClick={() => onOpenJourney(appointment.journeyId as string)}>Abrir tratamento</Button> : null}
                  </div>
                </article>;
              })}</div>}
    </div>

    {!loading && !error && visible.length > 0 ? <PaginationBar page={paged.page} pageSize={pageSize} total={visible.length} sizes={appointmentPageSizes} noun={["agendamento", "agendamentos"]} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} /> : null}
  </Card>;
}
