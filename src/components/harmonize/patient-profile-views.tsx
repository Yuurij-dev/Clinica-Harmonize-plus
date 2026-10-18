"use client";

import { useEffect, useMemo, useState } from "react";
import NextImage from "next/image";
import { BadgeCheck, CalendarDays, Camera, Check, ChevronDown, ChevronRight, CircleAlert, Clock3, CreditCard, FileImage, FileText, HeartPulse, Image as ImageIcon, Layers3, Loader2, PackageCheck, Pencil, Plus, Search, ShieldAlert, Stethoscope, Syringe, Trash2, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CLIENT_CACHE_INVALIDATED_EVENT, getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import type { Patient } from "@/types/clinic";
import { EmptyState, LoadingSkeleton } from "./shared";
import { useCan } from "./current-user";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

export type PatientJourneySummary = {
  id: string;
  name: string;
  procedureNames?: string[];
  status: string;
  createdAt: string;
  hasEvaluation: boolean;
  hasPaidQuote: boolean;
  hasProcedure: boolean;
  hasBeforePhoto: boolean;
  hasAfterPhoto: boolean;
  hasReturn: boolean;
  sessionCount: number;
  latestCompletedSessionId: string | null;
  latestCompletedQuoteId: string | null;
  procedureCount: number;
  photoCount: number;
  professional: string;
  nextAppointment: { date: string; time: string; procedure: string; professional: string; status: string } | null;
  lastActivityAt: string;
};

type SummaryEvent = { kind: string; title: string; detail: string; date: string; status?: string };
type ProfileSummary = { events: SummaryEvent[]; observations: Array<{ id: string; text: string; createdAt: string; kind: string }>; counts: { appointments: number; procedures: number; evaluations: number; quotes: number; payments: number; photos: number } };
type ProcedureSessionPhoto = { id: string; name: string; phase: string; category: string; imageUrl: string };
type ProcedurePhotoRecord = { id?: string; name: string; professional?: string; status?: string; performedAt: string; beforePhoto: string | null; afterPhoto: string | null; photoSessions?: Array<{ id: string; name: string; beforePhoto: string | null; afterPhoto: string | null }>; sessions?: Array<{ id: string; procedureName: string; performedAt: string; photos: ProcedureSessionPhoto[] }> };
type JourneyHistory = { patient?: { appointments?: Array<{ id: string; date: string; time: string; procedure: string; professional: string; status: string }>; payments?: Array<{ id: string; value: number; method: string; status: string; date: string }>; procedureRecords?: ProcedurePhotoRecord[] } };
type JourneyQuote = { id: string; items: string; total: number; status: string; paymentMethod?: string; createdAt: string; updatedAt?: string; approvedAt?: string | null };
type JourneyEvaluation = { id: string; professional: string; status: string; createdAt: string; chiefComplaint: string; patientGoal: string; allergies: string; contraindications: string; previousProcedures: string; clinicalNotes: string; photos?: Array<{ id: string; name: string; imageUrl: string; category: string }> };

const journeyKey = (patientId: string) => `/api/patients/${encodeURIComponent(patientId)}/journeys`;
const summaryKey = (patientId: string) => `/api/patients/${encodeURIComponent(patientId)}/profile`;
const professionalsKey = "/api/team/professionals";
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

function dateLabel(value?: string | null) {
  if (!value) return "Não informado";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Não informado" : dateFormatter.format(date);
}

function statusTone(status: string) {
  if (status === "Concluído") return "green" as const;
  if (status === "Em andamento") return "amber" as const;
  if (status === "Cancelado") return "slate" as const;
  return "purple" as const;
}

export function PatientOverview({ patient, onOpen, onOpenJourney, onNewAppointment }: { patient: Patient; onOpen: (area: string, recordTab?: string) => void; onOpenJourney: (journeyId: string) => void; onNewAppointment: () => void }) {
  const patientId = patient.id ?? "";
  const cachedJourneys = readClientCache<{ journeys?: PatientJourneySummary[] }>(journeyKey(patientId));
  const cachedSummary = readClientCache<ProfileSummary>(summaryKey(patientId));
  const [journeys, setJourneys] = useState(cachedJourneys?.journeys ?? []);
  const [summary, setSummary] = useState<ProfileSummary | null>(cachedSummary ?? null);
  const [loading, setLoading] = useState(!cachedJourneys || !cachedSummary);
  const [error, setError] = useState(false);
  const journey = journeys.filter((item) => item.status === "Em andamento").sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))[0];

  useEffect(() => {
    let active = true;
    Promise.all([getCachedJson<{ journeys?: PatientJourneySummary[] }>(journeyKey(patientId)), getCachedJson<ProfileSummary>(summaryKey(patientId))])
      .then(([journeyData, profile]) => {
        if (!active) return;
        setJourneys(journeyData.journeys ?? []);
        setSummary(profile);
        setError(false);
      })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [patientId]);

  useEffect(() => {
    const prefix = `/api/patients/${encodeURIComponent(patientId)}/`;
    const refresh = (event: Event) => {
      const keys = (event as CustomEvent<string[]>).detail ?? [];
      if (!keys.some((item) => item.startsWith(prefix))) return;
      Promise.all([getCachedJson<{ journeys?: PatientJourneySummary[] }>(journeyKey(patientId)), getCachedJson<ProfileSummary>(summaryKey(patientId))]).then(([nextJourneys, nextSummary]) => { setJourneys(nextJourneys.journeys ?? []); setSummary(nextSummary); }).catch(() => undefined);
    };
    window.addEventListener(CLIENT_CACHE_INVALIDATED_EVENT, refresh);
    return () => window.removeEventListener(CLIENT_CACHE_INVALIDATED_EVENT, refresh);
  }, [patientId]);

  const recentEvents = useMemo(() => summary?.events.slice(0, 6) ?? [], [summary]);
  const pendingEvents = useMemo(() => summary?.events.filter((event) => event.kind === "Material" || (event.kind === "Agendamento" && event.status === "Agendado") || (event.kind === "Orçamento" && ["Pendente", "Aguardando aprovação"].includes(event.status ?? ""))).slice(0, 3) ?? [], [summary]);
  const clinicalAlerts = useMemo(() => summary?.observations.filter((observation) => observation.kind === "clinical").slice(0, 2) ?? [], [summary]);
  const lastVisit = summary?.events.find((event) => event.kind === "Procedimento" || (event.kind === "Agendamento" && ["Atendido", "Finalizado"].includes(event.status ?? "")));
  const steps = journey ? [journey.hasEvaluation, journey.hasPaidQuote, journey.hasProcedure, journey.hasReturn, journey.status === "Concluído"] : [];
  const progress = steps.length ? Math.round((steps.filter(Boolean).length / steps.length) * 100) : 0;

  return <div className="space-y-4">
    {loading && !summary ? <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]"><Card className="space-y-4 p-5"><LoadingSkeleton className="h-5 w-48" /><LoadingSkeleton className="h-20 w-full" /><LoadingSkeleton className="h-10 w-full" /></Card><Card className="space-y-4 p-5"><LoadingSkeleton className="h-5 w-40" /><LoadingSkeleton className="h-36 w-full" /></Card></div> : null}
    {error && !summary ? <Card className="p-6"><EmptyState title="Não foi possível carregar o resumo" description="Tente novamente ao abrir outra área do prontuário." /></Card> : null}
    {summary ? <div className="grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.9fr)]">
      <div className="space-y-4">
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><IconHeading icon={Layers3} title="Tratamento em andamento" />{journey ? <Badge variant={statusTone(journey.status)}>{journey.status}</Badge> : null}</div>
          <h3 className="mt-3 text-lg font-bold text-foreground">{journey?.name ?? "Nenhum tratamento ativo"}</h3>
          {journey ? <>
            <div className="mt-5 grid grid-cols-5 gap-1" aria-label={`Progresso do tratamento: ${progress}%`}>
              {["Avaliação", "Orçamento", "Procedimento", "Pós", "Concluído"].map((step, index) => {
                const done = steps[index];
                const current = !done && index < 4 && (index === 0 || steps[index - 1]);
                return <div className="relative min-w-0 text-center" key={step}>
                  {index < 4 ? <span aria-hidden="true" className={`absolute left-1/2 top-3.5 h-0.5 w-full ${done ? "bg-primary" : "bg-border"}`} /> : null}
                  <span className={`relative mx-auto grid h-7 w-7 place-items-center rounded-full border text-[10px] font-bold ${done ? "border-primary bg-primary text-primary-foreground" : current ? "border-primary bg-background text-primary ring-4 ring-primary/10" : "border-border bg-background text-muted-foreground"}`}>{done ? <Check className="h-3.5 w-3.5" /> : index + 1}</span>
                  <span className={`relative mt-2 block truncate text-[10px] font-medium ${current || done ? "text-foreground" : "text-muted-foreground"}`}>{step}</span>
                </div>;
              })}
            </div>
            <div className="mt-4 grid gap-3 rounded-md bg-muted/50 p-3 text-xs sm:grid-cols-2"><p className="flex items-center gap-2 text-muted-foreground"><UserRound className="h-4 w-4 shrink-0 text-primary" /><span>Responsável: <strong className="text-foreground">{journey.professional || "Não informado"}</strong></span></p><p className="flex items-center gap-2 text-muted-foreground"><CalendarDays className="h-4 w-4 shrink-0 text-primary" /><span>Iniciado em <strong className="text-foreground">{dateLabel(journey.createdAt)}</strong></span></p></div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">{journey.nextAppointment ? <><CalendarDays className="h-4 w-4 shrink-0 text-primary" /><span className="truncate">Próximo retorno: {dateLabel(journey.nextAppointment.date)} · {journey.nextAppointment.time}</span></> : <><Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" /><span>Sem retorno agendado</span></>}</p><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => onOpenJourney(journey.id)}>Abrir jornada <ChevronRight className="h-3.5 w-3.5" /></Button>{journey.nextAppointment ? <Button size="sm" onClick={onNewAppointment}><CalendarDays className="h-4 w-4" />Registrar retorno</Button> : null}</div></div>
          </> : <Button className="mt-4" variant="outline" onClick={() => onOpen("Tratamentos")}><Plus className="h-4 w-4" />Ver tratamentos</Button>}
        </Card>
        <Card className="p-5"><div className="flex items-center justify-between gap-3"><IconHeading icon={CalendarDays} title="Próximas ações" /><Button variant="ghost" size="icon" aria-label="Novo atendimento" title="Novo atendimento" onClick={onNewAppointment}><Plus className="h-4 w-4" /></Button></div><div className="mt-3 space-y-2">{pendingEvents.length ? pendingEvents.map((event, index) => {
          const EventIcon = eventIcon(event.kind);
          const destination = event.kind === "Orçamento" ? "Financeiro" : "Prontuário";
          const recordTab = event.kind === "Material" ? "Procedimentos" : event.kind === "Agendamento" ? "Agendamentos" : undefined;
          return <button className="flex w-full items-center gap-3 rounded-md border border-border px-3 py-2.5 text-left transition hover:bg-muted/50" key={`${event.kind}-${event.date}-${index}`} type="button" onClick={() => onOpen(destination, recordTab)}><EventIcon className="h-4 w-4 shrink-0 text-primary" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{event.title}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{event.detail} · {dateLabel(event.date)}</span></span><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /></button>;
        }) : <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">Nenhuma ação pendente registrada.</p>}</div></Card>
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3"><IconHeading icon={Clock3} title="Atividades recentes" /><Button variant="ghost" size="sm" onClick={() => onOpen("Prontuário", "Histórico")}>Ver histórico <ChevronRight className="h-3.5 w-3.5" /></Button></div>
          {recentEvents.length ? <ol className="mt-4">{recentEvents.map((event, index) => {
            const EventIcon = eventIcon(event.kind);
            return <li className="relative flex gap-3 pb-4 last:pb-0" key={`${event.kind}-${event.date}-${index}`}>
              {index < recentEvents.length - 1 ? <span aria-hidden="true" className="absolute bottom-0 left-[15px] top-8 w-px bg-border" /> : null}
              <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><EventIcon className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1 pt-0.5"><p className="text-xs font-semibold text-foreground">{event.title}</p><p className="mt-1 text-[11px] text-muted-foreground">{event.detail}</p></div><time className="shrink-0 pt-1 text-[10px] text-muted-foreground">{dateLabel(event.date)}</time>
            </li>;
          })}</ol> : <p className="mt-4 text-xs text-muted-foreground">Nenhuma atividade clínica registrada.</p>}
        </Card>
      </div>
      <div className="space-y-4">
        <Card className="p-5"><div className="flex items-center justify-between"><IconHeading icon={UserRound} title="Resumo do paciente" /><Button variant="ghost" size="icon" aria-label="Editar dados do paciente" title="Editar dados do paciente" onClick={() => onOpen("Prontuário")}><Pencil className="h-4 w-4" /></Button></div><div className="mt-4 space-y-3 text-xs"><InfoRow icon={CalendarDays} label="Último atendimento" value={lastVisit ? dateLabel(lastVisit.date) : patient.lastVisit === "Primeiro contato" ? "Não informado" : patient.lastVisit} /><InfoRow icon={UserRound} label="Idade" value={`${patient.age} anos`} /><InfoRow icon={HeartPulse} label="Status" value={patient.status} /><InfoRow icon={Syringe} label="Tratamento ativo" value={journey?.name ?? "Não informado"} /><InfoRow icon={CalendarDays} label="Próximo retorno" value={journey?.nextAppointment ? dateLabel(journey.nextAppointment.date) : "Não informado"} /></div><div className="mt-4 border-t border-border pt-3"><p className="text-[10px] text-muted-foreground">Paciente desde {dateLabel(patient.createdAt)}</p></div></Card>
        <Card className="p-5"><IconHeading icon={ShieldAlert} title="Alertas clínicos" /><div className="mt-4 space-y-2">{clinicalAlerts.length ? clinicalAlerts.map((observation) => <button className="flex w-full items-start gap-3 rounded-md border border-border bg-muted/40 p-3 text-left transition hover:bg-muted/70" key={observation.id} type="button" onClick={() => onOpen("Prontuário", "Observações")}><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><CircleAlert className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-foreground">Observação clínica registrada</span><span className="mt-1 line-clamp-2 block text-[11px] text-muted-foreground">{observation.text}</span></span><ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" /></button>) : <div className="flex items-center gap-3 rounded-md bg-muted/50 p-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><BadgeCheck className="h-4 w-4" /></span><p className="text-xs text-muted-foreground">Nenhum alerta clínico registrado no resumo.</p></div>}</div></Card>
        <Card className="p-5"><IconHeading icon={FileText} title="Anexos rápidos" /><div className="mt-4 grid grid-cols-3 gap-2"><QuickAccess icon={Camera} label={`${summary.counts.photos} fotos`} onClick={() => onOpen("Arquivos e fotos")} /><QuickAccess icon={FileImage} label="Documentos" onClick={() => onOpen("Arquivos e fotos")} /><QuickAccess icon={FileText} label="Termos" onClick={() => onOpen("Arquivos e fotos")} /></div></Card>
      </div>
    </div> : null}
  </div>;
}

function IconHeading({ icon: Icon, title }: { icon: typeof UserRound; title: string }) {
  return <h3 className="flex items-center gap-2 text-sm font-bold text-foreground"><Icon className="h-4 w-4 shrink-0 text-primary" />{title}</h3>;
}

function eventIcon(kind: string) {
  if (kind === "Agendamento") return CalendarDays;
  if (kind === "Pagamento") return CreditCard;
  if (kind === "Material") return PackageCheck;
  if (kind === "Avaliação") return Stethoscope;
  if (kind === "Observação clínica") return ShieldAlert;
  if (kind === "Orçamento") return FileText;
  if (kind.toLocaleLowerCase("pt-BR").includes("foto")) return Camera;
  return Clock3;
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string }) {
  return <p className="flex items-center gap-2 text-muted-foreground"><Icon className="h-4 w-4 text-primary" /><span>{label}</span><strong className="ml-auto text-right text-foreground">{value || "Não informado"}</strong></p>;
}

function QuickAccess({ icon: Icon, label, onClick }: { icon: typeof Camera; label: string; onClick: () => void }) {
  return <button type="button" className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-md border border-border px-2 text-center text-[10px] font-medium text-muted-foreground transition hover:bg-muted" onClick={onClick}><Icon className="h-4 w-4 text-primary" />{label}</button>;
}

export function PatientTreatments({ patient, selectedJourneyId, onSelect, onJourneyLabelChange, onBack, onOpenClinical, onOpenEvaluation, onNewSession, onScheduleReturn, onOpenFollowUp }: { patient: Patient; selectedJourneyId: string | null; onSelect: (journeyId: string | null) => void; onJourneyLabelChange: (label: string) => void; onBack: () => void; onOpenClinical: (tab: string) => void; onOpenEvaluation: (journey: PatientJourneySummary, evaluationId?: string) => void; onNewSession: (journey: PatientJourneySummary) => void; onScheduleReturn: (journey: PatientJourneySummary) => void; onOpenFollowUp: (journey: PatientJourneySummary, sessionId: string) => void }) {
  const key = patient.id ? journeyKey(patient.id) : "";
  const profileKey = patient.id ? summaryKey(patient.id) : "";
  const cached = key ? readClientCache<{ journeys?: PatientJourneySummary[] }>(key) : undefined;
  const cachedSummary = profileKey ? readClientCache<ProfileSummary>(profileKey) : undefined;
  const [journeys, setJourneys] = useState(cached?.journeys ?? []);
  const [summary, setSummary] = useState<ProfileSummary | null>(cachedSummary ?? null);
  const [summaryLoading, setSummaryLoading] = useState(!cachedSummary);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState("Todos");
  const [procedureSearch, setProcedureSearch] = useState("");
  const [expandedJourneyId, setExpandedJourneyId] = useState<string | null>(() => !selectedJourneyId && cached?.journeys?.length === 1 ? cached.journeys[0].id : null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [treatmentToRemove, setTreatmentToRemove] = useState<PatientJourneySummary | null>(null);
  const [newTreatmentOpen, setNewTreatmentOpen] = useState(false);
  const [newTreatmentName, setNewTreatmentName] = useState("");
  const [newTreatmentProfessional, setNewTreatmentProfessional] = useState("");
  const [newTreatmentErrors, setNewTreatmentErrors] = useState<{ name?: string; professional?: string }>({});
  const [newTreatmentError, setNewTreatmentError] = useState("");
  const [newTreatmentAttempt, setNewTreatmentAttempt] = useState(0);
  const [newTreatmentSaving, setNewTreatmentSaving] = useState(false);
  const [professionals, setProfessionals] = useState<Array<{ id: string; name: string }>>(() => readClientCache<{ professionals: Array<{ id: string; name: string }> }>(professionalsKey)?.professionals ?? []);
  const [professionalsLoading, setProfessionalsLoading] = useState(false);
  const [professionalsError, setProfessionalsError] = useState("");
  const [professionalsRetry, setProfessionalsRetry] = useState(0);

  useEffect(() => {
    if (!newTreatmentOpen) return;
    let active = true;
    getCachedJson<{ professionals: Array<{ id: string; name: string }> }>(professionalsKey)
      .then((data) => { if (active) setProfessionals(data.professionals); })
      .catch((reason) => { if (active) setProfessionalsError(reason instanceof Error ? reason.message : "Não foi possível carregar os profissionais."); })
      .finally(() => { if (active) setProfessionalsLoading(false); });
    return () => { active = false; };
  }, [newTreatmentOpen, professionalsRetry]);

  useEffect(() => {
    if (!key) return;
    let active = true;
    getCachedJson<{ journeys?: PatientJourneySummary[] }>(key).then((data) => { if (active) { const next = data.journeys ?? []; setJourneys(next); if (!selectedJourneyId) setExpandedJourneyId(next.length === 1 ? next[0].id : null); } }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [key, selectedJourneyId]);

  useEffect(() => {
    if (!profileKey) return;
    let active = true;
    getCachedJson<ProfileSummary>(profileKey).then((data) => { if (active) setSummary(data); }).catch(() => undefined).finally(() => { if (active) setSummaryLoading(false); });
    return () => { active = false; };
  }, [profileKey]);

  useEffect(() => {
    const refresh = (event: Event) => {
      const keys = (event as CustomEvent<string[]>).detail ?? [];
      if (keys.includes(key)) getCachedJson<{ journeys?: PatientJourneySummary[] }>(key).then((data) => { const next = data.journeys ?? []; setJourneys(next); if (!selectedJourneyId) setExpandedJourneyId(next.length === 1 ? next[0].id : null); });
      if (keys.includes(profileKey)) getCachedJson<ProfileSummary>(profileKey).then(setSummary).catch(() => undefined);
    };
    window.addEventListener(CLIENT_CACHE_INVALIDATED_EVENT, refresh);
    return () => window.removeEventListener(CLIENT_CACHE_INVALIDATED_EVENT, refresh);
  }, [key, profileKey, selectedJourneyId]);

  const selected = journeys.find((journey) => journey.id === selectedJourneyId);
  useEffect(() => {
    const index = journeys.findIndex((journey) => journey.id === selectedJourneyId);
    onJourneyLabelChange(index >= 0 ? `Jornada ${index + 1}` : "Jornada");
  }, [journeys, selectedJourneyId, onJourneyLabelChange]);
  const canWriteClinical = useCan("clinical:write");
  const activeJourneys = journeys.filter((journey) => journey.status !== "Cancelado");
  const normalizedSearch = procedureSearch.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const visibleJourneys = activeJourneys.filter((journey) => {
    const matchesStatus = filter === "Todos" || journey.status === filter;
    const searchValues = [journey.name, ...(journey.procedureNames ?? [])];
    const matchesProcedure = !normalizedSearch || searchValues.some((name) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").includes(normalizedSearch));
    return matchesStatus && matchesProcedure;
  });

  function openNewTreatment() {
    const cachedProfessionals = readClientCache<{ professionals: Array<{ id: string; name: string }> }>(professionalsKey);
    if (cachedProfessionals) setProfessionals(cachedProfessionals.professionals);
    setProfessionalsLoading(true);
    setProfessionalsError("");
    setNewTreatmentName(`Jornada ${journeys.length + 1}`);
    setNewTreatmentProfessional("");
    setNewTreatmentErrors({});
    setNewTreatmentError("");
    setNewTreatmentAttempt(0);
    setNewTreatmentOpen(true);
  }

  async function createTreatment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newTreatmentSaving || !patient.id) return;
    const name = newTreatmentName.trim();
    const errors = {
      ...(!name ? { name: "Informe o nome da jornada." } : name.length > 80 ? { name: "Use até 80 caracteres." } : {}),
      ...(!newTreatmentProfessional ? { professional: "Selecione o profissional responsável." } : {}),
    };
    if (Object.keys(errors).length) {
      setNewTreatmentErrors(errors);
      setNewTreatmentAttempt((attempt) => attempt + 1);
      return;
    }
    setNewTreatmentSaving(true);
    setNewTreatmentErrors({});
    setNewTreatmentError("");
    try {
      const response = await fetch(journeyKey(patient.id), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, professionalId: newTreatmentProfessional }) });
      const result = await response.json().catch(() => ({})) as { journey?: { id: string }; message?: string };
      if (!response.ok || !result.journey) {
        const message = result.message ?? "Não foi possível criar o tratamento.";
        if (/profissional/i.test(message)) setNewTreatmentErrors({ professional: message });
        else if (/nome|jornada/i.test(message)) setNewTreatmentErrors({ name: message });
        else setNewTreatmentError(message);
        setNewTreatmentAttempt((attempt) => attempt + 1);
        return;
      }
      invalidateClientCache(journeyKey(patient.id), profileKey);
      setNewTreatmentOpen(false);
      onSelect(result.journey.id);
    } catch (reason) {
      setNewTreatmentError(reason instanceof Error ? reason.message : "Não foi possível criar o tratamento.");
    } finally { setNewTreatmentSaving(false); }
  }

  async function updateJourney(journey: PatientJourneySummary, action: "complete" | "cancel" | "delete" | "restore"): Promise<boolean> {
    if (!patient.id || busyId) return false;
    setBusyId(journey.id);
    setActionError("");
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(patient.id)}/journeys/${encodeURIComponent(journey.id)}`, action === "delete" ? { method: "DELETE" } : { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "complete" ? { status: "Concluído" } : action === "cancel" ? { status: "Cancelado" } : {}) });
      const data = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(data.message ?? "Não foi possível atualizar o tratamento.");
      invalidateClientCache(key, summaryKey(patient.id), ...(action === "delete" ? [`/api/quotes?patientId=${encodeURIComponent(patient.id)}&journeyId=${encodeURIComponent(journey.id)}`, `/api/quotes?patientId=${encodeURIComponent(patient.id)}&journeyId=`] : []));
      const fresh = await getCachedJson<{ journeys?: PatientJourneySummary[] }>(key);
      const next = fresh.journeys ?? [];
      setJourneys(next);
      if (!selectedJourneyId) setExpandedJourneyId(next.length === 1 ? next[0].id : null);
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Não foi possível atualizar o tratamento.");
      return false;
    } finally { setBusyId(null); }
  }

  async function removeTreatment() {
    if (!treatmentToRemove || busyId) return;
    if (await updateJourney(treatmentToRemove, "delete")) setTreatmentToRemove(null);
  }

  if (loading && !journeys.length) return <Card className="space-y-4 p-5"><LoadingSkeleton className="h-6 w-56" />{[1, 2].map((item) => <LoadingSkeleton className="h-28 w-full" key={item} />)}</Card>;
  if (error && !journeys.length) return <Card className="p-6"><EmptyState title="Não foi possível carregar os tratamentos" description="Verifique sua conexão e tente novamente." /></Card>;

  if (selected) return <JourneyDetail patient={patient} journey={selected} onBack={onBack} onOpenClinical={onOpenClinical} onOpenEvaluation={onOpenEvaluation} onNewSession={onNewSession} onScheduleReturn={onScheduleReturn} onOpenFollowUp={onOpenFollowUp} canWriteClinical={canWriteClinical} busy={busyId === selected.id} actionError={actionError} onComplete={() => void updateJourney(selected, "complete")} onCancel={() => void updateJourney(selected, "cancel")} onRestore={() => void updateJourney(selected, "restore")} />;

  return <><div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-bold">Tratamentos da paciente</h3><p className="mt-1 text-xs text-muted-foreground">Jornadas clínicas, sessões e próximos retornos.</p></div><Button onClick={openNewTreatment}><Plus className="h-4 w-4" />Novo tratamento</Button></div>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.8fr)]">
    <section className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar tratamentos">{["Todos", "Em andamento", "Concluído"].map((item) => <Button key={item} variant={filter === item ? "default" : "outline"} size="sm" aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</Button>)}</div><label className="relative block w-full sm:w-64"><Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input type="search" value={procedureSearch} onChange={(event) => setProcedureSearch(event.target.value)} placeholder="Pesquisar procedimento" aria-label="Pesquisar pelo nome do procedimento" className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-xs outline-none focus:border-primary" /></label></div>
    {actionError ? <p role="alert" className="text-xs text-destructive">{actionError}</p> : null}
    {!visibleJourneys.length ? <Card className="p-6"><EmptyState title={procedureSearch.trim() ? "Nenhum procedimento encontrado" : journeys.length ? "Nenhum tratamento neste filtro" : "Nenhum tratamento cadastrado"} description={procedureSearch.trim() ? "Tente pesquisar por outro nome de procedimento." : journeys.length ? "Selecione outro status para ver jornadas." : "Crie um tratamento para organizar avaliações, orçamentos e atendimentos."} /></Card> : <div className="space-y-3">{visibleJourneys.map((journey) => {
      const expanded = expandedJourneyId === journey.id;
      const stages = [journey.hasEvaluation, journey.hasPaidQuote, journey.hasProcedure, journey.hasReturn];
      const stageLabels = ["Avaliação", "Orçamento", "Procedimento", "Pós-procedimento"];
      return <Card className="overflow-hidden p-0" key={journey.id}>
        <div className="flex items-center gap-3 p-3 sm:p-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><Syringe className="h-5 w-5" /></span>
          <button className="min-w-0 flex-1 text-left" type="button" aria-expanded={expanded} onClick={() => setExpandedJourneyId(expanded ? null : journey.id)}>
            <span className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-bold">{journey.name}</span><Badge variant={statusTone(journey.status)}>{journey.status}</Badge></span>
            <span className="mt-1 block truncate text-[10px] text-muted-foreground">{journey.professional} · Iniciado em {dateLabel(journey.createdAt)}</span>
          </button>
          <ProgressSteps journey={journey} />
          <Button className="hidden sm:inline-flex" size="sm" variant="outline" onClick={() => onSelect(journey.id)}>Abrir jornada <ChevronRight className="h-3.5 w-3.5" /></Button>
          {canWriteClinical && journey.status !== "Cancelado" ? <Button size="icon" variant="ghost" className="text-[#b42318] hover:bg-[#fff1f0] hover:text-[#b42318]" aria-label={`Remover tratamento ${journey.name}`} title="Remover tratamento" disabled={busyId === journey.id} onClick={() => { setActionError(""); setTreatmentToRemove(journey); }}><Trash2 className="h-4 w-4" /></Button> : null}
          <Button size="icon" variant="ghost" aria-label={expanded ? "Recolher tratamento" : "Expandir tratamento"} aria-expanded={expanded} onClick={() => setExpandedJourneyId(expanded ? null : journey.id)}><ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} /></Button>
        </div>
        {expanded ? <div className="border-t border-border px-3 pb-3 sm:px-4 sm:pb-4">
          <div className="grid gap-3 py-3 text-[11px] sm:grid-cols-3">
            <p><span className="text-muted-foreground">Sessões</span><strong className="ml-2">{journey.sessionCount}</strong></p>
            <p><span className="text-muted-foreground">Fotos vinculadas</span><strong className="ml-2">{journey.photoCount}</strong></p>
            <p><span className="text-muted-foreground">Próximo retorno</span><strong className="ml-2">{journey.nextAppointment ? dateLabel(journey.nextAppointment.date) : "Não agendado"}</strong></p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Etapas do tratamento">{stageLabels.map((label, index) => <div className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-2" key={label}><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold ${stages[index] ? "bg-primary text-primary-foreground" : "border border-border bg-background text-muted-foreground"}`}>{stages[index] ? <Check className="h-3.5 w-3.5" /> : index + 1}</span><span className="truncate text-[10px] font-medium">{label}</span></div>)}</div>
          <div className="mt-3 flex justify-end sm:hidden"><Button size="sm" variant="outline" onClick={() => onSelect(journey.id)}>Abrir jornada <ChevronRight className="h-3.5 w-3.5" /></Button></div>
        </div> : null}
      </Card>;
    })}</div>}
    </section>
    <aside className="space-y-4">
      <Card className="p-4"><IconHeading icon={Layers3} title="Resumo de tratamentos" /><div className="mt-3 space-y-3 text-xs"><p className="flex items-center gap-3"><CalendarDays className="h-4 w-4 text-primary" /><strong className="w-5 text-sm">{activeJourneys.length}</strong><span className="text-muted-foreground">tratamentos</span></p><p className="flex items-center gap-3"><Clock3 className="h-4 w-4 text-primary" /><strong className="w-5 text-sm">{activeJourneys.filter((item) => item.status === "Em andamento").length}</strong><span className="text-muted-foreground">em andamento</span></p><p className="flex items-center gap-3"><Check className="h-4 w-4 text-primary" /><strong className="w-5 text-sm">{activeJourneys.filter((item) => item.status === "Concluído").length}</strong><span className="text-muted-foreground">concluídos</span></p><p className="flex items-center gap-3"><Camera className="h-4 w-4 text-primary" /><strong className="w-5 text-sm">{activeJourneys.reduce((total, item) => total + item.photoCount, 0)}</strong><span className="text-muted-foreground">fotos vinculadas</span></p></div></Card>
      <Card className="p-4"><IconHeading icon={Clock3} title="Linha do tempo clínica" />{summaryLoading && !summary ? <div className="mt-3 space-y-3"><LoadingSkeleton className="h-10 w-full" /><LoadingSkeleton className="h-10 w-full" /><LoadingSkeleton className="h-10 w-full" /></div> : summary?.events.length ? <ol className="mt-3 space-y-3">{summary.events.slice(0, 5).map((event, index) => { const EventIcon = eventIcon(event.kind); return <li className="relative flex gap-2.5" key={`${event.kind}-${event.date}-${index}`}><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><EventIcon className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1"><strong className="block text-[11px]">{event.title}</strong><span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">{event.detail}</span><time className="mt-1 block text-[9px] text-muted-foreground">{dateLabel(event.date)}</time></span></li>; })}</ol> : <p className="mt-3 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">Nenhuma atividade clínica registrada.</p>}</Card>
    </aside>
    </div>
  </div><Modal open={newTreatmentOpen} title="Novo tratamento" description="Defina o nome da jornada e quem será responsável pelo acompanhamento." onClose={() => { if (!newTreatmentSaving) setNewTreatmentOpen(false); }} closeOnOverlayClick={!newTreatmentSaving}>
    <form noValidate onSubmit={(event) => void createTreatment(event)} className="space-y-4">
      <label htmlFor="new-treatment-name" className="block text-xs font-medium">Nome da jornada
        <input id="new-treatment-name" key={`journey-name-${newTreatmentAttempt}`} autoFocus maxLength={80} value={newTreatmentName} onChange={(event) => { setNewTreatmentName(event.target.value); setNewTreatmentErrors((current) => ({ ...current, name: undefined })); setNewTreatmentError(""); }} aria-invalid={Boolean(newTreatmentErrors.name)} aria-describedby={newTreatmentErrors.name ? "new-treatment-name-error" : undefined} placeholder="Ex.: Preenchimento labial" className={cn("mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary", newTreatmentErrors.name && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} />
        {newTreatmentErrors.name ? <span id="new-treatment-name-error" role="alert" className="mt-1 block text-[10px] font-medium text-[#b42318] animate-[hp-shake_0.42s_ease-in-out]">{newTreatmentErrors.name}</span> : null}
        <span className="mt-1 block text-[10px] text-muted-foreground">{newTreatmentName.length}/80 caracteres</span>
      </label>
      <label htmlFor="new-treatment-professional" className="block text-xs font-medium">Profissional responsável
        <select id="new-treatment-professional" key={`journey-professional-${newTreatmentAttempt}`} value={newTreatmentProfessional} onChange={(event) => { setNewTreatmentProfessional(event.target.value); setNewTreatmentErrors((current) => ({ ...current, professional: undefined })); setNewTreatmentError(""); }} aria-invalid={Boolean(newTreatmentErrors.professional)} aria-describedby={newTreatmentErrors.professional ? "new-treatment-professional-error" : undefined} disabled={professionalsLoading || !professionals.length} className={cn("mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary disabled:opacity-60", newTreatmentErrors.professional && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")}>
          <option value="">{professionalsLoading ? "Carregando profissionais..." : professionals.length ? "Selecione o profissional" : "Nenhum profissional disponível"}</option>
          {professionals.map((professional) => <option key={professional.id} value={professional.id}>{professional.name}</option>)}
        </select>
        {newTreatmentErrors.professional ? <span id="new-treatment-professional-error" role="alert" className="mt-1 block text-[10px] font-medium text-[#b42318] animate-[hp-shake_0.42s_ease-in-out]">{newTreatmentErrors.professional}</span> : null}
        {!professionalsLoading && !professionals.length ? <span role={professionalsError ? "alert" : undefined} className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">{professionalsError || "Cadastre um administrador ou profissional para continuar."}{professionalsError ? <Button type="button" variant="link" size="sm" className="h-auto p-0 text-[10px]" onClick={() => { setProfessionalsError(""); setProfessionalsLoading(true); setProfessionalsRetry((retry) => retry + 1); }}>Tentar novamente</Button> : null}</span> : null}
      </label>
      {newTreatmentError ? <p key={`journey-error-${newTreatmentAttempt}`} role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive animate-[hp-shake_0.42s_ease-in-out]">{newTreatmentError}</p> : null}
      <div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="outline" disabled={newTreatmentSaving} onClick={() => setNewTreatmentOpen(false)}>Cancelar</Button><Button type="submit" disabled={newTreatmentSaving || professionalsLoading || !professionals.length}>{newTreatmentSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{newTreatmentSaving ? "Criando..." : "Criar tratamento"}</Button></div>
    </form>
  </Modal><Modal open={Boolean(treatmentToRemove)} title="Excluir tratamento permanentemente" description="Esta ação não pode ser desfeita." onClose={() => { if (!busyId) { setTreatmentToRemove(null); setActionError(""); } }} closeOnOverlayClick={!busyId}>
    <div className="space-y-4">
      <p className="text-sm">Tem certeza que deseja excluir <strong>{treatmentToRemove?.name}</strong> do banco de dados?</p>
      <p className="rounded-md border border-[#fecdca] bg-[#fff6f5] px-3 py-2 text-xs text-[#912018]">A jornada, os orçamentos, as sessões e os acompanhamentos vinculados serão apagados permanentemente. Avaliações, procedimentos, pagamentos e agendamentos serão preservados, mas ficarão sem vínculo com esta jornada. Jornadas com orçamento aprovado ou pago não podem ser excluídas.</p>
      {actionError ? <p role="alert" className="text-xs text-destructive">{actionError}</p> : null}
      <div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="outline" disabled={Boolean(busyId)} onClick={() => { setTreatmentToRemove(null); setActionError(""); }}>Manter tratamento</Button><Button type="button" className="bg-[#b42318] hover:bg-[#991b1b]" disabled={Boolean(busyId)} onClick={() => void removeTreatment()}>{busyId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}{busyId ? "Excluindo..." : "Excluir permanentemente"}</Button></div>
    </div>
  </Modal></>;
}

function JourneyDetail({ patient, journey, onBack, onOpenClinical, onOpenEvaluation, onNewSession, onScheduleReturn, onOpenFollowUp, canWriteClinical, busy, actionError, onComplete, onCancel, onRestore }: { patient: Patient; journey: PatientJourneySummary; onBack: () => void; onOpenClinical: (tab: string) => void; onOpenEvaluation: (journey: PatientJourneySummary, evaluationId?: string) => void; onNewSession: (journey: PatientJourneySummary) => void; onScheduleReturn: (journey: PatientJourneySummary) => void; onOpenFollowUp: (journey: PatientJourneySummary, sessionId: string) => void; canWriteClinical: boolean; busy: boolean; actionError: string; onComplete: () => void; onCancel: () => void; onRestore: () => void }) {
  const patientId = patient.id ?? "";
  const historyKey = `/api/patients/${encodeURIComponent(patientId)}/history?tab=Procedimentos&journeyId=${encodeURIComponent(journey.id)}`;
  const paymentKey = `/api/patients/${encodeURIComponent(patientId)}/history?tab=Pagamentos&journeyId=${encodeURIComponent(journey.id)}`;
  const quotesKey = `/api/quotes?patientId=${encodeURIComponent(patientId)}&journeyId=${encodeURIComponent(journey.id)}`;
  const evaluationKey = `/api/patients/${encodeURIComponent(patientId)}/evaluation?journeyId=${encodeURIComponent(journey.id)}&summary=1`;
  const [data, setData] = useState<{ history: JourneyHistory; quotes: JourneyQuote[]; evaluation: JourneyEvaluation | null } | null>(() => {
    const history = readClientCache<JourneyHistory>(historyKey);
    const payments = readClientCache<JourneyHistory>(paymentKey);
    const quotes = readClientCache<{ quotes?: JourneyQuote[] }>(quotesKey);
    const evaluation = readClientCache<{ evaluation?: JourneyEvaluation | null }>(evaluationKey);
    return history && payments && quotes && evaluation ? { history: { patient: { ...history.patient, payments: payments.patient?.payments } }, quotes: quotes.quotes ?? [], evaluation: evaluation.evaluation ?? null } : null;
  });
  const [loading, setLoading] = useState(!data);
  const [loadError, setLoadError] = useState(false);
  const [photoFilter, setPhotoFilter] = useState("Antes");
  const [activeStage, setActiveStage] = useState(() => [journey.hasEvaluation, journey.hasPaidQuote, journey.hasProcedure, journey.hasReturn].findIndex((done) => !done) < 0 ? 3 : [journey.hasEvaluation, journey.hasPaidQuote, journey.hasProcedure, journey.hasReturn].findIndex((done) => !done));
  const [retryCount, setRetryCount] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [name, setName] = useState(journey.name);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");
  const historyData = data?.history.patient;
  const records = historyData?.procedureRecords ?? [];
  const payments = readClientCache<JourneyHistory>(paymentKey)?.patient?.payments ?? historyData?.payments ?? [];
  const quotes = data?.quotes ?? [];
  const procedures = records.flatMap((record) => [
    ...(record.beforePhoto ? [{ id: `${record.id}-before`, src: record.beforePhoto, phase: "Antes", name: record.name, date: record.performedAt }] : []),
    ...(record.afterPhoto ? [{ id: `${record.id}-after`, src: record.afterPhoto, phase: "Depois", name: record.name, date: record.performedAt }] : []),
    ...(record.photoSessions ?? []).flatMap((session) => [
      ...(session.beforePhoto ? [{ id: `${session.id}-before`, src: session.beforePhoto, phase: "Antes", name: `${record.name} · ${session.name}`, date: record.performedAt }] : []),
      ...(session.afterPhoto ? [{ id: `${session.id}-after`, src: session.afterPhoto, phase: "Depois", name: `${record.name} · ${session.name}`, date: record.performedAt }] : []),
    ]),
    ...(record.sessions ?? []).flatMap((session) => session.photos.map((photo) => ({ id: photo.id, src: photo.imageUrl, phase: photo.phase, name: `${record.name} · ${session.procedureName} · ${photo.category}`, date: session.performedAt }))),
  ]);
  const evaluationPhotos = (data?.evaluation?.photos ?? []).map((photo) => ({ id: photo.id, src: photo.imageUrl, phase: "Antes", name: `${photo.category} · ${photo.name}`, date: data?.evaluation?.createdAt ?? journey.createdAt }));
  const allPhotos = [...evaluationPhotos, ...procedures];
  const visiblePhotos = allPhotos.filter((photo) => photoFilter === "Todas" || photo.phase === photoFilter);
  const completedPayments = payments.filter((payment) => ["Pago", "Recebido", "Concluído"].includes(payment.status)).reduce((sum, payment) => sum + (Number(payment.value) || 0), 0);
  const currentQuote = quotes.find((quote) => !["Cancelado", "Recusado"].includes(quote.status));
  const total = Number(currentQuote?.total) || 0;
  const currency = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  useEffect(() => {
    let active = true;
    Promise.all([
      getCachedJson<JourneyHistory>(historyKey),
      getCachedJson<JourneyHistory>(paymentKey),
      getCachedJson<{ quotes?: JourneyQuote[] }>(quotesKey),
      getCachedJson<{ evaluation?: JourneyEvaluation | null }>(evaluationKey),
    ]).then(([history, paymentHistory, quoteData, evaluationData]) => {
      if (!active) return;
      setData({ history: { patient: { ...history.patient, payments: paymentHistory.patient?.payments ?? [] } }, quotes: quoteData.quotes ?? [], evaluation: evaluationData.evaluation ?? null });
      setLoadError(false);
    }).catch(() => { if (active) setLoadError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [historyKey, paymentKey, quotesKey, evaluationKey, retryCount]);

  async function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || editBusy) return;
    setEditBusy(true);
    setEditError("");
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}/journeys`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ journeyId: journey.id, name: name.trim() }) });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? "Não foi possível editar a jornada.");
      invalidateClientCache(journeyKey(patientId), summaryKey(patientId));
      setEditOpen(false);
    } catch (error) { setEditError(error instanceof Error ? error.message : "Não foi possível editar a jornada."); }
    finally { setEditBusy(false); }
  }

  const appointment = journey.nextAppointment;
  const stages = [
    { title: "Avaliação", subtitle: "Queixa, anamnese e fotos iniciais", done: journey.hasEvaluation, icon: HeartPulse, detail: data?.evaluation ? `${data.evaluation.status} · ${data.evaluation.professional} · ${dateLabel(data.evaluation.createdAt)}` : "Avaliação ainda não registrada." },
    { title: "Orçamento", subtitle: "Proposta e condições de pagamento", done: quotes.some((quote) => ["Aprovado", "Pago"].includes(quote.status)), icon: FileText, detail: quotes.length ? `${quotes.length} proposta(s) · ${quotes[0].status} · ${currency(quotes[0].total)}` : "Nenhum orçamento vinculado a este tratamento." },
    { title: "Procedimento", subtitle: "Sessões clínicas realizadas", done: journey.hasProcedure, icon: Syringe, detail: records.length ? records.map((record) => `${record.name} · ${dateLabel(record.performedAt)}`).join("; ") : "Nenhuma sessão registrada." },
    { title: "Pós-procedimento", subtitle: "Acompanhamento e orientações", done: journey.hasReturn, icon: Clock3, detail: appointment ? `Próximo retorno: ${dateLabel(appointment.date)} · ${appointment.status}` : journey.hasProcedure ? "Acompanhamento clínico disponível." : "Acompanhamento será disponibilizado após uma sessão." },
  ];

  if (loading && !data) return <div className="space-y-4"><div className="grid gap-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(280px,0.9fr)]"><div className="space-y-3"><LoadingSkeleton className="h-14 w-full" /><LoadingSkeleton className="h-44 w-full" /><LoadingSkeleton className="h-28 w-full" /></div><div className="space-y-3"><LoadingSkeleton className="h-56 w-full" /><LoadingSkeleton className="h-40 w-full" /></div></div></div>;
  if (loadError && !data) return <Card className="p-6"><EmptyState title="Não foi possível carregar esta jornada" description="Confira sua conexão e tente novamente." /><div className="mt-3 flex justify-center gap-2"><Button variant="outline" onClick={onBack}>Voltar aos tratamentos</Button><Button onClick={() => { setLoading(true); setLoadError(false); setRetryCount((value) => value + 1); }}>Tentar novamente</Button></div></Card>;

  return <div className="space-y-3">
    <Card className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
      <div className="flex min-w-0 items-center gap-3"><span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-primary/10 text-xl font-bold text-primary">{journey.name.slice(0, 1).toLocaleUpperCase("pt-BR")}</span><div className="min-w-0"><p className="truncate text-base font-bold">{journey.name}</p><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground"><span>{patient.name}</span><span>·</span><span>{journey.professional}</span><span>·</span><span>Desde {dateLabel(journey.createdAt)}</span><Badge variant={statusTone(journey.status)}>{journey.status}</Badge></div></div></div>
      <div className="flex flex-wrap gap-2">{canWriteClinical && journey.status === "Em andamento" ? <Button size="sm" variant="outline" onClick={() => { setName(journey.name); setEditError(""); setEditOpen(true); }}><Pencil className="h-4 w-4" />Editar jornada</Button> : null}<Button size="sm" variant="outline" onClick={() => onNewSession(journey)}><FileText className="h-4 w-4" />Nova sessão</Button>{journey.status === "Em andamento" && canWriteClinical ? <><Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>Cancelar tratamento</Button><Button size="sm" onClick={() => setCompleteOpen(true)}><Check className="h-4 w-4" />Finalizar tratamento</Button></> : journey.status === "Cancelado" && canWriteClinical ? <Button size="sm" variant="outline" disabled={busy} onClick={onRestore}>Reativar</Button> : null}</div>
    </Card>
    {actionError || loadError ? <p role="alert" className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">{actionError || "Alguns dados do tratamento não puderam ser atualizados."}</p> : null}
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.8fr)_minmax(280px,0.9fr)]">
      <div className="space-y-3">
        <Card className="overflow-hidden p-0">
          <nav className="grid grid-cols-4 border-b border-border" role="tablist" aria-label="Etapas do tratamento">{stages.map((stage, index) => { const active = activeStage === index; return <button id={`journey-stage-${index}`} key={stage.title} type="button" role="tab" aria-selected={active} onClick={() => { if (index === 0 && canWriteClinical) { onOpenEvaluation(journey, data?.evaluation?.id); return; } setActiveStage(index); }} className={`relative flex min-w-0 flex-col items-center gap-1.5 px-1 py-3 text-center transition hover:bg-muted/50 sm:flex-row sm:justify-center sm:gap-2 sm:px-3 ${active ? "text-primary" : "text-muted-foreground"}`}><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold ${stage.done ? "bg-primary text-primary-foreground" : active ? "border border-primary text-primary" : "bg-muted text-muted-foreground"}`}>{stage.done ? <Check className="h-3.5 w-3.5" /> : index + 1}</span><span className="min-w-0 text-[9px] font-semibold leading-tight sm:text-xs">{stage.title}</span></button>; })}</nav>
          <section className="p-4 sm:p-5" role="tabpanel" aria-labelledby={`journey-stage-${activeStage}`}>
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-2"><Layers3 className="h-5 w-5 text-primary" /><div><h3 className="text-sm font-bold">{stages[activeStage].title}</h3><p className="mt-1 text-[11px] text-muted-foreground">{stages[activeStage].subtitle}</p></div></div><Badge variant={stages[activeStage].done ? "green" : "slate"}>{stages[activeStage].done ? "Registrada" : "Pendente"}</Badge></div>
            <p className="mt-4 rounded-md bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">{stages[activeStage].detail}</p>
            {activeStage === 0 ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{[["Queixa principal", data?.evaluation?.chiefComplaint], ["Objetivo", data?.evaluation?.patientGoal], ["Alergias", data?.evaluation?.allergies], ["Contraindicações", data?.evaluation?.contraindications], ["Procedimentos anteriores", data?.evaluation?.previousProcedures], ["Observações", data?.evaluation?.clinicalNotes]].map(([label, value]) => <div key={label} className="rounded-md border border-border p-3"><p className="text-[10px] font-semibold text-muted-foreground">{label}</p><p className="mt-1 whitespace-pre-wrap text-xs">{value?.trim() || "Não informado"}</p></div>)}</div> : null}
            {activeStage === 1 ? <div className="mt-3 divide-y divide-border rounded-md border border-border">{quotes.length ? quotes.map((quote) => <div className="flex flex-wrap items-center justify-between gap-2 p-3" key={quote.id}><div><p className="text-xs font-semibold">Orçamento · {dateLabel(quote.createdAt)}</p><p className="mt-1 text-[10px] text-muted-foreground">{quote.paymentMethod || "Forma de pagamento não informada"}</p></div><div className="flex items-center gap-3"><strong className="text-xs">{currency(Number(quote.total) || 0)}</strong><Badge variant={statusTone(quote.status)}>{quote.status}</Badge></div></div>) : <p className="p-3 text-xs text-muted-foreground">Nenhum orçamento vinculado a este tratamento.</p>}</div> : null}
            {activeStage === 2 ? <div className="mt-3 divide-y divide-border rounded-md border border-border">{records.length ? records.map((record) => <div className="flex flex-wrap items-center justify-between gap-2 p-3" key={record.id}><div><p className="text-xs font-semibold">{record.name}</p><p className="mt-1 text-[10px] text-muted-foreground">{record.professional || "Profissional não informado"} · {dateLabel(record.performedAt)}</p></div><Badge variant={record.status === "Concluída" ? "green" : "slate"}>{record.status || "Registrada"}</Badge></div>) : <p className="p-3 text-xs text-muted-foreground">Nenhuma sessão registrada.</p>}</div> : null}
            {activeStage === 3 ? <div className="mt-3 rounded-md border border-border p-3">{appointment ? <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-semibold">{appointment.procedure || "Retorno"}</p><p className="mt-1 text-[10px] text-muted-foreground">{dateLabel(appointment.date)} · {appointment.time} · {appointment.professional}</p></div><Badge variant="purple">{appointment.status}</Badge></div> : <p className="text-xs text-muted-foreground">{journey.hasProcedure ? "Ainda não há retorno agendado para esta jornada." : "O acompanhamento ficará disponível após uma sessão."}</p>}</div> : null}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><Button size="sm" variant="outline" onClick={() => onOpenClinical("Histórico")}><Clock3 className="h-4 w-4" />Ver histórico</Button>{activeStage === 1 ? <Button size="sm" onClick={() => onOpenClinical("Financeiro")}><CreditCard className="h-4 w-4" />Abrir orçamento</Button> : null}{activeStage === 2 ? <Button size="sm" onClick={() => onNewSession(journey)}><Syringe className="h-4 w-4" />Nova sessão</Button> : null}{activeStage === 3 ? journey.latestCompletedSessionId ? <Button size="sm" onClick={() => onOpenFollowUp(journey, journey.latestCompletedSessionId!)}><HeartPulse className="h-4 w-4" />Registrar evolução</Button> : journey.hasProcedure ? <Button size="sm" onClick={() => onScheduleReturn(journey)}><CalendarDays className="h-4 w-4" />Agendar retorno</Button> : null : null}</div>
          </section>
        </Card>
        <Card className="p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><IconHeading icon={Clock3} title="Atividades da jornada" /><Button size="sm" variant="ghost" onClick={() => onOpenClinical("Histórico")}>Ver histórico <ChevronRight className="h-3.5 w-3.5" /></Button></div><div className="mt-3 space-y-2">{[...records.map((record) => ({ date: record.performedAt, title: record.name, detail: `Sessão registrada por ${record.professional || "profissional não informado"}`, icon: Syringe })), ...quotes.map((quote) => ({ date: quote.createdAt, title: "Orçamento", detail: `${quote.status} · ${currency(quote.total)}`, icon: FileText })), ...(appointment ? [{ date: appointment.date, title: appointment.procedure || "Retorno agendado", detail: `${appointment.time} · ${appointment.professional}`, icon: CalendarDays }] : [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).map((event, index) => { const Icon = event.icon; return <div className="flex gap-3 border-l border-primary/30 pl-3" key={`${event.title}-${event.date}-${index}`}><Icon className="h-4 w-4 shrink-0 text-primary" /><div className="min-w-0 flex-1"><p className="text-xs font-semibold">{event.title}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{event.detail}</p></div><time className="shrink-0 text-[10px] text-muted-foreground">{dateLabel(event.date)}</time></div>; })}{!records.length && !quotes.length && !appointment ? <p className="py-4 text-center text-xs text-muted-foreground">Nenhuma atividade registrada nesta jornada.</p> : null}</div></Card>
      </div>
      <div className="space-y-3">
        <Card className="p-4"><div className="flex items-center justify-between gap-2"><IconHeading icon={Camera} title="Fotos e anexos" /><span className="text-[10px] text-muted-foreground">{allPhotos.length} fotos</span></div><div className="mt-3 flex flex-wrap gap-1.5">{["Antes", "Depois", ...Array.from(new Set(allPhotos.map((photo) => photo.phase))).filter((phase) => !["Antes", "Depois"].includes(phase)), "Todas"].map((filterOption) => <Button key={filterOption} size="sm" variant={photoFilter === filterOption ? "default" : "outline"} onClick={() => setPhotoFilter(filterOption)}>{filterOption}</Button>)}</div>{visiblePhotos.length ? <div className="mt-3 grid grid-cols-3 gap-2">{visiblePhotos.slice(0, 6).map((photo) => <div className="min-w-0" key={photo.id}><div className="relative aspect-square overflow-hidden rounded-md bg-muted"><NextImage alt={`${photo.name} · ${photo.phase}`} className="object-cover" fill sizes="(max-width: 1024px) 28vw, 12vw" unoptimized src={photo.src} /></div><p className="mt-1 truncate text-[9px] font-medium">{photo.phase}</p><p className="truncate text-[9px] text-muted-foreground">{dateLabel(photo.date)}</p></div>)}</div> : <div className="mt-3 rounded-md border border-dashed border-border px-3 py-6 text-center"><Camera className="mx-auto h-5 w-5 text-muted-foreground" /><p className="mt-2 text-xs font-semibold">Nenhuma foto disponível</p><p className="mt-1 text-[10px] text-muted-foreground">As fotos registradas em sessões aparecerão aqui.</p></div>}<div className="mt-3 border-t border-border pt-3"><Button className="w-full" size="sm" variant="outline" onClick={() => onOpenClinical("Arquivos e fotos")}><ImageIcon className="h-4 w-4" />Abrir arquivos e fotos</Button></div></Card>
        <Card className="p-4"><IconHeading icon={CalendarDays} title="Próximas ações" /><div className="mt-3 space-y-2">{appointment ? <div className="flex items-start gap-2 rounded-md bg-muted/50 p-2.5"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div className="min-w-0 flex-1"><p className="text-[11px] font-semibold">{appointment.procedure || "Retorno"}</p><p className="text-[10px] text-muted-foreground">{dateLabel(appointment.date)} · {appointment.time}</p></div><Badge variant="purple">{appointment.status}</Badge></div> : null}{journey.latestCompletedSessionId ? <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => onOpenFollowUp(journey, journey.latestCompletedSessionId!)}><HeartPulse className="h-4 w-4" />Registrar evolução clínica</Button> : null}{journey.hasProcedure && !appointment ? <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => onScheduleReturn(journey)}><CalendarDays className="h-4 w-4" />Agendar retorno</Button> : null}<Button size="sm" variant="outline" className="w-full justify-start" onClick={() => onOpenClinical("Procedimentos")}><Camera className="h-4 w-4" />Registrar fotos da sessão</Button></div></Card>
        <Card className="p-4"><IconHeading icon={CreditCard} title="Resumo financeiro" /><div className="mt-3 space-y-1.5 text-[11px]"><div className="flex justify-between gap-2"><span className="text-muted-foreground">Orçamentos vinculados</span><strong>{quotes.length}</strong></div><div className="flex justify-between gap-2"><span className="text-muted-foreground">Última proposta</span><strong>{currency(total)}</strong></div><div className="flex justify-between gap-2 text-emerald-700"><span>Pagamentos registrados</span><strong>{currency(completedPayments)}</strong></div></div>{currentQuote ? <p className="mt-2 text-[10px] text-muted-foreground">Última proposta: {currentQuote.status}{currentQuote.paymentMethod ? ` · ${currentQuote.paymentMethod}` : ""}</p> : <p className="mt-2 text-[10px] text-muted-foreground">Nenhum orçamento vinculado a este tratamento.</p>}<Button className="mt-3 w-full" size="sm" variant="outline" onClick={() => onOpenClinical("Financeiro")}><CreditCard className="h-4 w-4" />Abrir financeiro</Button></Card>
      </div>
    </div>
    <Modal open={editOpen} title="Editar jornada" description="Atualize o nome deste tratamento sem alterar seus registros clínicos." onClose={() => setEditOpen(false)}><form className="space-y-4" onSubmit={(event) => void saveName(event)}><label className="block text-xs font-medium">Nome do tratamento<input className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} required /></label>{editError ? <p role="alert" className="text-xs text-destructive">{editError}</p> : null}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button><Button type="submit" disabled={editBusy}>{editBusy ? "Salvando..." : "Salvar alterações"}</Button></div></form></Modal>
    <Modal open={completeOpen} title="Concluir tratamento" description="Esta ação encerra a jornada, mas preserva avaliações, sessões, fotos e histórico do paciente." onClose={() => setCompleteOpen(false)}><div className="space-y-4"><p className="text-sm">Confirma a conclusão de <strong>{journey.name}</strong>?</p>{actionError ? <p role="alert" className="text-xs text-destructive">{actionError}</p> : null}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setCompleteOpen(false)}>Continuar tratamento</Button><Button type="button" disabled={busy} onClick={() => { onComplete(); setCompleteOpen(false); }}>{busy ? "Salvando..." : "Concluir tratamento"}</Button></div></div></Modal>
  </div>;
}

function ProgressSteps({ journey }: { journey: PatientJourneySummary }) {
  const flags = [journey.hasEvaluation, journey.hasPaidQuote, journey.hasProcedure, journey.hasReturn];
  return <div className="hidden items-center gap-1 sm:flex" aria-label="Etapas do tratamento">{flags.map((done, index) => <span key={index} className={`h-1.5 w-6 rounded-full ${done ? "bg-primary" : "bg-muted"}`} />)}</div>;
}

export function PatientFiles({ patientId, selectedJourneyId, onJourneyChange, onOpenEvaluations }: { patientId: string; selectedJourneyId: string | null; onJourneyChange: (id: string) => void; onOpenEvaluations: () => void }) {
  const journeysCached = readClientCache<{ journeys?: PatientJourneySummary[] }>(journeyKey(patientId));
  const [journeys, setJourneys] = useState(journeysCached?.journeys ?? []);
  const [, setError] = useState(false);
  const [loadedPhotos, setLoadedPhotos] = useState<{ key: string; procedures: Array<{ id?: string; name: string; date: string; beforePhoto: string; afterPhoto: string; photoSessions: Array<{ id: string; name: string; beforePhoto: string; afterPhoto: string }>; sessions: Array<{ id: string; procedureName: string; date: string; photos: ProcedureSessionPhoto[] }> }> } | null>(null);
  const [failedPhotoKey, setFailedPhotoKey] = useState("");
  const effectiveJourney = selectedJourneyId ?? "";
  const key = `/api/patients/${encodeURIComponent(patientId)}/history?tab=Procedimentos${effectiveJourney ? `&journeyId=${encodeURIComponent(effectiveJourney)}` : ""}&includeProcedureNames=1`;
  const [category, setCategory] = useState("Fotos de procedimentos");

  useEffect(() => {
    let active = true;
    getCachedJson<{ journeys?: PatientJourneySummary[] }>(journeyKey(patientId)).then((data) => { if (active) setJourneys(data.journeys ?? []); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [patientId]);

  useEffect(() => {
    if (!effectiveJourney) return;
    let active = true;
    getCachedJson<{ patient?: { procedureRecords?: ProcedurePhotoRecord[] } }>(key)
      .then((data) => { if (active) { setLoadedPhotos({ key, procedures: (data.patient?.procedureRecords ?? []).map(mapPhotoProcedure) }); setFailedPhotoKey(""); } })
      .catch(() => { if (active) setFailedPhotoKey(key); });
    return () => { active = false; };
  }, [key, effectiveJourney]);

  useEffect(() => {
    const refresh = (event: Event) => {
      const keys = (event as CustomEvent<string[]>).detail ?? [];
      if (!keys.some((item) => item === journeyKey(patientId) || item.startsWith(`/api/patients/${encodeURIComponent(patientId)}/history`))) return;
      getCachedJson<{ journeys?: PatientJourneySummary[] }>(journeyKey(patientId)).then((data) => setJourneys(data.journeys ?? [])).catch(() => undefined);
      getCachedJson<{ patient?: { procedureRecords?: ProcedurePhotoRecord[] } }>(key).then((data) => setLoadedPhotos({ key, procedures: (data.patient?.procedureRecords ?? []).map(mapPhotoProcedure) })).catch(() => undefined);
    };
    window.addEventListener(CLIENT_CACHE_INVALIDATED_EVENT, refresh);
    return () => window.removeEventListener(CLIENT_CACHE_INVALIDATED_EVENT, refresh);
  }, [key, patientId, effectiveJourney]);

  const cachedPhotos = effectiveJourney ? readClientCache<{ patient?: { procedureRecords?: ProcedurePhotoRecord[] } }>(key) : undefined;
  const visibleProcedures = !effectiveJourney ? [] : loadedPhotos?.key === key ? loadedPhotos.procedures : (cachedPhotos?.patient?.procedureRecords ?? []).map(mapPhotoProcedure);
  const loadingPhotos = Boolean(effectiveJourney && !cachedPhotos && loadedPhotos?.key !== key && failedPhotoKey !== key);
  const photos = visibleProcedures.flatMap((procedure) => [
    ...(procedure.beforePhoto ? [{ id: `${procedure.id}-before`, name: procedure.name, date: procedure.date, category: "Antes", src: procedure.beforePhoto }] : []),
    ...(procedure.afterPhoto ? [{ id: `${procedure.id}-after`, name: procedure.name, date: procedure.date, category: "Depois", src: procedure.afterPhoto }] : []),
    ...procedure.photoSessions.flatMap((session) => [
      ...(session.beforePhoto ? [{ id: `${session.id}-before`, name: `${procedure.name} · ${session.name}`, date: procedure.date, category: "Antes", src: session.beforePhoto }] : []),
      ...(session.afterPhoto ? [{ id: `${session.id}-after`, name: `${procedure.name} · ${session.name}`, date: procedure.date, category: "Depois", src: session.afterPhoto }] : []),
    ]),
    ...procedure.sessions.flatMap((session) => session.photos.map((photo) => ({ id: photo.id, name: `${procedure.name} · ${session.procedureName}`, date: session.date, category: `${photo.phase} · ${photo.category}`, src: photo.imageUrl }))),
  ]);

  return <div className="space-y-4"><div><h3 className="text-base font-bold">Arquivos e fotos</h3><p className="mt-1 text-xs text-muted-foreground">Registros visuais vinculados aos tratamentos do paciente.</p></div>
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2">{["Fotos de procedimentos", "Documentos e termos"].map((item) => <Button key={item} variant={category === item ? "default" : "outline"} size="sm" aria-pressed={category === item} onClick={() => setCategory(item)}>{item === "Fotos de procedimentos" ? <Camera className="h-4 w-4" /> : <FileText className="h-4 w-4" />}{item}</Button>)}</div>{category === "Fotos de procedimentos" && journeys.length ? <select className="h-9 max-w-full rounded-md border border-input bg-background px-3 text-xs" aria-label="Tratamento das fotos" value={effectiveJourney} onChange={(event) => onJourneyChange(event.target.value || "")}>{<option value="">Todos os tratamentos</option>}{journeys.map((journey) => <option key={journey.id} value={journey.id}>{journey.name}</option>)}</select> : null}</div>
    {category === "Documentos e termos" ? <Card className="p-6"><EmptyState title="Nenhum documento disponível" description="Não há documentos ou termos vinculados a este paciente." /></Card> : loadingPhotos ? <Card className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4"><LoadingSkeleton className="aspect-square w-full" /><LoadingSkeleton className="aspect-square w-full" /><LoadingSkeleton className="aspect-square w-full" /><LoadingSkeleton className="aspect-square w-full" /></Card> : failedPhotoKey === key && effectiveJourney ? <Card className="p-6"><EmptyState title="Não foi possível carregar as fotos" description="Tente novamente ao voltar para esta área." /></Card> : photos.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{photos.map((photo) => <Card className="overflow-hidden" key={photo.id}><div className="relative aspect-square bg-muted"><NextImage alt={`${photo.name} · ${photo.category}`} className="object-cover" fill sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw" unoptimized src={photo.src} /></div><div className="p-3"><p className="truncate text-xs font-semibold">{photo.name}</p><p className="mt-1 text-[10px] text-muted-foreground">{photo.category} · {photo.date}</p></div></Card>)}</div> : <Card className="p-6"><EmptyState title="Nenhuma foto neste tratamento" description="As fotografias clínicas registradas aparecerão aqui." /></Card>}
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-md bg-muted text-primary"><ImageIcon className="h-4 w-4" /></span><div><p className="text-xs font-semibold">Avaliações e marcações</p><p className="text-[10px] text-muted-foreground">Acesse as imagens clínicas e suas anotações.</p></div></div><Button variant="outline" size="sm" onClick={onOpenEvaluations}>Abrir avaliações <ChevronRight className="h-3.5 w-3.5" /></Button></Card>
  </div>;
}

function mapPhotoProcedure(item: ProcedurePhotoRecord) {
  return { id: item.id, name: item.name, date: dateLabel(item.performedAt), beforePhoto: item.beforePhoto ?? "", afterPhoto: item.afterPhoto ?? "", photoSessions: (item.photoSessions ?? []).map((session) => ({ id: session.id, name: session.name, beforePhoto: session.beforePhoto ?? "", afterPhoto: session.afterPhoto ?? "" })), sessions: (item.sessions ?? []).map((session) => ({ id: session.id, procedureName: session.procedureName, date: dateLabel(session.performedAt), photos: session.photos ?? [] })) };
}
