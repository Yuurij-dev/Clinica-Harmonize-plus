"use client";

import Image from "next/image";
import { type FormEvent, type ReactNode, type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowLeftRight,
  CalendarPlus,
  CalendarDays,
  CheckCircle2,
  Camera,
  ChevronDown,
  Clock3,
  Columns2,
  CreditCard,
  ChevronRight,
  Eye,
  EyeOff,
  FileText,
  Filter,
  Loader2,
  MapPin,
  MessageSquare,
  Paperclip,
  PencilLine,
  Plus,
  Phone,
  Search,
  Sparkles,
  Syringe,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { CustomerJourneyStage, JourneyStageId, Patient } from "@/types/clinic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MaskedInput } from "@/components/ui/masked-input";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { MaterialCheckModal } from "./material-check-modal";
import { MaterialsUsedList, type MaterialUsed } from "./materials-used";
import { PatientExpenses } from "./patient-expenses";
import { CustomerJourney } from "./customer-journey";
import { PatientEvaluations } from "./patient-evaluations";
import { EmptyState, LoadingSkeleton } from "./shared";
import { CLIENT_CACHE_INVALIDATED_EVENT, getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { FormField, fieldClassName } from "@/components/ui/modal";
import { formatCpf, formatInteger, formatPhone } from "@/lib/input-masks";

const tabs = ["Dados", "Avaliação", "Orçamento", "Procedimentos", "Agendamentos", "Observações", "Histórico", "Pagamentos"];

function historyCacheKey(patientId: string, tab: string) {
  return `/api/patients/${patientId}/history?tab=${encodeURIComponent(tab)}`;
}

type PatientProcedureRecord = {
  id?: string;
  name: string;
  date: string;
  professional: string;
  status: string;
  beforePhoto: string;
  afterPhoto: string;
  photoSessions: PatientPhotoSession[];
  notes?: string;
  quoteDate?: string;
};

type PatientPhotoSession = {
  id: string;
  name: string;
  beforePhoto: string;
  afterPhoto: string;
};

type PatientAppointmentRecord = {
  id?: string;
  date: string;
  time: string;
  procedure: string;
  professional: string;
  status: string;
  notes?: string;
  materialsCheck?: string | null;
};

type PatientPaymentRecord = {
  id?: string;
  procedure: string;
  value: string;
  method: string;
  status: string;
  disabled?: boolean;
  disabledReason?: string;
};

type PatientHistoryRecord = {
  procedures: PatientProcedureRecord[];
  appointments: PatientAppointmentRecord[];
  appointmentToleranceMinutes?: number;
  observations: string[];
  payments: PatientPaymentRecord[];
  materialsUsed: MaterialUsed[];
};

type HistoryEventKind = "procedure" | "appointment" | "payment" | "observation";
type HistoryTimelineEvent = {
  key: string;
  kind: HistoryEventKind;
  date?: string;
  title: string;
  subtitle: string;
  status: string;
  details: string;
  procedure?: PatientProcedureRecord;
};


type PinnedJourney = { key: string; title: string; stages: CustomerJourneyStage[] };

type EvaluationSummary = { id: string; professional: string; createdAt: string };

type ReturnAppointmentTarget = Pick<PatientProcedureRecord, "name" | "professional"> & { kind?: "return" | "procedure" };

export function PatientDetail({
  patient,
  journey,
  onBack,
}: {
  patient: Patient;
  journey: CustomerJourneyStage[];
  onBack: () => void;
}) {
  const [currentPatient, setCurrentPatient] = useState(patient);
  const initialTab = journeyStageToTab(patient.currentStage ?? journey.find((stage) => stage.status === "current")?.id);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [tabShake, setTabShake] = useState<string | null>(null);
  const [history, setHistory] = useState<PatientHistoryRecord | undefined>(() => {
    const cached = patient.id && shouldLoadPatientHistory(initialTab) ? readClientCache<PatientHistoryResponse>(historyCacheKey(patient.id, initialTab)) : undefined;
    return cached ? mapPatientHistory(cached).history : undefined;
  });
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(Boolean(patient.id && shouldLoadPatientHistory(initialTab) && !readClientCache(historyCacheKey(patient.id, initialTab))));
  const [returnAppointmentTarget, setReturnAppointmentTarget] = useState<ReturnAppointmentTarget | null>(null);
  const [quoteCompleted, setQuoteCompleted] = useState(false);
  // Apenas uma linha do tempo de procedimento fica exibida no topo por vez.
  const [pinnedJourney, setPinnedJourney] = useState<PinnedJourney | null>(null);
  const [pinnedRefreshKey, setPinnedRefreshKey] = useState(0);
  const pinnedJourneyKey = pinnedJourney?.key;
  const initials = currentPatient.name.split(" ").map((part) => part[0]).slice(0, 2).join("");
  useEffect(() => {
    if (!patient.id) return;
    let cancelled = false;
    getCachedJson<{ quotes?: Array<{ status: string }> }>(`/api/quotes?patientId=${encodeURIComponent(patient.id)}&journeyId=`)
      .then((data) => { if (!cancelled && data.quotes?.some((quote) => ["Pago", "Aprovado"].includes(quote.status))) setQuoteCompleted(true); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [patient.id]);

  useEffect(() => {
    if (!patient.id) return;
    const patientPrefix = `/api/patients/${patient.id}/`;
    function handleInvalidated(event: Event) {
      const keys = (event as CustomEvent<string[]>).detail ?? [];
      if (keys.some((key) => key.startsWith(patientPrefix) || key === "/api/quotes")) setPinnedRefreshKey((current) => current + 1);
    }
    window.addEventListener(CLIENT_CACHE_INVALIDATED_EVENT, handleInvalidated);
    return () => window.removeEventListener(CLIENT_CACHE_INVALIDATED_EVENT, handleInvalidated);
  }, [patient.id]);

  useEffect(() => {
    if (!patient.id || !pinnedJourneyKey) return;
    let cancelled = false;
    Promise.all([
      getCachedJson<PatientHistoryResponse>(historyCacheKey(patient.id, "Procedimentos")),
      getCachedJson<{ evaluations?: EvaluationSummary[] }>(`/api/patients/${patient.id}/evaluation?list=1`),
    ])
      .then(([historyData, evaluationData]) => {
        if (cancelled) return;
        const { history: latestHistory } = mapPatientHistory(historyData);
        const procedure = latestHistory.procedures.find((item) => procedureKey(item) === pinnedJourneyKey);
        if (!procedure) return;
        const stages = procedureJourneyFromHistory(procedure, latestHistory.appointments, evaluationData.evaluations ?? []);
        setPinnedJourney((current) => current?.key === pinnedJourneyKey ? { ...current, title: `Jornada · ${procedure.name}`, stages } : current);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [patient.id, pinnedJourneyKey, pinnedRefreshKey]);

  function selectTab(tab: string) {
    if (tab === "Procedimentos" && !quoteCompleted) {
      setTabShake(tab);
      window.setTimeout(() => setTabShake(null), 450);
      return;
    }
    if (tab === activeTab) return;
    const cached = patient.id && shouldLoadPatientHistory(tab) ? readClientCache<PatientHistoryResponse>(historyCacheKey(patient.id, tab)) : undefined;
    setHistory(cached ? mapPatientHistory(cached).history : undefined);
    setHistoryLoading(Boolean(patient.id && shouldLoadPatientHistory(tab) && !cached));
    setActiveTab(tab);
  }

  useEffect(() => {
    if (!patient.id || !shouldLoadPatientHistory(activeTab)) return;
    let cancelled = false;
    const historyUrl = historyCacheKey(patient.id, activeTab);
    getCachedJson<PatientHistoryResponse>(historyUrl)
      .then((data) => {
        if (cancelled) return;
        const mapped = mapPatientHistory(data);
        if (activeTab !== "Pagamentos") setQuoteCompleted(mapped.hasPaidQuote);
        setHistory(mapped.history);
      })
      .catch(() => { if (!cancelled) setHistory(undefined); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [patient.id, activeTab, historyRefreshKey]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <button className="flex items-center gap-2 text-[11px] font-bold text-[#696a7c] hover:text-[#5147dc]" onClick={onBack}>
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para clientes
      </button>

      <Card className={cn("grid overflow-hidden p-0", pinnedJourney && "lg:grid-cols-[350px_minmax(0,1fr)]")}>
        <div className={cn("flex items-center gap-4 p-4", pinnedJourney && "border-b border-[#ececf2] lg:border-b-0 lg:border-r")}>
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full border-4 border-[#f2f0ff] bg-[#e8e5ff] text-base font-black text-[#5147dc]">{initials}</div>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-[#242538]">{currentPatient.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[#77788a]">
              <span className="flex items-center gap-1.5"><Phone className="h-3 w-3" />{currentPatient.phone}</span>
              <span>{currentPatient.age} anos</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="green">Cliente ativo</Badge>
              <span className="rounded-full bg-[#f2f3f7] px-2.5 py-1 text-[8px] font-semibold text-[#747587]">Desde 10/09/2026</span>
            </div>
          </div>
        </div>

        {pinnedJourney ? (
          <div className="relative min-w-0 p-4">
            <button className="absolute right-3 top-3 z-10 grid h-7 w-7 place-items-center rounded-full text-[#88899a] transition hover:bg-[#f3f2ff] hover:text-[#5147dc]" type="button" aria-label="Ocultar linha do tempo" title="Ocultar linha do tempo" onClick={() => setPinnedJourney(null)}><X className="h-3.5 w-3.5" /></button>
            <CustomerJourney key={pinnedJourney.key} compact title={pinnedJourney.title} journey={pinnedJourney.stages} onOpenStage={(stageId) => { const tab = stageId === "procedure" ? "Procedimentos" : procedureJourneyTabs[stageId]; if (tab) selectTab(tab); }} />
          </div>
        ) : null}
      </Card>


      <Card className="overflow-x-auto p-0">
        <div className="flex min-w-max px-2">
          {tabs.map((tab) => (
            <button
              className={cn(
                "border-b-2 px-5 py-3 text-[10px] font-semibold transition-colors",
                tabShake === tab && "animate-[hp-shake_0.42s_ease-in-out]",
                activeTab === tab
                  ? "border-[#5147dc] bg-[#faf9ff] text-[#5147dc]"
                  : "border-transparent text-[#77788a] hover:bg-[#faf9ff] hover:text-[#5147dc]",
              )}
              key={tab}
              onClick={() => selectTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
      </Card>

      {activeTab === "Orçamento" ? (
        <PatientExpenses patientId={currentPatient.id ?? ""} onPaid={() => { setQuoteCompleted(true); setHistory(undefined); setHistoryLoading(true); setHistoryRefreshKey((current) => current + 1); }} onPaymentUndone={() => { setQuoteCompleted(false); setHistory(undefined); setHistoryLoading(true); setHistoryRefreshKey((current) => current + 1); }} />
      ) : (
        <PatientTabContent key={`tab-${activeTab}`} patient={currentPatient} activeTab={activeTab} history={history} historyLoading={historyLoading} quoteCompleted={quoteCompleted} returnAppointmentTarget={returnAppointmentTarget} onReturnAppointmentClose={() => setReturnAppointmentTarget(null)} onPatientUpdated={setCurrentPatient} onProcedurePhotoUpdated={(procedureId, photo) => setHistory((current) => current ? { ...current, procedures: current.procedures.map((item) => item.id === procedureId ? { ...item, beforePhoto: photo.beforePhoto ?? "", afterPhoto: photo.afterPhoto ?? "", status: procedurePhotoStatus(photo.beforePhoto, photo.afterPhoto) } : item) } : current)} onOpenTab={selectTab} pinnedJourneyKey={pinnedJourney?.key} onPinJourney={setPinnedJourney} onScheduleReturn={(procedure, kind = "return") => { setReturnAppointmentTarget({ ...procedure, kind }); selectTab("Agendamentos"); }} />
      )}
    </div>
  );
}

function PatientTabContent({ onOpenTab, pinnedJourneyKey, onPinJourney, patient, activeTab, history, historyLoading, quoteCompleted, returnAppointmentTarget, onReturnAppointmentClose, onPatientUpdated, onProcedurePhotoUpdated, onScheduleReturn }: { onOpenTab: (tab: string) => void; pinnedJourneyKey?: string; onPinJourney: (journey: PinnedJourney | null) => void; patient: Patient; activeTab: string; history?: PatientHistoryRecord; historyLoading: boolean; quoteCompleted: boolean; returnAppointmentTarget: ReturnAppointmentTarget | null; onReturnAppointmentClose: () => void; onPatientUpdated: (patient: Patient) => void; onProcedurePhotoUpdated: (procedureId: string, photo: { beforePhoto: string | null; afterPhoto: string | null }) => void; onScheduleReturn: (procedure: ReturnAppointmentTarget, kind?: "return" | "procedure") => void }) {

  if (activeTab === "Avaliação") {
    return patient.id ? <PatientEvaluations patientId={patient.id} patientName={patient.name} /> : <EmptyState title="Cliente ainda não foi salvo" description="Salve o cliente antes de adicionar fotos à avaliação." />;
  }

  if (activeTab === "Histórico") {
    return <HistoryTab patient={patient} history={history} loading={historyLoading} />;
  }

  if (activeTab === "Procedimentos") {
    if (!quoteCompleted && !historyLoading) return <EmptyState title="Procedimento bloqueado" description="Quite o orçamento para liberar o acesso ao procedimento." />;
    return <ProceduresTab patientId={patient.id ?? ""} onOpenTab={onOpenTab} pinnedJourneyKey={pinnedJourneyKey} onPinJourney={onPinJourney} history={history} loading={historyLoading} onProcedurePhotoUpdated={onProcedurePhotoUpdated} onScheduleReturn={onScheduleReturn} />;
  }

  if (activeTab === "Agendamentos") {
    return <AppointmentsTab patientId={patient.id ?? ""} history={history} loading={historyLoading} returnAppointmentTarget={returnAppointmentTarget} onReturnAppointmentClose={onReturnAppointmentClose} onScheduleReturn={onScheduleReturn} />;
  }

  if (activeTab === "Observações") {
    return <ObservationsTab history={history} />;
  }

  if (activeTab === "Pagamentos") {
    return <PaymentsTab history={history} />;
  }

  return <PatientDataTab patient={patient} onUpdated={onPatientUpdated} />;
}

function PatientDataTab({ patient, onUpdated }: { patient: Patient; onUpdated: (patient: Patient) => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());
  const [savedPatient, setSavedPatient] = useState(patient);

  async function savePatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const cpf = String(form.get("cpf") ?? "").trim();
    const phone = String(form.get("phone") ?? "").trim();
    const age = Number(form.get("age"));
    const nextInvalidFields = new Set<string>();
    if (!name) nextInvalidFields.add("name");
    if (cpf && cpf.replace(/\D/g, "").length !== 11) nextInvalidFields.add("cpf");
    if (!phone) nextInvalidFields.add("phone");
    if (!Number.isInteger(age) || age < 0 || age > 130) nextInvalidFields.add("age");
    if (nextInvalidFields.size) {
      setInvalidFields(nextInvalidFields);
      setError(nextInvalidFields.has("cpf") ? "Informe um CPF válido com 11 números." : "Revise os campos destacados antes de salvar.");
      window.setTimeout(() => setInvalidFields(new Set()), 450);
      return;
    }
    setSaving(true);
    setError("");
    const response = await fetch(`/api/patients/${patient.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, cpf, phone, age }) });
    const data = await response.json().catch(() => null) as { patient?: Patient; message?: string } | null;
    setSaving(false);
    if (!response.ok || !data?.patient) {
      setError(data?.message ?? "Não foi possível atualizar os dados.");
      if (response.status === 409 || data?.message?.toLowerCase().includes("cpf")) {
        setInvalidFields(new Set(["cpf"]));
        window.setTimeout(() => setInvalidFields(new Set()), 450);
      }
      return;
    }
    setSavedPatient({ ...savedPatient, ...data.patient });
    onUpdated({ ...savedPatient, ...data.patient });
    setEditing(false);
    invalidateClientCache("/api/patients", `/api/patients/${patient.id}/history`);
  }

  if (editing) return <Card className="p-5"><div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-[#5147dc]" /><h3 className="text-sm font-bold text-[#303144]">Editar dados</h3></div><form className="mt-5 grid gap-4 sm:grid-cols-2" noValidate onSubmit={savePatient}><FormField label="Nome"><input className={cn(fieldClassName, invalidFields.has("name") && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} name="name" defaultValue={savedPatient.name} required /></FormField><FormField label="CPF"><MaskedInput className={cn(fieldClassName, invalidFields.has("cpf") && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} formatter={formatCpf} name="cpf" inputMode="numeric" maxLength={14} placeholder="000.000.000-00" defaultValue={savedPatient.cpf ?? ""} /></FormField><FormField label="Telefone"><MaskedInput className={cn(fieldClassName, invalidFields.has("phone") && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} formatter={formatPhone} name="phone" inputMode="tel" maxLength={15} placeholder="(00) 00000-0000" defaultValue={savedPatient.phone} required /></FormField><FormField label="Idade"><MaskedInput className={cn(fieldClassName, invalidFields.has("age") && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} formatter={(value) => formatInteger(value, 3)} name="age" inputMode="numeric" maxLength={3} defaultValue={String(savedPatient.age)} required /></FormField>{error ? <p className="rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318] sm:col-span-2">{error}</p> : null}<div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" disabled={saving} onClick={() => setEditing(false)}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{saving ? "Salvando..." : "Salvar dados"}</Button></div></form></Card>;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
      <Card className="p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#5147dc]" />
          <h3 className="text-sm font-bold text-[#303144]">Dados</h3>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(true)}><PencilLine className="h-3.5 w-3.5" />Editar</Button>
        </div>
        <p className="mt-2 text-xs leading-5 text-[#858696]">Informações de dados vinculadas ao prontuário de {savedPatient.name}.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <InfoBlock icon={Phone} label="Telefone" value={savedPatient.phone} />
          <InfoBlock icon={FileText} label="CPF" value={savedPatient.cpf || "Não informado"} />
          <InfoBlock icon={CalendarDays} label="Último atendimento" value={savedPatient.lastVisit} />
          <InfoBlock icon={Clock3} label="Próximo retorno" value={savedPatient.nextReturn} />
        </div>
      </Card>
      <Card className="p-5">
        <p className="text-[9px] font-bold uppercase text-[#a0a1af]">Resumo da cliente</p>
        <div className="mt-4 space-y-4 text-xs text-[#555668]">
          <p className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-[#5147dc]" />São Paulo, SP</p>
          <p><strong className="text-[#333447]">Idade:</strong> {savedPatient.age} anos</p>
          <p><strong className="text-[#333447]">Status:</strong> acompanhamento ativo</p>
          <p><strong className="text-[#333447]">Último procedimento:</strong> harmonização facial</p>
        </div>
      </Card>
    </div>
  );
}

function EmptyPatientState({ message }: { message: string }) {
  return (
    <Card className="p-6 text-center">
      <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[#f1f0ff] text-[#5147dc]">
        <FileText className="h-5 w-5" />
      </div>
      <p className="mt-3 text-sm font-bold text-[#303144]">{message}</p>
      <p className="mt-1 text-xs text-[#858696]">Quando houver registros, eles aparecerão automaticamente aqui.</p>
    </Card>
  );
}

function journeyStageToTab(stageId?: JourneyStageId) {
  return {
    lead: "Dados",
    evaluation: "Avaliação",
    quote: "Orçamento",
    procedure: "Procedimentos",
    return: "Agendamentos",
    aftercare: "Observações",
  }[stageId ?? "evaluation"];
}

function shouldLoadPatientHistory(tab: string) {
  return ["Procedimentos", "Agendamentos", "Histórico", "Pagamentos"].includes(tab);
}

function HistoryTab({ patient, history, loading }: { patient: Patient; history?: PatientHistoryRecord; loading: boolean }) {
  const [search, setSearch] = useState("");
  const [eventFilter, setEventFilter] = useState<HistoryEventKind | "all">("all");
  const [periodFilter, setPeriodFilter] = useState<"all" | "30" | "90">("all");
  const [expandedEventKey, setExpandedEventKey] = useState<string | null>(null);
  const [selectedProcedure, setSelectedProcedure] = useState<PatientProcedureRecord | null>(null);
  const [historyNow] = useState(() => Date.now());

  if (loading) return <HistoryTabSkeleton />;

  if (!history || (!history.procedures.length && !history.appointments.length && !history.payments.length && !history.observations.length)) {
    return <EmptyPatientState message={`${patient.name} ainda não possui um histórico.`} />;
  }

  const events = buildHistoryTimeline(history);
  const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
  const cutoff = periodFilter === "all" ? null : new Date(historyNow - Number(periodFilter) * 24 * 60 * 60 * 1000);
  const filteredEvents = events.filter((event) => {
    const matchesKind = eventFilter === "all" || event.kind === eventFilter;
    const searchableText = `${event.title} ${event.subtitle} ${event.details}`.toLocaleLowerCase("pt-BR");
    const matchesSearch = !normalizedSearch || searchableText.includes(normalizedSearch);
    const eventDate = parseHistoryDate(event.date);
    const matchesPeriod = !cutoff || (eventDate && eventDate >= cutoff);
    return matchesKind && matchesSearch && matchesPeriod;
  });

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#5147dc]" />
              <h3 className="text-base font-bold text-[#303144]">Histórico do cliente</h3>
            </div>
            <p className="mt-1 text-xs text-[#858696]">Acompanhe os atendimentos e a evolução da cliente.</p>
          </div>
          <span className="hidden rounded-full bg-[#f1f0ff] px-2.5 py-1 text-[9px] font-bold uppercase text-[#5147dc] sm:inline-flex">Linha do tempo</span>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <HistoryMetric icon={Syringe} label="Procedimentos" value={String(history.procedures.length)} tone="purple" />
          <HistoryMetric icon={CalendarDays} label="Agendamentos" value={String(history.appointments.length)} tone="blue" />
          <HistoryMetric icon={CreditCard} label="Pagamentos" value={String(history.payments.filter((payment) => !payment.disabled).length)} tone="amber" />
          <HistoryMetric icon={MessageSquare} label="Observações" value={String(history.observations.length)} tone="green" />
        </div>

        <div className="mt-5 grid gap-2 lg:grid-cols-[minmax(0,1fr)_190px_180px]">
          <label className="flex h-10 items-center gap-2 rounded-[8px] border border-input bg-white px-3 text-xs text-muted-foreground transition focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
            <Search className="h-4 w-4 shrink-0" />
            <input className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar no histórico" aria-label="Buscar no histórico" />
          </label>
          <label className="relative flex h-10 items-center gap-2 rounded-[8px] border border-input bg-white px-3 text-xs text-foreground transition focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
            <Filter className="h-4 w-4 shrink-0 text-primary" />
            <select className="min-w-0 flex-1 appearance-none bg-transparent pr-5 text-xs outline-none" value={eventFilter} onChange={(event) => setEventFilter(event.target.value as HistoryEventKind | "all")} aria-label="Filtrar eventos">
              <option value="all">Todos os eventos</option>
              <option value="procedure">Procedimentos</option>
              <option value="appointment">Agendamentos</option>
              <option value="payment">Pagamentos</option>
              <option value="observation">Observações</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 h-3.5 w-3.5 text-muted-foreground" />
          </label>
          <label className="relative flex h-10 items-center gap-2 rounded-[8px] border border-input bg-white px-3 text-xs text-foreground transition focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
            <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
            <select className="min-w-0 flex-1 appearance-none bg-transparent pr-5 text-xs outline-none" value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value as "all" | "30" | "90")} aria-label="Filtrar período">
              <option value="all">Todo o período</option>
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 h-3.5 w-3.5 text-muted-foreground" />
          </label>
        </div>
      </Card>

      <div className="space-y-3">
        {filteredEvents.length ? filteredEvents.map((event, index) => (
          <HistoryTimelineEventCard
            event={event}
            key={event.key}
            expanded={expandedEventKey === event.key || (expandedEventKey === null && index === 0 && event.kind === "procedure")}
            onToggle={() => setExpandedEventKey((current) => current === event.key ? null : event.key)}
            onViewProcedure={setSelectedProcedure}
          />
        )) : <EmptyInline text="Nenhum evento encontrado com os filtros selecionados." />}
      </div>

      <MaterialsUsedList items={history.materialsUsed} title="Materiais usados no paciente" />

      {selectedProcedure ? <HistoryProcedureViewer procedure={selectedProcedure} onClose={() => setSelectedProcedure(null)} /> : null}
    </div>
  );
}

function buildHistoryTimeline(history: PatientHistoryRecord): HistoryTimelineEvent[] {
  const procedures: HistoryTimelineEvent[] = history.procedures.map((procedure, index) => ({
    key: `procedure-${procedure.id ?? `${procedure.name}-${procedure.date}`}-${index}`,
    kind: "procedure" as const,
    date: procedure.date,
    title: procedure.name,
    subtitle: `${procedure.date}${procedure.professional ? ` · ${procedure.professional}` : ""}`,
    status: procedure.status,
    details: procedure.notes || "Atendimento registrado no histórico da cliente.",
    procedure,
  }));
  const appointments: HistoryTimelineEvent[] = history.appointments.map((appointment) => ({
    key: `appointment-${appointment.id ?? `${appointment.date}-${appointment.time}-${appointment.procedure}`}`,
    kind: "appointment" as const,
    date: appointment.date,
    title: "Agendamento confirmado",
    subtitle: `${appointment.date} às ${appointment.time} · ${appointment.procedure}${appointment.professional ? ` · ${appointment.professional}` : ""}`,
    status: appointment.status,
    details: appointment.notes || "Agendamento registrado para este atendimento.",
  }));
  const payments: HistoryTimelineEvent[] = history.payments.filter((payment) => !payment.disabled).map((payment, index) => ({
    key: `payment-${payment.id ?? index}`,
    kind: "payment" as const,
    title: payment.procedure,
    subtitle: `${payment.method} · ${payment.value}`,
    status: payment.status,
    details: `Pagamento registrado em ${payment.method}, no valor de ${payment.value}.`,
  }));
  const observations: HistoryTimelineEvent[] = history.observations.map((observation, index) => ({
    key: `observation-${index}`,
    kind: "observation" as const,
    title: "Observação registrada",
    subtitle: "Anotação da equipe",
    status: "Registrada",
    details: observation,
  }));

  return [...procedures, ...appointments, ...payments, ...observations].sort((left, right) => {
    const leftDate = parseHistoryDate(left.date)?.getTime() ?? 0;
    const rightDate = parseHistoryDate(right.date)?.getTime() ?? 0;
    return rightDate - leftDate;
  });
}

function parseHistoryDate(value?: string) {
  if (!value) return null;
  const [day, month, year] = value.split("/").map(Number);
  if (!day || !month || !year) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function HistoryMetric({ icon: Icon, label, value, tone }: { icon: typeof Sparkles; label: string; value: string; tone: "purple" | "blue" | "amber" | "green" }) {
  const tones = {
    purple: "bg-[#f1f0ff] text-[#5147dc]",
    blue: "bg-[#edf5ff] text-[#3c80dc]",
    amber: "bg-[#fff5e7] text-[#c57a11]",
    green: "bg-[#eaf8f0] text-[#269765]",
  };
  return <div className="flex items-center gap-3 rounded-[7px] border border-[#e8e9f2] bg-[#fbfbfd] p-3"><span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-[9px]", tones[tone])}><Icon className="h-5 w-5" /></span><div><p className="text-[10px] text-[#77788a]">{label}</p><strong className="mt-0.5 block text-lg leading-5 text-[#303144]">{value}</strong></div></div>;
}

function HistoryTimelineEventCard({ event, expanded, onToggle, onViewProcedure }: { event: HistoryTimelineEvent; expanded: boolean; onToggle: () => void; onViewProcedure: (procedure: PatientProcedureRecord) => void }) {
  const isProcedure = event.kind === "procedure" && event.procedure;
  const dateParts = formatHistoryDateParts(event.date);
  const statusVariant = event.status === "Realizado" || event.status === "Atendido" || event.status === "Concluído" || event.status === "Pago" ? "green" : event.status === "Em procedimento" ? "amber" : "slate";

  return (
    <div className={cn("relative grid gap-3 sm:grid-cols-[66px_minmax(0,1fr)]", isProcedure && expanded && "") }>
      <div className="hidden pt-4 text-center sm:block"><strong className="block text-sm text-[#303144]">{dateParts.day}</strong><span className="text-[9px] font-bold uppercase text-[#858696]">{dateParts.month}</span></div>
      <Card className={cn("overflow-hidden p-0", isProcedure && expanded && "border-[#b9b2ff] shadow-[0_8px_24px_rgba(81,71,220,0.08)]")}>
        <button className="flex w-full items-start justify-between gap-3 p-4 text-left" type="button" onClick={onToggle} aria-expanded={expanded}>
          <div className="flex min-w-0 items-start gap-3">
            <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full", event.kind === "procedure" ? "bg-[#f1f0ff] text-[#5147dc]" : event.kind === "appointment" ? "bg-[#edf5ff] text-[#3c80dc]" : event.kind === "payment" ? "bg-[#fff5e7] text-[#c57a11]" : "bg-[#eaf8f0] text-[#269765]")}>
              {event.kind === "procedure" ? <Syringe className="h-4 w-4" /> : event.kind === "appointment" ? <CalendarDays className="h-4 w-4" /> : event.kind === "payment" ? <CreditCard className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
            </span>
            <span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><strong className="text-sm text-[#303144]">{event.title}</strong><Badge variant={statusVariant}>{event.status}</Badge></span><span className="mt-1 block text-xs text-[#858696]">{event.subtitle}</span></span>
          </div>
          <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-[#77788a] transition-transform", expanded && "rotate-180 text-[#5147dc]")} />
        </button>
        {expanded ? <div className="border-t border-[#ededf3] px-4 pb-4 pt-3">
          {isProcedure ? <>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-[7px] border border-[#e8e9f2] bg-[#fbfbfd] p-3"><p className="text-xs font-bold text-[#3f4053]">Procedimentos realizados</p><p className="mt-2 text-xs text-[#656678]">{event.title}</p></div>
              <div className="rounded-[7px] border border-[#e8e9f2] bg-[#fbfbfd] p-3"><p className="text-xs font-bold text-[#3f4053]">Observações</p><p className="mt-2 text-xs text-[#656678]">{event.details}</p></div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" onClick={() => onViewProcedure(event.procedure as PatientProcedureRecord)}><Eye className="h-3.5 w-3.5" />Ver procedimento</Button>
              <Button type="button" variant="secondary" size="sm" disabled title="Visualização de anexos em breve"><Paperclip className="h-3.5 w-3.5" />Ver anexos ({getProcedurePhotoSessions(event.procedure as PatientProcedureRecord).length})</Button>
              <div className="ml-auto flex -space-x-1.5">{getProcedurePhotoSessions(event.procedure as PatientProcedureRecord).slice(0, 3).flatMap((session) => [session.beforePhoto, session.afterPhoto]).filter((src) => Boolean(src && src !== "__photo__")).slice(0, 3).map((src, index) => <span className="relative h-8 w-8 overflow-hidden rounded-[5px] border-2 border-white bg-[#f1f2f7]" key={`${src}-${index}`}><Image src={src as string} alt="Miniatura do procedimento" fill className="object-cover" sizes="32px" /></span>)}</div>
            </div>
          </> : <div className="rounded-[7px] border border-[#e8e9f2] bg-[#fbfbfd] p-3 text-xs text-[#656678]">{event.details}</div>}
        </div> : null}
      </Card>
    </div>
  );
}

function formatHistoryDateParts(value?: string) {
  const date = parseHistoryDate(value);
  if (!date) return { day: "--", month: "" };
  return { day: String(date.getDate()).padStart(2, "0"), month: date.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "") };
}

function HistoryProcedureViewer({ procedure, onClose }: { procedure: PatientProcedureRecord; onClose: () => void }) {
  const sessions = getProcedurePhotoSessions(procedure);
  const [activeSessionId, setActiveSessionId] = useState<string>();
  const [viewMode, setViewMode] = useState<"compare" | "sideBySide">("compare");
  const [sliderPosition, setSliderPosition] = useState(50);
  const [animationDirection, setAnimationDirection] = useState<"next" | "previous">("next");
  const [animationKey, setAnimationKey] = useState(0);
  const [expandedPhoto, setExpandedPhoto] = useState<{ label: string; src: string } | null>(null);
  const comparisonRef = useRef<HTMLDivElement>(null);
  const activeIndex = Math.max(0, sessions.findIndex((session) => session.id === activeSessionId));
  const activeSession = sessions[activeIndex] ?? sessions[0];

  function updateSlider(clientX: number) {
    const bounds = comparisonRef.current?.getBoundingClientRect();
    if (!bounds?.width) return;
    setSliderPosition(Math.min(100, Math.max(0, ((clientX - bounds.left) / bounds.width) * 100)));
  }

  function handleSliderPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateSlider(event.clientX);
  }

  function handleSliderPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    updateSlider(event.clientX);
  }

  function changeSession(nextIndex: number) {
    setActiveSessionId(sessions[nextIndex]?.id);
    setSliderPosition(50);
  }

  function changeAngle(direction: "next" | "previous") {
    const nextSessionIndex = direction === "next" ? activeIndex + 1 : activeIndex - 1;
    if (!sessions[nextSessionIndex]) return;
    setAnimationDirection(direction);
    setAnimationKey((current) => current + 1);
    changeSession(nextSessionIndex);
  }

  return <Modal open title={procedure.name} description={`${procedure.date}${procedure.professional ? ` · ${procedure.professional}` : ""}`} onClose={onClose} closeOnOverlayClick={false} overlayContent={<div className="pointer-events-none fixed inset-y-0 z-[1001] flex items-center justify-between" style={{ left: "max(0.5rem, calc(50% - 330px))", right: "max(0.5rem, calc(50% - 330px))" }}><Button className="pointer-events-auto rounded-full bg-white shadow-[0_8px_24px_rgba(37,38,58,0.2)]" type="button" variant="secondary" size="icon" aria-label="Ângulo anterior" disabled={activeIndex === 0} onClick={() => changeAngle("previous")}><ChevronRight className="h-5 w-5 rotate-180" /></Button><Button className="pointer-events-auto rounded-full bg-white shadow-[0_8px_24px_rgba(37,38,58,0.2)]" type="button" variant="secondary" size="icon" aria-label="Próximo ângulo" disabled={activeIndex === sessions.length - 1} onClick={() => changeAngle("next")}><ChevronRight className="h-5 w-5" /></Button></div>}>
    <div key={animationKey} className={cn("space-y-4", animationDirection === "next" ? "hp-history-modal-next" : "hp-history-modal-previous")}>
      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[9px] font-bold uppercase text-[#858696]">Ângulo selecionado</p><p className="mt-1 text-sm font-bold text-[#303144]">{activeSession?.name ?? "Sessão principal"}</p></div><Button type="button" variant="secondary" size="sm" disabled title="Visualização de anexos em breve"><Paperclip className="h-3.5 w-3.5" />Ver anexos</Button></div>
      <div className="flex justify-center"><div className="inline-flex rounded-[7px] border border-[#dddfea] bg-[#fafafd] p-1"><button className={cn("inline-flex h-8 items-center gap-1.5 rounded-[5px] px-3 text-[10px] font-bold", viewMode === "compare" ? "bg-[#5147dc] text-white" : "text-[#77788a] hover:bg-white hover:text-[#5147dc]")} type="button" onClick={() => setViewMode("compare")} aria-pressed={viewMode === "compare"}><ArrowLeftRight className="h-3.5 w-3.5" />Comparar</button><button className={cn("inline-flex h-8 items-center gap-1.5 rounded-[5px] px-3 text-[10px] font-bold", viewMode === "sideBySide" ? "bg-[#5147dc] text-white" : "text-[#77788a] hover:bg-white hover:text-[#5147dc]")} type="button" onClick={() => setViewMode("sideBySide")} aria-pressed={viewMode === "sideBySide"}><Columns2 className="h-3.5 w-3.5" />Lado a lado</button></div></div>
      <div className="relative mx-auto w-full max-w-[420px]">
        <div className="flex min-h-0 justify-center">{viewMode === "compare" ? <BeforeAfterComparison compact beforeSrc={activeSession?.beforePhoto} afterSrc={activeSession?.afterPhoto} beforeLabel={`Antes · ${procedure.date}`} afterLabel={`Depois · ${procedure.date}`} sliderPosition={sliderPosition} comparisonRef={comparisonRef} onPointerDown={handleSliderPointerDown} onPointerMove={handleSliderPointerMove} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onBeforePreview={(src) => setExpandedPhoto({ label: "Antes", src })} onAfterPreview={(src) => setExpandedPhoto({ label: "Depois", src })} /> : <div className="grid w-full max-w-[380px] gap-2 sm:grid-cols-2"><BeforeAfterPhoto label="Antes" overlayLabel={`Antes · ${procedure.date}`} src={activeSession?.beforePhoto} onPreview={(src) => setExpandedPhoto({ label: "Antes", src })} /><BeforeAfterPhoto label="Depois" overlayLabel={`Depois · ${procedure.date}`} src={activeSession?.afterPhoto} onPreview={(src) => setExpandedPhoto({ label: "Depois", src })} /></div>}</div>
      </div>
      <div className="text-center"><p className="text-xs font-bold text-[#303144]">{activeSession?.name ?? "Sessão principal"}</p><p className="mt-0.5 text-[10px] text-[#858696]">Ângulo {activeIndex + 1} de {sessions.length}</p></div>
    </div>
    <Modal open={Boolean(expandedPhoto)} title={`Foto ${expandedPhoto?.label.toLowerCase() ?? "ampliada"}`} description="Visualização ampliada da foto do procedimento." closeOnOverlayClick={false} onClose={() => setExpandedPhoto(null)}>
      {expandedPhoto ? <div className="relative mx-auto h-[min(68vh,560px)] w-full max-w-[360px] overflow-hidden rounded-[7px] bg-[#f7f8fc]"><Image className="object-contain" src={expandedPhoto.src} alt={`Foto ampliada de ${expandedPhoto.label.toLowerCase()}`} fill sizes="(max-width: 640px) 90vw, 360px" /></div> : null}
    </Modal>
  </Modal>;
}

function HistoryTabSkeleton() {
  return (
    <div className="space-y-4" aria-label="Carregando histórico">
      <Card className="self-start p-5">
        <LoadingSkeleton className="h-3 w-20" />
        <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => <LoadingSkeleton className="h-12 w-full rounded-[7px]" key={item} />)}
        </div>
      </Card>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <LoadingSkeleton className="h-4 w-4 rounded-full" />
          <LoadingSkeleton className="h-4 w-36" />
        </div>
        {[0, 1].map((item) => (
          <Card className="space-y-3 p-4" key={item}>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <LoadingSkeleton className="h-4 w-44" />
                <LoadingSkeleton className="h-3 w-56 max-w-full" />
              </div>
              <LoadingSkeleton className="h-6 w-20 rounded-full" />
            </div>
            <LoadingSkeleton className="h-10 w-full" />
          </Card>
        ))}
      </div>
    </div>
  );
}

function ProceduresTab({ patientId, onOpenTab, pinnedJourneyKey, onPinJourney, history, loading, onProcedurePhotoUpdated, onScheduleReturn }: { patientId: string; onOpenTab: (tab: string) => void; pinnedJourneyKey?: string; onPinJourney: (journey: PinnedJourney | null) => void; history?: PatientHistoryRecord; loading: boolean; onProcedurePhotoUpdated: (procedureId: string, photo: { beforePhoto: string | null; afterPhoto: string | null }) => void; onScheduleReturn: (procedure: ReturnAppointmentTarget, kind?: "return" | "procedure") => void }) {
  const [procedures, setProcedures] = useState<PatientProcedureRecord[]>(history?.procedures ?? []);
  const [photoOperations, setPhotoOperations] = useState<Record<string, "upload" | "remove">>({});
  const [deletingPhotoSessionKey, setDeletingPhotoSessionKey] = useState<string>();
  const [appointmentStatuses, setAppointmentStatuses] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [currentTime, setCurrentTime] = useState(() => clinicNowForForm());
  const [schedulePickerKind, setSchedulePickerKind] = useState<"procedure" | "return" | null>(null);
  const [evaluations, setEvaluations] = useState<EvaluationSummary[]>([]);
  const [checkAppointmentId, setCheckAppointmentId] = useState<string | null>(null);

  useEffect(() => {
    if (!patientId) return;
    getCachedJson<{ evaluations?: EvaluationSummary[] }>(`/api/patients/${patientId}/evaluation?list=1`)
      .then((data) => setEvaluations(data.evaluations ?? []))
      .catch(() => setEvaluations([]));
  }, [patientId]);

  const visibleProcedures = history ? (procedures.length ? procedures : history.procedures) : [];
  const hasOpenAppointment = (name: string) => Boolean(history?.appointments.some((appointment) => appointment.procedure === name && ["Agendado", "Em atendimento"].includes(appointment.status)));
  const proceduresToSchedule = visibleProcedures.filter((procedure) => procedure.status !== "Realizado" && !hasOpenAppointment(procedure.name));
  const returnsToSchedule = visibleProcedures.filter((procedure) => procedure.status === "Realizado" && !hasOpenAppointment(`Retorno - ${procedure.name}`));
  const procedureScheduled = visibleProcedures.some((procedure) => procedure.status !== "Realizado") && proceduresToSchedule.length === 0;
  const returnScheduled = visibleProcedures.some((procedure) => procedure.status === "Realizado") && returnsToSchedule.length === 0;
  const pickerProcedures = schedulePickerKind === "return" ? returnsToSchedule : proceduresToSchedule;

  function scheduleFor(kind: "procedure" | "return") {
    const candidates = kind === "return" ? returnsToSchedule : proceduresToSchedule;
    if (candidates.length === 1) onScheduleReturn(candidates[0], kind);
    else if (candidates.length > 1) setSchedulePickerKind(kind);
  }

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(clinicNowForForm()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  async function updateProcedureAppointment(appointment: PatientAppointmentRecord, status: "Em atendimento" | "Atendido") {
    if (!appointment.id) return;
    setError("");
    try {
      const response = await fetch(`/api/appointments/${appointment.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const data = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(data?.message ?? "Não foi possível atualizar o procedimento.");
      setAppointmentStatuses((current) => ({ ...current, [appointment.id as string]: status }));
      invalidateClientCache(`/api/patients/${patientId}/history`, "/api/patients", "/api/appointments", "/api/agenda/bootstrap", "/api/dashboard/bootstrap");
      if (status === "Atendido") setCheckAppointmentId(appointment.id);
    } catch (appointmentError) {
      setError(appointmentError instanceof Error ? appointmentError.message : "Não foi possível atualizar o procedimento.");
    }
  }

  async function updateProcedurePhoto(procedureId: string | undefined, photoType: "beforePhoto" | "afterPhoto", photo: string | null, operation: "upload" | "remove" = "upload", sessionId?: string) {
    if (!procedureId) return;
    const operationKey = `${procedureId}-${photoType}`;
    setPhotoOperations((current) => ({ ...current, [operationKey]: operation }));
    setError("");
    try {
      const response = await fetch(`/api/patients/${patientId}/procedures/${procedureId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoType, photo, ...(sessionId ? { sessionId } : {}) }),
      });
      const data = await response.json() as { procedure?: { beforePhoto: string | null; afterPhoto: string | null }; session?: { id: string; name: string; beforePhoto: string | null; afterPhoto: string | null }; message?: string };
      if (!response.ok || (!data.procedure && !data.session)) throw new Error(data.message ?? "Não foi possível atualizar a foto.");
      if (data.session) {
        setProcedures((current) => (current.length ? current : history?.procedures ?? []).map((item) => item.id === procedureId ? { ...item, photoSessions: item.photoSessions.map((session) => session.id === data.session?.id ? { ...session, beforePhoto: data.session?.beforePhoto ?? "", afterPhoto: data.session?.afterPhoto ?? "" } : session) } : item));
      } else if (data.procedure) {
        setProcedures((current) => (current.length ? current : history?.procedures ?? []).map((item) => item.id === procedureId ? { ...item, beforePhoto: data.procedure?.beforePhoto ?? "", afterPhoto: data.procedure?.afterPhoto ?? "", status: procedurePhotoStatus(data.procedure?.beforePhoto ?? null, data.procedure?.afterPhoto ?? null) } : item));
        onProcedurePhotoUpdated(procedureId, data.procedure);
      }
      invalidateClientCache(`/api/patients/${patientId}/history`, `/api/patients/${patientId}/procedures`, "/api/patients");
    } catch (photoError) {
      setError(photoError instanceof Error ? photoError.message : "Não foi possível atualizar a foto.");
    } finally {
      setPhotoOperations((current) => {
        const next = { ...current };
        delete next[operationKey];
        return next;
      });
    }
  }

  async function saveProcedurePhoto(procedureId: string | undefined, photoType: "beforePhoto" | "afterPhoto", file: File, sessionId?: string) {
    const photo = await readProcedurePhoto(file);
    if (!photo) {
      setError("Selecione uma imagem JPG, PNG ou WEBP válida.");
      return;
    }
    await updateProcedurePhoto(procedureId, photoType, photo, "upload", sessionId);
  }

  async function createPhotoSession(procedureId: string | undefined, name: string) {
    if (!procedureId) return null;
    setError("");
    try {
      const response = await fetch(`/api/patients/${patientId}/procedures/${procedureId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const data = await response.json() as { session?: { id: string; name: string; beforePhoto: string | null; afterPhoto: string | null }; message?: string };
      if (!response.ok || !data.session) throw new Error(data.message ?? "Não foi possível criar a sessão de fotos.");
      const session = { id: data.session.id, name: data.session.name, beforePhoto: data.session.beforePhoto ?? "", afterPhoto: data.session.afterPhoto ?? "" };
      setProcedures((current) => (current.length ? current : history?.procedures ?? []).map((item) => item.id === procedureId ? { ...item, photoSessions: [...item.photoSessions, session] } : item));
      invalidateClientCache(`/api/patients/${patientId}/history`, `/api/patients/${patientId}/procedures`);
      return session;
    } catch (sessionError) {
      setError(sessionError instanceof Error ? sessionError.message : "Não foi possível criar a sessão de fotos.");
      return null;
    }
  }

  async function deletePhotoSession(procedureId: string | undefined, sessionId: string) {
    if (!procedureId) return false;
    const operationKey = `${procedureId}-${sessionId}`;
    setDeletingPhotoSessionKey(operationKey);
    setError("");
    try {
      const response = await fetch(`/api/patients/${patientId}/procedures/${procedureId}?sessionId=${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      const data = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(data?.message ?? "Não foi possível excluir a sessão de fotos.");
      setProcedures((current) => (current.length ? current : history?.procedures ?? []).map((item) => item.id === procedureId ? { ...item, photoSessions: item.photoSessions.filter((session) => session.id !== sessionId) } : item));
      invalidateClientCache(`/api/patients/${patientId}/history`, `/api/patients/${patientId}/procedures`);
      return true;
    } catch (sessionError) {
      setError(sessionError instanceof Error ? sessionError.message : "Não foi possível excluir a sessão de fotos.");
      return false;
    } finally {
      setDeletingPhotoSessionKey(undefined);
    }
  }

  async function renamePhotoSession(procedureId: string | undefined, sessionId: string, name: string) {
    if (!procedureId || !name.trim()) return false;
    setError("");
    try {
      const response = await fetch(`/api/patients/${patientId}/procedures/${procedureId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, name: name.trim() }) });
      const data = await response.json().catch(() => null) as { session?: { id: string; name: string; beforePhoto: string | null; afterPhoto: string | null }; message?: string } | null;
      if (!response.ok || !data?.session) throw new Error(data?.message ?? "Não foi possível renomear a sessão de fotos.");
      setProcedures((current) => (current.length ? current : history?.procedures ?? []).map((item) => item.id === procedureId ? { ...item, photoSessions: item.photoSessions.map((session) => session.id === sessionId ? { ...session, name: data.session?.name ?? name.trim() } : session) } : item));
      invalidateClientCache(`/api/patients/${patientId}/history`, `/api/patients/${patientId}/procedures`);
      return true;
    } catch (sessionError) {
      setError(sessionError instanceof Error ? sessionError.message : "Não foi possível renomear a sessão de fotos.");
      return false;
    }
  }

  function journeyFor(procedure: PatientProcedureRecord) {
    const appointments = (history?.appointments ?? []).map((item) => item.id && appointmentStatuses[item.id] ? { ...item, status: appointmentStatuses[item.id] } : item);
    return procedureJourneyFromHistory(procedure, appointments, evaluations);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4"><div><h3 className="text-sm font-bold text-[#303144]">Procedimentos realizados</h3><p className="mt-1 text-[10px] text-[#858696]">Os procedimentos aparecem aqui automaticamente a partir do orçamento aprovado. Adicione as fotos de antes e depois no atendimento.</p></div><div className="flex flex-wrap justify-end gap-2"><Button className={cn("shrink-0", procedureScheduled && "border-[#b9e8d8] bg-[#eaf8ef] text-[#16805d] hover:border-[#b9e8d8] hover:bg-[#eaf8ef] hover:text-[#16805d]")} type="button" variant="secondary" disabled={!proceduresToSchedule.length} onClick={() => scheduleFor("procedure")}><CalendarPlus className="h-3.5 w-3.5" />{procedureScheduled ? "Procedimento marcado" : "Marcar procedimento"}</Button><Button className={cn("shrink-0", returnScheduled && "border-[#b9e8d8] bg-[#eaf8ef] text-[#16805d] hover:border-[#b9e8d8] hover:bg-[#eaf8ef] hover:text-[#16805d]")} type="button" variant="secondary" disabled={!returnsToSchedule.length} onClick={() => scheduleFor("return")}><CalendarPlus className="h-3.5 w-3.5" />{returnScheduled ? "Retorno marcado" : "Marcar retorno"}</Button></div></div>
      {loading ? <ProcedureCardsSkeleton /> : !visibleProcedures.length ? <EmptyPatientState message="Este cliente ainda não possui procedimentos realizados." /> : <div className="grid gap-4">{visibleProcedures.map((procedure) => {
        const beforeKey = `${procedure.id}-beforePhoto`;
        const afterKey = `${procedure.id}-afterPhoto`;
        const appointment = history?.appointments.find((item) => item.procedure === procedure.name);
        const effectiveStatus = appointment?.id ? appointmentStatuses[appointment.id] ?? appointment.status : undefined;
        const appointmentWithStatus = appointment ? { ...appointment, status: effectiveStatus ?? appointment.status } : undefined;
        const procedureDay = appointmentWithStatus ? appointmentDateValue(appointmentWithStatus) === currentTime.date : false;
        const afterPhotoEnabled = procedure.status === "Realizado" || appointmentWithStatus?.status === "Atendido" || procedureDay;
        const procedureCanStart = appointmentWithStatus?.status === "Agendado" && appointmentCanStart(appointmentWithStatus, history?.appointmentToleranceMinutes ?? 15, currentTime);
        const procedureInProgress = appointmentWithStatus?.status === "Em atendimento";
        const journey = journeyFor(procedure);
        const journeyKey = procedureKey(procedure);
        const journeyPinned = pinnedJourneyKey === journeyKey;
        const procedureMaterials = appointment?.id ? (history?.materialsUsed ?? []).filter((item) => item.appointmentId === appointment.id) : [];
        return <div className="space-y-2" key={procedure.id ?? `${procedure.name}-${procedure.date}`}><ProcedureHistoryCard procedure={procedure} journey={<div className="flex flex-col gap-3 sm:flex-row sm:items-start"><CustomerJourney compact title="Jornada do procedimento" journey={journey} onOpenStage={(stageId) => { const tab = procedureJourneyTabs[stageId]; if (tab) onOpenTab(tab); }} /><Button className={cn("shrink-0", journeyPinned && "border-[#cfcaff] bg-[#f3f2ff] text-[#5147dc]")} size="sm" type="button" variant="secondary" aria-pressed={journeyPinned} onClick={() => onPinJourney(journeyPinned ? null : { key: journeyKey, title: `Jornada · ${procedure.name}`, stages: journey })}>{journeyPinned ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}{journeyPinned ? "Ocultar do topo" : "Exibir linha do tempo"}</Button></div>} editable expandable afterPhotoEnabled={afterPhotoEnabled} afterPhotoMessage={!afterPhotoEnabled ? "Aguardando o dia do procedimento" : undefined} appointment={appointmentWithStatus} canStartProcedure={procedureCanStart} procedureInProgress={procedureInProgress} onProcedureStatusChange={(status) => { if (appointmentWithStatus) void updateProcedureAppointment(appointmentWithStatus, status); }} beforePhotoSaving={Boolean(photoOperations[beforeKey])} afterPhotoSaving={Boolean(photoOperations[afterKey])} beforePhotoOperation={photoOperations[beforeKey]} afterPhotoOperation={photoOperations[afterKey]} onPhotoChange={saveProcedurePhoto} onPhotoRemove={(procedureId, photoType, sessionId) => updateProcedurePhoto(procedureId, photoType, null, "remove", sessionId)} onPhotoSessionCreate={createPhotoSession} onPhotoSessionDelete={deletePhotoSession} onPhotoSessionRename={renamePhotoSession} deletingPhotoSessionKey={deletingPhotoSessionKey} /><MaterialsUsedList items={procedureMaterials} title="Materiais usados neste procedimento" /></div>;
      })}</div>}
      {error ? <p className="rounded-[7px] bg-[#fff1f0] px-3 py-2 text-xs font-semibold text-[#b42318]">{error}</p> : null}
      <Modal open={Boolean(schedulePickerKind)} onClose={() => setSchedulePickerKind(null)} title={schedulePickerKind === "return" ? "Marcar retorno" : "Marcar procedimento"} description={schedulePickerKind === "return" ? "Escolha o procedimento que terá o retorno agendado." : "Escolha qual procedimento você quer marcar."}>
        <div className="space-y-2">
          {pickerProcedures.map((procedure, index) => (
            <button className="hp-pressable flex w-full items-center justify-between gap-3 rounded-[7px] border border-[#e5e5ee] bg-white px-3 py-3 text-left transition hover:border-[#5147dc] hover:bg-[#faf9ff]" key={procedure.id ?? `${procedure.name}-${procedure.date}-${index}`} type="button" onClick={() => { const kind = schedulePickerKind ?? "procedure"; setSchedulePickerKind(null); onScheduleReturn(procedure, kind); }}>
              <span className="min-w-0"><strong className="block truncate text-xs text-[#303144]">{procedure.name}</strong><span className="mt-0.5 block text-[10px] text-[#858696]">{procedure.date}{procedure.professional ? ` · ${procedure.professional}` : ""}</span></span>
              <ChevronRight className="h-4 w-4 shrink-0 text-[#88899a]" />
            </button>
          ))}
          <div className="flex justify-end pt-2"><Button type="button" variant="secondary" onClick={() => setSchedulePickerKind(null)}>Cancelar</Button></div>
        </div>
      </Modal>
      {checkAppointmentId ? <MaterialCheckModal appointmentId={checkAppointmentId} onClose={() => setCheckAppointmentId(null)} onDone={(message) => { setCheckAppointmentId(null); invalidateClientCache(`/api/patients/${patientId}/history`); toast.success(message); }} /> : null}
    </div>
  );
}

function ProcedureCardsSkeleton() {
  return (
    <div className="grid gap-4" aria-label="Carregando procedimentos">
      {[0, 1].map((item) => (
        <Card className="animate-pulse overflow-hidden p-0" key={item}>
          <div className="flex items-start justify-between gap-3 border-b border-[#ededf3] p-4">
            <div className="space-y-2"><div className="hp-skeleton h-4 w-32 rounded" /><div className="hp-skeleton h-3 w-44 rounded" /></div>
            <div className="h-6 w-20 rounded-full bg-[#f0efff]" />
          </div>
          <div className="grid justify-items-center gap-3 p-4 sm:grid-cols-2">
            {[0, 1].map((photo) => <div className="w-full max-w-[280px] overflow-hidden rounded-[7px] border border-[#e7e9f2]" key={photo}><div className="h-7 border-b border-[#e7e9f2] bg-[#fafafd]" /><div className="aspect-[9/16] bg-[#f1f2f7]" /></div>)}
          </div>
        </Card>
      ))}
    </div>
  );
}

async function readProcedurePhoto(value: FormDataEntryValue | null) {
  if (!(value instanceof File) || !value.size) return null;
  if (!["image/jpeg", "image/png", "image/webp"].includes(value.type)) return null;
  const originalUrl = await new Promise<string | null>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null); reader.onerror = () => resolve(null); reader.readAsDataURL(value); });
  if (!originalUrl || value.size <= 500_000) return originalUrl;
  const image = await new Promise<HTMLImageElement | null>((resolve) => { const element = new window.Image(); element.onload = () => resolve(element); element.onerror = () => resolve(null); element.src = originalUrl; });
  if (!image) return originalUrl;
  const scale = Math.min(1, 1600 / image.naturalWidth, 1600 / image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return originalUrl;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

const procedureJourneyTabs: Partial<Record<JourneyStageId, string>> = { evaluation: "Avaliação", quote: "Orçamento", return: "Agendamentos" };

function procedureJourneyStages(procedure: PatientProcedureRecord, appointment: PatientAppointmentRecord | undefined, returnAppointment: PatientAppointmentRecord | undefined, evaluations: EvaluationSummary[]): CustomerJourneyStage[] {
  const quoteDate = procedure.quoteDate ?? ptBrDateToIso(procedure.date);
  // Avaliação mais recente feita até a data do orçamento que gerou o procedimento.
  const evaluation = evaluations
    .filter((item) => !quoteDate || item.createdAt.slice(0, 10) <= quoteDate.slice(0, 10))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const procedureDone = procedure.status === "Realizado" || ["Atendido", "Finalizado"].includes(appointment?.status ?? "");
  const procedureStage: Pick<CustomerJourneyStage, "status" | "date" | "details"> = procedureDone
    ? { status: "completed", date: ptBrDateToIso(appointment?.date ?? procedure.date), details: [] }
    : appointment?.status === "Em atendimento"
      ? { status: "in_progress", date: ptBrDateToIso(appointment.date), details: [] }
      : appointment?.status === "Agendado"
        ? { status: "current", date: ptBrDateToIso(appointment.date), details: [{ label: "Horário", value: appointment.time }] }
        : { status: "current", date: null, details: [{ label: "Agendamento", value: "Aguardando marcação", tone: "warning" }] };
  const returnDone = ["Atendido", "Finalizado"].includes(returnAppointment?.status ?? "");
  const returnScheduled = ["Agendado", "Em atendimento"].includes(returnAppointment?.status ?? "");

  return [
    { id: "evaluation", label: "Avaliação", status: evaluation ? "completed" : "pending", date: evaluation?.createdAt ?? null, details: evaluation?.professional ? [{ label: "Profissional", value: evaluation.professional }] : [] },
    { id: "quote", label: "Orçamento", status: "completed", date: quoteDate ?? null, details: [] },
    { id: "procedure", label: "Procedimento", ...procedureStage },
    { id: "return", label: "Retorno", status: returnDone ? "completed" : returnScheduled || procedureDone ? "current" : "pending", date: returnAppointment && (returnDone || returnScheduled) ? ptBrDateToIso(returnAppointment.date) : null, details: [] },
  ];
}

function ptBrDateToIso(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

type PatientHistoryResponse = { patient?: { appointmentToleranceMinutes?: number; materialsUsed?: MaterialUsed[]; appointments: Array<{ id: string; date: string; time: string; procedure: string; professional: string; status: string; notes: string; materialsCheck?: string | null }>; payments: Array<{ id: string; value: number; method: string; status: string; installments: string }>; quotes: Array<{ id: string; items: string; status: string; createdAt?: string }>; procedureRecords: Array<{ id: string; name: string; professional: string; performedAt: string; notes: string; beforePhoto: string | null; afterPhoto: string | null; photoSessions?: Array<{ id: string; name: string; beforePhoto: string | null; afterPhoto: string | null }> }> } };

function mapPatientHistory(data: PatientHistoryResponse) {
  const appointments = data.patient?.appointments ?? [];
  const payments = data.patient?.payments ?? [];
  const paidQuotes = (data.patient?.quotes ?? []).filter((quote) => ["Pago", "Aprovado"].includes(quote.status));
  const latestQuoteItems = paidQuotes[0]?.items;
  const useQuoteTitle = Boolean(latestQuoteItems && data.patient?.procedureRecords?.length === 1);
  const persistedProcedures = data.patient?.procedureRecords ?? [];
  const quoteDates = new Map((data.patient?.quotes ?? []).map((quote) => [quote.id, quote.createdAt]));
  const procedures = persistedProcedures.length
    ? persistedProcedures.map((item) => ({ id: item.id, name: useQuoteTitle ? latestQuoteItems ?? item.name : item.name, date: new Date(item.performedAt).toLocaleDateString("pt-BR"), professional: item.professional, status: procedurePhotoStatus(item.beforePhoto, item.afterPhoto), beforePhoto: item.beforePhoto ?? "", afterPhoto: item.afterPhoto ?? "", photoSessions: item.photoSessions?.map((session) => ({ id: session.id, name: session.name, beforePhoto: session.beforePhoto ?? "", afterPhoto: session.afterPhoto ?? "" })) ?? [], notes: item.notes.startsWith("__quote:") ? "" : item.notes, quoteDate: item.notes.startsWith("__quote:") ? quoteDates.get(item.notes.slice("__quote:".length)) : undefined }))
    : paidQuotes.map((quote): PatientProcedureRecord => ({ name: quote.items, date: quote.createdAt ? new Date(quote.createdAt).toLocaleDateString("pt-BR") : new Date().toLocaleDateString("pt-BR"), professional: "", status: "Aguardando foto", beforePhoto: "", afterPhoto: "", photoSessions: [], notes: "", quoteDate: quote.createdAt }))
      .concat(appointments.filter((item) => ["Atendido", "Finalizado"].includes(item.status)).map((item) => ({ name: item.procedure, date: new Date(item.date).toLocaleDateString("pt-BR"), professional: item.professional, status: item.status, beforePhoto: "", afterPhoto: "", photoSessions: [], notes: item.notes })));
  const history: PatientHistoryRecord = {
    appointments: appointments.map((item) => ({ id: item.id, date: new Date(item.date).toLocaleDateString("pt-BR"), time: item.time, procedure: item.procedure, professional: item.professional, status: item.status, notes: item.notes, materialsCheck: item.materialsCheck ?? null })),
    appointmentToleranceMinutes: data.patient?.appointmentToleranceMinutes ?? 15,
    procedures,
    payments: payments.map((item) => ({ id: item.id, procedure: "Atendimento", value: new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(item.value), method: item.method, status: item.status, disabled: item.status === "Pago", disabledReason: item.status === "Pago" ? "Pagamento já finalizado" : undefined })),
    observations: [],
    materialsUsed: data.patient?.materialsUsed ?? [],
  };
  const hasPaidQuote = data.patient?.quotes?.some((quote) => ["Pago", "Aprovado"].includes(quote.status)) ?? false;
  return { history, hasPaidQuote };
}

function procedureKey(procedure: PatientProcedureRecord) {
  return procedure.id ?? `${procedure.name}-${procedure.date}`;
}

function procedureJourneyFromHistory(procedure: PatientProcedureRecord, appointments: PatientAppointmentRecord[], evaluations: EvaluationSummary[]) {
  const appointment = appointments.find((item) => item.procedure === procedure.name);
  const returnAppointment = appointments.find((item) => item.procedure === `Retorno - ${procedure.name}`);
  return procedureJourneyStages(procedure, appointment, returnAppointment, evaluations);
}

function procedurePhotoStatus(beforePhoto: string | null, afterPhoto: string | null) {
  if (afterPhoto) return "Realizado";
  if (beforePhoto) return "Em procedimento";
  return "Aguardando foto";
}

function formatAppointmentDisplayDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("pt-BR");
}

function clinicNowForForm() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

function clinicDateAfterDays(days: number) {
  const now = clinicNowForForm();
  const [year, month, day] = now.date.split("-").map(Number);
  const date = new Date(year, month - 1, day + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function appointmentCanStart(appointment: PatientAppointmentRecord, toleranceMinutes: number, now: { date: string; time: string }) {
  const appointmentDate = appointmentDateValue(appointment);
  if (appointmentDate !== now.date) return false;
  const [hours, minutes] = appointment.time.split(":").map(Number);
  const startMinutes = hours * 60 + minutes;
  const nowMinutes = Number(now.time.slice(0, 2)) * 60 + Number(now.time.slice(3));
  return nowMinutes >= startMinutes && nowMinutes < startMinutes + toleranceMinutes;
}

function appointmentDateValue(appointment: PatientAppointmentRecord) {
  const [day, month, year] = appointment.date.split("/");
  return `${year}-${month}-${day}`;
}

function comparePatientAppointments(left: PatientAppointmentRecord, right: PatientAppointmentRecord) {
  const statusPriority = (status: string) => status === "Em atendimento" ? 0 : 1;
  const priorityDifference = statusPriority(left.status) - statusPriority(right.status);
  if (priorityDifference) return priorityDifference;
  return patientAppointmentSortValue(left).localeCompare(patientAppointmentSortValue(right));
}

function patientAppointmentSortValue(appointment: PatientAppointmentRecord) {
  const [day, month, year] = appointment.date.split("/");
  return `${year}-${month}-${day}T${appointment.time}`;
}

function getProcedurePhotoSessions(procedure: PatientProcedureRecord) {
  return [{ id: `legacy-${procedure.id ?? "procedure"}`, name: "Sessão principal", beforePhoto: procedure.beforePhoto, afterPhoto: procedure.afterPhoto }, ...procedure.photoSessions];
}

function ProcedureHistoryCard({ procedure, journey, editable, expandable = false, afterPhotoEnabled = true, afterPhotoMessage, appointment, canStartProcedure, procedureInProgress, onProcedureStatusChange, beforePhotoSaving, afterPhotoSaving, beforePhotoOperation, afterPhotoOperation, onPhotoChange, onPhotoRemove, onPhotoSessionCreate, onPhotoSessionDelete, onPhotoSessionRename, deletingPhotoSessionKey }: {
  journey?: ReactNode; procedure: PatientProcedureRecord; editable?: boolean; expandable?: boolean; afterPhotoEnabled?: boolean; afterPhotoMessage?: string; appointment?: PatientAppointmentRecord; canStartProcedure?: boolean; procedureInProgress?: boolean; onProcedureStatusChange?: (status: "Em atendimento" | "Atendido") => void; beforePhotoSaving?: boolean; afterPhotoSaving?: boolean; beforePhotoOperation?: "upload" | "remove"; afterPhotoOperation?: "upload" | "remove"; onPhotoChange?: (procedureId: string | undefined, photoType: "beforePhoto" | "afterPhoto", file: File, sessionId?: string) => void; onPhotoRemove?: (procedureId: string | undefined, photoType: "beforePhoto" | "afterPhoto", sessionId?: string) => void; onPhotoSessionCreate?: (procedureId: string | undefined, name: string) => Promise<PatientPhotoSession | null>; onPhotoSessionDelete?: (procedureId: string | undefined, sessionId: string) => Promise<boolean>; onPhotoSessionRename?: (procedureId: string | undefined, sessionId: string, name: string) => Promise<boolean>; deletingPhotoSessionKey?: string }) {
  const [expandedPhoto, setExpandedPhoto] = useState<{ label: string; src: string } | null>(null);
  const [photoSessionToDelete, setPhotoSessionToDelete] = useState<PatientPhotoSession | null>(null);
  const [photoSessionEditor, setPhotoSessionEditor] = useState<"create" | "edit" | null>(null);
  const [photoSessionEditingId, setPhotoSessionEditingId] = useState<string>();
  const [photoSessionName, setPhotoSessionName] = useState("");
  const [photoSessionNameSaving, setPhotoSessionNameSaving] = useState(false);
  const [deletingPhotoSession, setDeletingPhotoSession] = useState(false);
  const [expanded, setExpanded] = useState(!expandable);
  const [activePhotoSessionId, setActivePhotoSessionId] = useState(() => getProcedurePhotoSessions(procedure)[0]?.id);
  const [viewMode, setViewMode] = useState<"compare" | "sideBySide">("compare");
  const [sliderPosition, setSliderPosition] = useState(50);
  const [creatingPhotoSession, setCreatingPhotoSession] = useState(false);
  const creatingPhotoSessionRef = useRef(false);
  const comparisonRef = useRef<HTMLDivElement>(null);
  const photoEditable = editable && Boolean(procedure.id);
  const beforeLabel = `Antes · ${procedure.date}`;
  const afterLabel = `Depois · ${procedure.date}`;
  const photoSessions = getProcedurePhotoSessions(procedure);
  const activePhotoSession = photoSessions.find((session) => session.id === activePhotoSessionId) ?? photoSessions[0];
  const activeSessionIdForRequest = activePhotoSession?.id.startsWith("legacy-") ? undefined : activePhotoSession?.id;

  function openPhotoSessionCreator() {
    if (creatingPhotoSessionRef.current) return;
    setPhotoSessionName(`Ângulo ${photoSessions.length + 1}`);
    setPhotoSessionEditor("create");
  }

  function openPhotoSessionEditor(sessionId: string) {
    const session = photoSessions.find((item) => item.id === sessionId);
    if (!session || session.id.startsWith("legacy-")) return;
    setPhotoSessionName(session.name);
    setPhotoSessionEditingId(session.id);
    setPhotoSessionEditor("edit");
  }

  async function savePhotoSessionName() {
    const name = photoSessionName.trim();
    if (!name || photoSessionNameSaving) return;
    setPhotoSessionNameSaving(true);
    const session = photoSessionEditor === "create" ? await addPhotoSession() : null;
    const renamed = photoSessionEditor === "edit" && photoSessionEditingId
      ? await onPhotoSessionRename?.(procedure.id, photoSessionEditingId, name)
      : false;
    setPhotoSessionNameSaving(false);
    if (session) setActivePhotoSessionId(session.id);
    if (renamed && photoSessionEditingId) setActivePhotoSessionId(photoSessionEditingId);
    if (session || renamed) setPhotoSessionEditor(null);
  }

  async function addPhotoSession() {
    if (creatingPhotoSessionRef.current) return null;
    creatingPhotoSessionRef.current = true;
    setCreatingPhotoSession(true);
    try {
      const session = await onPhotoSessionCreate?.(procedure.id, photoSessionName.trim());
      if (session) setActivePhotoSessionId(session.id);
      return session ?? null;
    } finally {
      creatingPhotoSessionRef.current = false;
      setCreatingPhotoSession(false);
    }
  }

  async function confirmDeletePhotoSession() {
    if (!photoSessionToDelete || photoSessionToDelete.id.startsWith("legacy-") || deletingPhotoSession) return;
    setDeletingPhotoSession(true);
    const deleted = await onPhotoSessionDelete?.(procedure.id, photoSessionToDelete.id);
    setDeletingPhotoSession(false);
    if (!deleted) return;
    const nextSession = photoSessions.find((session) => session.id !== photoSessionToDelete.id);
    if (nextSession) setActivePhotoSessionId(nextSession.id);
    setPhotoSessionToDelete(null);
  }

  function updateSlider(clientX: number) {
    const bounds = comparisonRef.current?.getBoundingClientRect();
    if (!bounds || !bounds.width) return;
    setSliderPosition(Math.min(100, Math.max(0, ((clientX - bounds.left) / bounds.width) * 100)));
  }

  function handleSliderPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateSlider(event.clientX);
  }

  function handleSliderPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.preventDefault();
      updateSlider(event.clientX);
    }
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-start justify-between gap-3 border-b border-[#ededf3] p-4">
        <button className={cn("min-w-0 flex-1 text-left", expandable && "cursor-pointer")} type="button" onClick={() => expandable && setExpanded((current) => !current)} aria-expanded={expandable ? expanded : undefined}>
          <h3 className="text-sm font-bold text-[#303144]">{procedure.name}</h3>
          <p className="mt-1 text-xs text-[#858696]">{procedure.date} · {procedure.professional}</p>
        </button>
        <div className="flex flex-wrap items-center justify-end gap-2"><Badge variant={procedure.status === "Realizado" ? "green" : procedure.status === "Em procedimento" ? "amber" : "slate"}>{procedure.status}</Badge>{appointment?.status === "Agendado" && appointment.id ? <Button className="h-8 px-2" type="button" disabled={!canStartProcedure} onClick={() => onProcedureStatusChange?.("Em atendimento")} title={canStartProcedure ? "Iniciar procedimento" : "Aguarde o dia e horário do procedimento"}><Clock3 className="h-3.5 w-3.5" />Iniciar procedimento</Button> : null}{procedureInProgress && appointment?.id ? <Button className="h-8 px-2" type="button" onClick={() => onProcedureStatusChange?.("Atendido")}><CheckCircle2 className="h-3.5 w-3.5" />Finalizar procedimento</Button> : null}{expandable ? <button className="grid h-8 w-8 place-items-center rounded-full text-[#77788a] transition hover:bg-[#f3f2ff] hover:text-[#5147dc]" type="button" onClick={() => setExpanded((current) => !current)} aria-label={expanded ? "Recolher procedimento" : "Expandir procedimento"} aria-expanded={expanded}><ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} /></button> : null}</div>
      </div>
      {expanded && journey ? <div className="border-b border-[#ededf3] px-4 py-3">{journey}</div> : null}
      {expanded ? <div className={cn("p-4", expandable && "grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]")}>
        <div className="min-w-0">
          <div className="mb-3 flex justify-end">
            <div className="inline-flex rounded-[7px] border border-[#dddfea] bg-[#fafafd] p-1">
              <button className={cn("inline-flex h-8 items-center gap-1.5 rounded-[5px] px-3 text-[10px] font-bold transition", viewMode === "compare" ? "bg-[#5147dc] text-white shadow-[0_4px_12px_rgba(81,71,220,0.2)]" : "text-[#77788a] hover:bg-white hover:text-[#5147dc]")} type="button" onClick={() => setViewMode("compare")} aria-pressed={viewMode === "compare"}><ArrowLeftRight className="h-3.5 w-3.5" />Comparar</button>
              <button className={cn("inline-flex h-8 items-center gap-1.5 rounded-[5px] px-3 text-[10px] font-bold transition", viewMode === "sideBySide" ? "bg-[#5147dc] text-white shadow-[0_4px_12px_rgba(81,71,220,0.2)]" : "text-[#77788a] hover:bg-white hover:text-[#5147dc]")} type="button" onClick={() => setViewMode("sideBySide")} aria-pressed={viewMode === "sideBySide"}><Columns2 className="h-3.5 w-3.5" />Lado a lado</button>
            </div>
          </div>
          {viewMode === "compare" ? <BeforeAfterComparison beforeSrc={activePhotoSession?.beforePhoto} afterSrc={activePhotoSession?.afterPhoto} beforeLabel={beforeLabel} afterLabel={afterLabel} sliderPosition={sliderPosition} comparisonRef={comparisonRef} onPointerDown={handleSliderPointerDown} onPointerMove={handleSliderPointerMove} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onBeforePreview={(src) => setExpandedPhoto({ label: "Antes", src })} onAfterPreview={(src) => setExpandedPhoto({ label: "Depois", src })} editable={photoEditable} showControls={!expandable} beforeSaving={beforePhotoSaving} afterSaving={afterPhotoSaving} beforeOperation={beforePhotoOperation} afterOperation={afterPhotoOperation} afterPhotoEnabled={afterPhotoEnabled} afterPhotoMessage={afterPhotoMessage} onBeforePhotoChange={(file) => onPhotoChange?.(procedure.id, "beforePhoto", file, activeSessionIdForRequest)} onAfterPhotoChange={(file) => onPhotoChange?.(procedure.id, "afterPhoto", file, activeSessionIdForRequest)} onBeforePhotoRemove={() => onPhotoRemove?.(procedure.id, "beforePhoto", activeSessionIdForRequest)} onAfterPhotoRemove={() => onPhotoRemove?.(procedure.id, "afterPhoto", activeSessionIdForRequest)} /> : <div className="grid justify-items-center gap-3 sm:grid-cols-2"><BeforeAfterPhoto label="Antes" overlayLabel={beforeLabel} src={activePhotoSession?.beforePhoto} editable={photoEditable && !expandable} saving={beforePhotoSaving} operation={beforePhotoOperation} onPhotoChange={(file) => onPhotoChange?.(procedure.id, "beforePhoto", file, activeSessionIdForRequest)} onPhotoRemove={() => onPhotoRemove?.(procedure.id, "beforePhoto", activeSessionIdForRequest)} onPreview={(src) => setExpandedPhoto({ label: "Antes", src })} /><BeforeAfterPhoto label="Depois" overlayLabel={afterLabel} src={activePhotoSession?.afterPhoto} editable={photoEditable && !expandable} photoInputEnabled={afterPhotoEnabled} blockedMessage={afterPhotoMessage} saving={afterPhotoSaving} operation={afterPhotoOperation} onPhotoChange={(file) => onPhotoChange?.(procedure.id, "afterPhoto", file, activeSessionIdForRequest)} onPhotoRemove={() => onPhotoRemove?.(procedure.id, "afterPhoto", activeSessionIdForRequest)} onPreview={(src) => setExpandedPhoto({ label: "Depois", src })} /></div>}
        </div>
        {expandable ? <ProcedureInfoPanel photoSessions={photoSessions} activePhotoSessionId={activePhotoSession?.id} onSelectPhotoSession={setActivePhotoSessionId} onCreatePhotoSession={openPhotoSessionCreator} onEditPhotoSession={openPhotoSessionEditor} onDeletePhotoSession={(sessionId) => setPhotoSessionToDelete(photoSessions.find((session) => session.id === sessionId) ?? null)} deletingPhotoSessionKey={deletingPhotoSessionKey} procedureId={procedure.id} creatingPhotoSession={creatingPhotoSession} editable={photoEditable} afterPhotoEnabled={afterPhotoEnabled} afterPhotoMessage={afterPhotoMessage} beforeSaving={beforePhotoSaving} afterSaving={afterPhotoSaving} beforeOperation={beforePhotoOperation} afterOperation={afterPhotoOperation} onBeforePhotoChange={(file) => onPhotoChange?.(procedure.id, "beforePhoto", file, activeSessionIdForRequest)} onAfterPhotoChange={(file) => onPhotoChange?.(procedure.id, "afterPhoto", file, activeSessionIdForRequest)} onBeforePhotoRemove={() => onPhotoRemove?.(procedure.id, "beforePhoto", activeSessionIdForRequest)} onAfterPhotoRemove={() => onPhotoRemove?.(procedure.id, "afterPhoto", activeSessionIdForRequest)} onBeforePreview={(src) => setExpandedPhoto({ label: "Antes", src })} onAfterPreview={(src) => setExpandedPhoto({ label: "Depois", src })} /> : null}
      </div> : null}
      {procedure.notes ? <div className="border-t border-[#ededf3] px-4 py-3 text-xs leading-5 text-[#656678]"><strong className="text-[#3f4053]">Observações: </strong>{procedure.notes}</div> : null}
      <Modal open={Boolean(expandedPhoto)} onClose={() => setExpandedPhoto(null)} title={`Foto de ${expandedPhoto?.label.toLowerCase() ?? "procedimento"}`} description="Visualização ampliada da foto do procedimento.">
        {expandedPhoto ? <div className="relative h-[min(70vh,620px)] w-full overflow-hidden rounded-[7px] bg-[#f7f8fc]"><Image className="object-contain" src={expandedPhoto.src} alt={`Foto ampliada de ${expandedPhoto.label.toLowerCase()}`} fill sizes="(max-width: 640px) 90vw, 560px" /></div> : null}
      </Modal>
      <Modal open={Boolean(photoSessionToDelete)} onClose={() => { if (!deletingPhotoSession) setPhotoSessionToDelete(null); }} title="Excluir sessão de fotos" description="As fotos dessa sessão serão removidas da evolução do procedimento.">
        <div className="space-y-4"><p className="text-sm text-[#555668]">Tem certeza que deseja excluir <strong>{photoSessionToDelete?.name}</strong>?</p><div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={deletingPhotoSession} onClick={() => setPhotoSessionToDelete(null)}>Cancelar</Button><Button type="button" className="bg-[#c43f35] hover:bg-[#a8322a]" disabled={deletingPhotoSession} onClick={() => void confirmDeletePhotoSession()}>{deletingPhotoSession ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}{deletingPhotoSession ? "Excluindo..." : "Excluir sessão"}</Button></div></div>
      </Modal>
      <Modal open={Boolean(photoSessionEditor)} onClose={() => { if (!photoSessionNameSaving && !creatingPhotoSession) setPhotoSessionEditor(null); }} title={photoSessionEditor === "edit" ? "Editar sessão de fotos" : "Nova sessão de fotos"} description="Defina um nome para identificar este ângulo.">
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void savePhotoSessionName(); }}><FormField label="Nome da sessão"><input className={fieldClassName} value={photoSessionName} onChange={(event) => setPhotoSessionName(event.target.value)} autoFocus maxLength={60} placeholder="Ex.: Perfil direito" /></FormField><div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={photoSessionNameSaving || creatingPhotoSession} onClick={() => setPhotoSessionEditor(null)}>Cancelar</Button><Button type="submit" disabled={!photoSessionName.trim() || photoSessionNameSaving || creatingPhotoSession}>{photoSessionNameSaving || creatingPhotoSession ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{photoSessionEditor === "edit" ? "Salvar nome" : "Criar sessão"}</Button></div></form>
      </Modal>
    </Card>
  );
}

function ProcedureInfoPanel({ photoSessions, activePhotoSessionId, onSelectPhotoSession, onCreatePhotoSession, onEditPhotoSession, onDeletePhotoSession, deletingPhotoSessionKey, procedureId, creatingPhotoSession, editable, afterPhotoEnabled = true, afterPhotoMessage, beforeSaving, afterSaving, beforeOperation, afterOperation, onBeforePhotoChange, onAfterPhotoChange, onBeforePhotoRemove, onAfterPhotoRemove, onBeforePreview, onAfterPreview }: { photoSessions: PatientPhotoSession[]; activePhotoSessionId?: string; onSelectPhotoSession: (sessionId: string) => void; onCreatePhotoSession: () => void; onEditPhotoSession: (sessionId: string) => void; onDeletePhotoSession: (sessionId: string) => void; deletingPhotoSessionKey?: string; procedureId?: string; creatingPhotoSession: boolean; editable?: boolean; afterPhotoEnabled?: boolean; afterPhotoMessage?: string; beforeSaving?: boolean; afterSaving?: boolean; beforeOperation?: "upload" | "remove"; afterOperation?: "upload" | "remove"; onBeforePhotoChange?: (file: File) => void; onAfterPhotoChange?: (file: File) => void; onBeforePhotoRemove?: () => void; onAfterPhotoRemove?: () => void; onBeforePreview?: (src: string) => void; onAfterPreview?: (src: string) => void }) {
  const activePhotoSession = photoSessions.find((session) => session.id === activePhotoSessionId) ?? photoSessions[0];
  const beforeImage = activePhotoSession?.beforePhoto && activePhotoSession.beforePhoto !== "__photo__" ? activePhotoSession.beforePhoto : undefined;
  const afterImage = activePhotoSession?.afterPhoto && activePhotoSession.afterPhoto !== "__photo__" ? activePhotoSession.afterPhoto : undefined;

  return <aside className="h-fit rounded-[7px] border border-[#e7e9f2] bg-[#fafafd] p-3">
    <div className="flex items-center justify-between gap-2"><h4 className="text-xs font-bold text-[#303144]">Sessões de fotos</h4>{editable ? <button className="inline-flex items-center gap-1 rounded-[5px] px-2 py-1 text-[9px] font-bold text-[#5147dc] transition hover:bg-[#f0efff] disabled:cursor-not-allowed disabled:opacity-60" type="button" onClick={onCreatePhotoSession} disabled={creatingPhotoSession} aria-busy={creatingPhotoSession}>{creatingPhotoSession ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}{creatingPhotoSession ? "Criando..." : "Nova sessão"}</button> : null}</div>
    <div className="mt-2 grid gap-1.5">{photoSessions.map((session, index) => { const sessionKey = `${procedureId ?? "procedure"}-${session.id}`; const canManage = editable && !session.id.startsWith("legacy-"); return <div className={cn("flex items-center gap-1 rounded-[5px] border p-1 transition", session.id === activePhotoSessionId ? "border-[#5147dc] bg-[#f0efff]" : "border-[#e7e9f2] bg-white")} key={session.id}><button className={cn("min-w-0 flex-1 rounded-[4px] px-1.5 py-1.5 text-left text-[10px] font-semibold", session.id === activePhotoSessionId ? "text-[#5147dc]" : "text-[#656678] hover:text-[#5147dc]")} type="button" onClick={() => onSelectPhotoSession(session.id)} aria-pressed={session.id === activePhotoSessionId}><span className="block truncate">{session.name || `Sessão ${index + 1}`}</span><span className="block text-[9px] text-[#858696]">{session.beforePhoto || session.afterPhoto ? "Com fotos" : "Vazia"}</span></button>{canManage ? <><button className="grid h-7 w-7 shrink-0 place-items-center rounded-[4px] text-[#858696] transition hover:bg-[#f0efff] hover:text-[#5147dc]" type="button" aria-label={`Editar ${session.name || `Sessão ${index + 1}`}`} title="Editar nome" onClick={() => onEditPhotoSession(session.id)}><PencilLine className="h-3.5 w-3.5" /></button><button className="grid h-7 w-7 shrink-0 place-items-center rounded-[4px] text-[#858696] transition hover:bg-[#fff0ee] hover:text-[#b42318] disabled:cursor-not-allowed disabled:opacity-45" type="button" aria-label={`Excluir ${session.name || `Sessão ${index + 1}`}`} title="Excluir sessão" disabled={Boolean(deletingPhotoSessionKey === sessionKey)} onClick={() => onDeletePhotoSession(session.id)}><Trash2 className="h-3.5 w-3.5" /></button></> : null}</div>; })}</div>
    <div className="mt-4 border-t border-[#e7e9f2] pt-3"><div className="flex items-center justify-between gap-2"><h4 className="text-xs font-bold text-[#303144]">{activePhotoSession?.name ?? "Fotos"}</h4><span className="text-[9px] font-semibold text-[#858696]">Antes / depois</span></div><div className="mt-2 grid grid-cols-2 gap-2"><ProcedurePhotoThumbnail label="Antes" src={beforeImage} editable={editable} saving={beforeSaving} onPreview={onBeforePreview} onRemove={onBeforePhotoRemove} /><ProcedurePhotoThumbnail label="Depois" src={afterImage} editable={editable} saving={afterSaving} disabled={!afterPhotoEnabled} onPreview={onAfterPreview} onRemove={onAfterPhotoRemove} /></div>{editable ? <div className="mt-3 grid gap-2"><PhotoInput icon={Upload} label={beforeImage ? "Trocar foto antes" : "Adicionar foto antes"} busyLabel={beforeOperation === "remove" ? "Removendo..." : "Carregando..."} disabled={beforeSaving} onChange={onBeforePhotoChange} /><PhotoInput icon={Upload} label={afterImage ? "Trocar foto depois" : "Adicionar foto depois"} busyLabel={afterOperation === "remove" ? "Removendo..." : "Carregando..."} disabled={afterSaving || !afterPhotoEnabled} blocked={!afterPhotoEnabled && !afterSaving} onChange={onAfterPhotoChange} />{afterPhotoMessage && !afterPhotoEnabled ? <p className="text-[9px] font-semibold text-[#858696]">{afterPhotoMessage}</p> : null}</div> : null}</div>
  </aside>;
}

function ProcedurePhotoThumbnail({ label, src, editable, saving, disabled, onPreview, onRemove }: { label: string; src?: string; editable?: boolean; saving?: boolean; disabled?: boolean; onPreview?: (src: string) => void; onRemove?: () => void }) {
  return <div className="overflow-hidden rounded-[5px] border border-[#e7e9f2] bg-white"><div className="px-2 py-1.5 text-[9px] font-bold uppercase text-[#858696]">{label}</div><div className="relative aspect-[9/16] bg-[#f1f2f7]">{src ? <button className="absolute inset-0 cursor-zoom-in" type="button" onClick={() => onPreview?.(src)} aria-label={`Ampliar foto ${label.toLowerCase()}`}><Image className="object-cover" src={src} alt={`Miniatura da foto ${label.toLowerCase()}`} fill sizes="130px" /></button> : <span className="absolute inset-0 grid place-items-center px-2 text-center text-[9px] font-semibold text-[#858696]">Sem foto</span>}{editable && src ? <button className="absolute right-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded-full bg-[#25263a]/80 text-white transition hover:bg-[#b42318] disabled:cursor-not-allowed disabled:opacity-50" type="button" aria-label={`Remover foto ${label.toLowerCase()}`} disabled={saving || disabled} onClick={onRemove}><X className="h-3 w-3" /></button> : null}</div></div>;
}

function BeforeAfterComparison({ beforeSrc, afterSrc, beforeLabel, afterLabel, sliderPosition, comparisonRef, onPointerDown, onPointerMove, onPointerUp, onBeforePreview, onAfterPreview, editable, showControls = true, compact = false, beforeSaving, afterSaving, beforeOperation, afterOperation, afterPhotoEnabled, afterPhotoMessage, onBeforePhotoChange, onAfterPhotoChange, onBeforePhotoRemove, onAfterPhotoRemove }: { beforeSrc?: string; afterSrc?: string; beforeLabel: string; afterLabel: string; sliderPosition: number; comparisonRef: RefObject<HTMLDivElement | null>; onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void; onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void; onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void; onBeforePreview: (src: string) => void; onAfterPreview: (src: string) => void; editable?: boolean; showControls?: boolean; compact?: boolean; beforeSaving?: boolean; afterSaving?: boolean; beforeOperation?: "upload" | "remove"; afterOperation?: "upload" | "remove"; afterPhotoEnabled?: boolean; afterPhotoMessage?: string; onBeforePhotoChange?: (file: File) => void; onAfterPhotoChange?: (file: File) => void; onBeforePhotoRemove?: () => void; onAfterPhotoRemove?: () => void }) {
  const beforeImage = beforeSrc && beforeSrc !== "__photo__" ? beforeSrc : undefined;
  const afterImage = afterSrc && afterSrc !== "__photo__" ? afterSrc : undefined;

  return (
    <div className={cn("mx-auto w-full", compact ? "max-w-[280px]" : "max-w-[460px]")}>
      <div ref={comparisonRef} className="relative aspect-[9/16] w-full cursor-ew-resize touch-none select-none overflow-hidden rounded-[7px] border border-[#e7e9f2] bg-[#f7f8fc]" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        {!beforeImage && !afterImage ? <span className="absolute inset-0 grid place-items-center px-4 text-center text-xs font-semibold text-[#858696]">Nenhuma foto cadastrada</span> : <>
          <ComparisonPhotoLayer src={afterImage} alt="Foto depois do procedimento" label={afterLabel} emptySide="after" onPreview={onAfterPreview} />
          <div className="pointer-events-none absolute inset-0" style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}>
            <ComparisonPhotoLayer src={beforeImage} alt="Foto antes do procedimento" label={beforeLabel} emptySide="before" onPreview={onBeforePreview} />
          </div>
          <div className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-white shadow-[0_0_0_1px_rgba(37,38,58,0.12)]" style={{ left: `${sliderPosition}%` }}>
            <span className="absolute left-1/2 top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-[#5147dc] text-white shadow-[0_5px_16px_rgba(37,38,58,0.28)]"><ArrowLeftRight className="h-4 w-4" /></span>
          </div>
        </>}
      </div>
      {editable && showControls ? <ComparisonPhotoControls label="Antes" saving={beforeSaving} operation={beforeOperation} onPhotoChange={onBeforePhotoChange} onPhotoRemove={onBeforePhotoRemove} /> : null}
      {editable && showControls ? <ComparisonPhotoControls label="Depois" saving={afterSaving} operation={afterOperation} photoInputEnabled={afterPhotoEnabled} blockedMessage={afterPhotoMessage} onPhotoChange={onAfterPhotoChange} onPhotoRemove={onAfterPhotoRemove} /> : null}
    </div>
  );
}

function ComparisonPhotoLayer({ src, alt, label, emptySide, onPreview }: { src?: string; alt: string; label: string; emptySide: "before" | "after"; onPreview: (src: string) => void }) {
  return src ? <button className="absolute inset-0 h-full w-full cursor-zoom-in" type="button" aria-label={`Ampliar ${label.toLowerCase()}`} onClick={(event) => { event.stopPropagation(); onPreview(src); }}><Image className="object-cover" src={src} alt={alt} fill draggable={false} onDragStart={(event) => event.preventDefault()} sizes="(max-width: 640px) 90vw, 420px" /><span className="absolute bottom-3 left-3 rounded-full bg-white/90 px-2.5 py-1 text-[9px] font-bold text-[#303144] shadow-[0_3px_10px_rgba(37,38,58,0.12)]">{label}</span></button> : <div className="absolute inset-0"><span className={cn("absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] font-semibold text-[#858696]", emptySide === "before" ? "left-[5%]" : "right-[5%]")}>Nenhuma foto cadastrada</span></div>;
}

function ComparisonPhotoControls({ label, saving, operation, photoInputEnabled = true, blockedMessage, onPhotoChange, onPhotoRemove }: { label: string; saving?: boolean; operation?: "upload" | "remove"; photoInputEnabled?: boolean; blockedMessage?: string; onPhotoChange?: (file: File) => void; onPhotoRemove?: () => void }) {
  return <div className="mt-2 flex gap-2"><PhotoInput icon={Upload} label={`${label}: enviar`} busyLabel={operation === "remove" ? "Removendo..." : "Carregando..."} disabled={saving || !photoInputEnabled} blocked={!photoInputEnabled && !saving} onChange={onPhotoChange} /><PhotoInput icon={Camera} label={`${label}: tirar`} busyLabel={operation === "remove" ? "Removendo..." : "Carregando..."} capture disabled={saving || !photoInputEnabled} blocked={!photoInputEnabled && !saving} onChange={onPhotoChange} />{onPhotoRemove ? <button className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[#dddfea] text-[#77788a] transition hover:border-[#b42318] hover:text-[#b42318] disabled:cursor-not-allowed disabled:opacity-50" type="button" aria-label={`Remover foto de ${label.toLowerCase()}`} disabled={saving || !photoInputEnabled} onClick={onPhotoRemove}><X className="h-3 w-3" /></button> : null}{blockedMessage && !photoInputEnabled ? <span className="sr-only">{blockedMessage}</span> : null}</div>;
}

function BeforeAfterPhoto({ label, overlayLabel, src, editable, photoInputEnabled = true, blockedMessage, saving, operation, onPhotoChange, onPhotoRemove, onPreview }: { label: string; overlayLabel?: string; src?: string; editable?: boolean; photoInputEnabled?: boolean; blockedMessage?: string; saving?: boolean; operation?: "upload" | "remove"; onPhotoChange?: (file: File) => void; onPhotoRemove?: () => void; onPreview?: (src: string) => void }) {
  const imageSrc = src && src !== "__photo__" ? src : undefined;
  const hasPhoto = Boolean(src);
  return (
    <div className="w-full max-w-[280px] overflow-hidden rounded-[7px] border border-[#e7e9f2] bg-[#f7f8fc]">
      <div className="flex items-center gap-2 px-3 py-2 text-[9px] font-bold uppercase text-[#858696]">
        <Camera className="h-3.5 w-3.5 text-[#5147dc]" />
        {label}
      </div>
      <div className="relative grid aspect-[9/16] w-full place-items-center text-xs font-semibold text-[#858696]">
        {saving ? <div className="flex flex-col items-center gap-2 text-[#5147dc]" aria-label={`${operation === "remove" ? "Removendo" : "Carregando"} foto de ${label.toLowerCase()}`}>
          <div className="hp-skeleton h-12 w-16 animate-pulse rounded-[5px]" />
          <span className="flex items-center gap-1 text-xs font-bold"><Loader2 className="h-3.5 w-3.5 animate-spin" />{operation === "remove" ? "Removendo foto..." : "Carregando foto..."}</span>
        </div> : imageSrc ? <>
          <button type="button" className="absolute inset-0 cursor-zoom-in" aria-label={`Ampliar foto de ${label.toLowerCase()}`} onClick={() => onPreview?.(imageSrc)}><Image className="object-cover transition-transform duration-200 hover:scale-[1.02]" src={imageSrc} alt={`Foto de ${label.toLowerCase()} do procedimento`} fill sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 400px" /></button>
          {overlayLabel ? <span className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-full bg-white/90 px-2.5 py-1 text-[9px] font-bold text-[#303144] shadow-[0_3px_10px_rgba(37,38,58,0.12)]">{overlayLabel}</span> : null}
          {editable ? <button type="button" className="absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-full bg-[#25263a]/80 text-white transition hover:bg-[#b42318] disabled:cursor-not-allowed disabled:opacity-50" aria-label={`Remover foto de ${label.toLowerCase()}`} disabled={saving || !photoInputEnabled} onClick={onPhotoRemove}><X className="h-3.5 w-3.5" /></button> : null}
        </> : hasPhoto ? <span className="px-4 text-center">Foto cadastrada</span> : blockedMessage ?? "Nenhuma foto cadastrada"}
      </div>
      {editable ? <div className="flex gap-2 border-t border-[#e7e9f2] bg-white p-2">
        <PhotoInput icon={Upload} label={src ? "Trocar foto" : "Enviar foto"} busyLabel={operation === "remove" ? "Removendo..." : "Carregando..."} disabled={saving || !photoInputEnabled} blocked={!photoInputEnabled && !saving} onChange={onPhotoChange} />
        <PhotoInput icon={Camera} label="Tirar foto" busyLabel={operation === "remove" ? "Removendo..." : "Carregando..."} capture disabled={saving || !photoInputEnabled} blocked={!photoInputEnabled && !saving} onChange={onPhotoChange} />
      </div> : null}
    </div>
  );
}

function PhotoInput({ icon: Icon, label, busyLabel, capture, disabled, blocked, onChange }: { icon: typeof Camera; label: string; busyLabel: string; capture?: boolean; disabled?: boolean; blocked?: boolean; onChange?: (file: File) => void }) {
  const busy = Boolean(disabled && !blocked);
  return (
    <label className={cn("inline-flex h-7 flex-1 cursor-pointer items-center justify-center gap-1 rounded-full border border-[#dddfea] bg-white px-2 text-[9px] font-bold text-[#5147dc] transition hover:border-[#5147dc]", disabled && "pointer-events-none opacity-50")} aria-busy={busy}>
      {busy ? <><Loader2 className="h-3 w-3 animate-spin" />{busyLabel}</> : <><Icon className="h-3 w-3" />{label}</>}
      <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture={capture ? "environment" : undefined} disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) onChange?.(file); event.currentTarget.value = ""; }} />
    </label>
  );
}

function AppointmentsTab({ patientId, history, loading, returnAppointmentTarget, onReturnAppointmentClose, onScheduleReturn }: { patientId: string; history?: PatientHistoryRecord; loading: boolean; returnAppointmentTarget: ReturnAppointmentTarget | null; onReturnAppointmentClose: () => void; onScheduleReturn: (procedure: ReturnAppointmentTarget, kind?: "return" | "procedure") => void }) {
  const [returnDate, setReturnDate] = useState(() => clinicDateAfterDays(0));
  const [returnTime, setReturnTime] = useState("09:00");
  const [returnReason, setReturnReason] = useState(() => returnAppointmentTarget ? returnAppointmentTarget.kind === "procedure" ? returnAppointmentTarget.name : `Retorno - ${returnAppointmentTarget.name}` : "");
  const [returnNotes, setReturnNotes] = useState("");
  const [returnSaving, setReturnSaving] = useState(false);
  const [returnError, setReturnError] = useState("");
  const [invalidReturnFields, setInvalidReturnFields] = useState<Set<string>>(new Set());
  const [editingAppointment, setEditingAppointment] = useState<PatientAppointmentRecord | null>(null);
  const [editedAppointments, setEditedAppointments] = useState<Record<string, PatientAppointmentRecord>>({});
  const [updatingAppointmentId, setUpdatingAppointmentId] = useState<string | null>(null);
  const [checkAppointmentId, setCheckAppointmentId] = useState<string | null>(null);
  const [checkedAppointmentIds, setCheckedAppointmentIds] = useState<string[]>([]);
  const [currentTime, setCurrentTime] = useState(() => clinicNowForForm());
  const primaryProcedure = history?.procedures[0];
  const returnScheduled = Boolean(history?.appointments.some((appointment) => appointment.procedure.toLocaleLowerCase("pt-BR").includes("retorno")));
  const scheduleKind = returnAppointmentTarget?.kind ?? "return";
  const appointments = (history?.appointments.map((appointment) => appointment.id && editedAppointments[appointment.id] ? editedAppointments[appointment.id] : appointment) ?? []).sort(comparePatientAppointments);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(clinicNowForForm()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  async function updateAppointmentStatus(appointment: PatientAppointmentRecord, status: "Em atendimento" | "Atendido") {
    if (!appointment.id) return;
    setUpdatingAppointmentId(appointment.id);
    try {
      const response = await fetch(`/api/appointments/${appointment.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const data = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(data?.message ?? "Não foi possível atualizar o atendimento.");
      setEditedAppointments((current) => ({ ...current, [appointment.id as string]: { ...appointment, status } }));
      invalidateClientCache(`/api/patients/${patientId}/history`, "/api/appointments", "/api/agenda/bootstrap", "/api/dashboard/bootstrap", ...(status === "Atendido" ? ["/api/patients"] : []));
      if (status === "Atendido") setCheckAppointmentId(appointment.id);
    } catch (statusError) {
      setReturnError(statusError instanceof Error ? statusError.message : "Não foi possível atualizar o atendimento.");
    } finally {
      setUpdatingAppointmentId(null);
    }
  }

  function openEditAppointment(appointment: PatientAppointmentRecord) {
    setEditingAppointment(appointment);
    const [day, month, year] = appointment.date.split("/");
    setReturnDate(year && month && day ? `${year}-${month}-${day}` : appointment.date.slice(0, 10));
    setReturnTime(appointment.time);
    setReturnReason(appointment.procedure);
    setReturnNotes(appointment.notes ?? "");
    setReturnError("");
  }

  async function saveReturnAppointment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((!returnAppointmentTarget && !editingAppointment) || !returnDate || !returnTime || !returnReason.trim()) return;
    const now = clinicNowForForm();
    const invalidFields = new Set<string>();
    if (returnDate < now.date) invalidFields.add("date");
    if (returnDate === now.date && returnTime <= now.time) invalidFields.add("time");
    if (invalidFields.size) {
      setInvalidReturnFields(invalidFields);
      setReturnError("Não é possível agendar um retorno em uma data ou horário que já passou.");
      window.setTimeout(() => setInvalidReturnFields(new Set()), 450);
      return;
    }
    setReturnSaving(true);
    setReturnError("");
    try {
      const response = await fetch(editingAppointment?.id ? `/api/appointments/${editingAppointment.id}` : "/api/appointments", {
        method: editingAppointment?.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editingAppointment?.id ? {} : { patientId }),
          procedure: returnReason.trim(),
          professional: editingAppointment?.professional ?? returnAppointmentTarget?.professional,
          date: `${returnDate}T${returnTime}:00-03:00`,
          time: returnTime,
          notes: returnNotes.trim(),
        }),
      });
      const data = await response.json().catch(() => null) as { appointment?: { id: string; date: string; time: string; procedure: string; professional: string; status: string; notes: string }; message?: string } | null;
      const updatedAppointment = data?.appointment;
      if (!response.ok || (editingAppointment?.id && !updatedAppointment)) throw new Error(data?.message ?? "Não foi possível salvar o retorno.");
      if (editingAppointment?.id && updatedAppointment) {
        setEditedAppointments((current) => ({ ...current, [editingAppointment.id as string]: { ...editingAppointment, date: formatAppointmentDisplayDate(updatedAppointment.date), time: updatedAppointment.time, procedure: updatedAppointment.procedure, professional: updatedAppointment.professional, status: updatedAppointment.status, notes: updatedAppointment.notes } }));
      }
      invalidateClientCache(`/api/patients/${patientId}/history`, "/api/appointments", "/api/patients", "/api/agenda/bootstrap", "/api/dashboard/bootstrap");
      setEditingAppointment(null);
      onReturnAppointmentClose();
    } catch (scheduleError) {
      setReturnError(scheduleError instanceof Error ? scheduleError.message : "Não foi possível marcar o retorno.");
    } finally {
      setReturnSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4"><div><h3 className="text-sm font-bold text-[#303144]">Agendamentos do cliente</h3><p className="mt-1 text-[10px] text-[#858696]">Acompanhe os atendimentos e agende o próximo retorno.</p></div><Button className={cn("shrink-0", returnScheduled && "border-[#b9e8d8] bg-[#eaf8ef] text-[#16805d] hover:border-[#b9e8d8] hover:bg-[#eaf8ef] hover:text-[#16805d]")} type="button" variant="secondary" disabled={!primaryProcedure || primaryProcedure.status !== "Realizado" || returnScheduled} onClick={() => { if (primaryProcedure) onScheduleReturn(primaryProcedure, "return"); }}><CalendarPlus className="h-3.5 w-3.5" />{returnScheduled ? "Retorno marcado" : "Marcar retorno"}</Button></div>
      {loading ? <AppointmentListSkeleton /> : !appointments.length ? <EmptyPatientState message="Este cliente ainda não possui agendamentos registrados." /> : (
        <Card className="p-5">
          <h3 className="text-sm font-bold text-[#303144]">Agendamentos do cliente</h3>
          <div className="mt-4 space-y-3">
            {appointments.map((appointment, index) => (
              <div className="flex flex-col gap-3 rounded-[7px] border border-[#ececf3] p-4 sm:flex-row sm:items-center sm:justify-between" key={appointment.id ?? `${appointment.date}-${appointment.time}-${appointment.procedure}-${index}`}>
                <div>
                  <p className="text-sm font-bold text-[#303144]">{appointment.procedure}</p>
                  <p className="mt-1 text-xs text-[#858696]">{appointment.date} às {appointment.time} · {appointment.professional}</p>
                  {appointment.notes ? <p className="mt-2 text-xs text-[#656678]">{appointment.notes}</p> : null}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">{appointment.id && appointment.status === "Atendido" && appointment.materialsCheck === "pending" && !checkedAppointmentIds.includes(appointment.id) ? <Button className="h-8 px-2" type="button" variant="secondary" onClick={() => setCheckAppointmentId(appointment.id ?? null)}>Conferir materiais</Button> : null}<Badge variant={appointment.status === "Atendido" ? "green" : appointment.status === "Em atendimento" ? "amber" : "purple"}>{appointment.status}</Badge>{appointment.status === "Agendado" && appointment.id ? <><Button className="h-8 px-2" type="button" variant="secondary" disabled={!appointmentCanStart(appointment, history?.appointmentToleranceMinutes ?? 15, currentTime)} onClick={() => void updateAppointmentStatus(appointment, "Em atendimento")} title={appointmentCanStart(appointment, history?.appointmentToleranceMinutes ?? 15, currentTime) ? "Iniciar atendimento" : "Aguarde o horário do atendimento"}>{updatingAppointmentId === appointment.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock3 className="h-3.5 w-3.5" />}{updatingAppointmentId === appointment.id ? "Atualizando..." : "Iniciar atendimento"}</Button><Button className="h-8 px-2" type="button" variant="secondary" aria-label="Editar retorno" title="Editar retorno" onClick={() => openEditAppointment(appointment)}><PencilLine className="h-3.5 w-3.5" /></Button></> : null}{appointment.status === "Em atendimento" && appointment.id ? <Button className="h-8 px-2" type="button" onClick={() => void updateAppointmentStatus(appointment, "Atendido")}><CheckCircle2 className="h-3.5 w-3.5" />{updatingAppointmentId === appointment.id ? "Atualizando..." : "Finalizar atendimento"}</Button> : null}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Modal open={Boolean(returnAppointmentTarget || editingAppointment)} onClose={() => { if (!returnSaving) { setEditingAppointment(null); onReturnAppointmentClose(); } }} title={editingAppointment ? "Editar retorno" : scheduleKind === "procedure" ? "Marcar procedimento" : "Marcar retorno"} description={editingAppointment ? "Atualize os dados do retorno agendado." : scheduleKind === "procedure" ? "O procedimento será incluído na lista de agendamentos da clínica." : "O retorno será incluído na lista de agendamentos da clínica."}>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveReturnAppointment}>
          <div className="sm:col-span-2 rounded-[7px] border border-[#e8e8ef] bg-[#fafafd] p-3 text-xs text-[#555668]">Procedimento: <strong className="text-[#303144]">{editingAppointment?.procedure ?? returnAppointmentTarget?.name}</strong></div>
          <FormField label="Data"><input className={cn(fieldClassName, invalidReturnFields.has("date") && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} type="date" value={returnDate} required onChange={(event) => { setReturnDate(event.target.value); setInvalidReturnFields((current) => { const next = new Set(current); next.delete("date"); return next; }); setReturnError(""); }} /></FormField>
          <FormField label="Horário"><input className={cn(fieldClassName, invalidReturnFields.has("time") && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} type="time" value={returnTime} required onChange={(event) => { setReturnTime(event.target.value); setInvalidReturnFields((current) => { const next = new Set(current); next.delete("time"); return next; }); setReturnError(""); }} /></FormField>
          <div className="sm:col-span-2"><FormField label={scheduleKind === "procedure" ? "Procedimento" : "Motivo do retorno"}><input className={fieldClassName} value={returnReason} required placeholder={scheduleKind === "procedure" ? "Ex.: Botox" : "Ex.: avaliação do resultado"} onChange={(event) => setReturnReason(event.target.value)} /></FormField></div>
          <div className="sm:col-span-2"><FormField label="Observações"><textarea className={`${fieldClassName} h-24 resize-none py-2`} value={returnNotes} placeholder="Adicione informações importantes para o atendimento" onChange={(event) => setReturnNotes(event.target.value)} /></FormField></div>
          {returnError ? <p className="rounded-[7px] bg-[#fff1f0] px-3 py-2 text-xs font-semibold text-[#b42318] sm:col-span-2">{returnError}</p> : null}
          <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" disabled={returnSaving} onClick={() => { setEditingAppointment(null); onReturnAppointmentClose(); }}>Cancelar</Button><Button type="submit" disabled={returnSaving}>{returnSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : editingAppointment ? <PencilLine className="h-3.5 w-3.5" /> : <CalendarPlus className="h-3.5 w-3.5" />}{returnSaving ? "Salvando..." : editingAppointment ? "Salvar alterações" : scheduleKind === "procedure" ? "Confirmar procedimento" : "Confirmar retorno"}</Button></div>
        </form>
      </Modal>
      {checkAppointmentId ? <MaterialCheckModal appointmentId={checkAppointmentId} onClose={() => setCheckAppointmentId(null)} onDone={(message) => { setCheckedAppointmentIds((current) => [...current, checkAppointmentId]); setCheckAppointmentId(null); invalidateClientCache(`/api/patients/${patientId}/history`); toast.success(message); }} /> : null}
    </div>
  );
}

function AppointmentListSkeleton() {
  return <Card className="space-y-3 p-5"><LoadingSkeleton className="h-4 w-44" />{[0, 1, 2].map((item) => <div className="flex items-center justify-between gap-4 rounded-[7px] border border-[#ececf3] p-4" key={item}><div className="flex-1 space-y-2"><LoadingSkeleton className="h-3 w-44" /><LoadingSkeleton className="h-2.5 w-64 max-w-full" /></div><LoadingSkeleton className="h-6 w-20 rounded-full" /></div>)}</Card>;
}

function ObservationsTab({ history }: { history?: PatientHistoryRecord }) {
  if (!history?.observations.length) return <EmptyPatientState message="Este cliente ainda não possui observações." />;

  return (
    <Card className="p-5">
      <h3 className="text-sm font-bold text-[#303144]">Observações do paciente</h3>
      <div className="mt-4 space-y-3">
        {history.observations.map((observation) => (
          <div className="rounded-[7px] border border-[#ececf3] bg-[#fbfbfe] p-4 text-sm leading-6 text-[#555668]" key={observation}>
            {observation}
          </div>
        ))}
      </div>
    </Card>
  );
}

function PaymentsTab({ history }: { history?: PatientHistoryRecord }) {
  if (!history?.payments.length) return <EmptyPatientState message="Este cliente ainda não possui pagamentos para acompanhar." />;

  return (
    <Card className="p-5">
      <h3 className="text-sm font-bold text-[#303144]">Pagamentos do cliente</h3>
      <div className="mt-4 space-y-3">
        {history.payments.map((payment, index) => (
          <div
            className={cn(
              "flex flex-col gap-3 rounded-[7px] border p-4 transition sm:flex-row sm:items-center sm:justify-between",
              payment.disabled ? "border-[#ececf3] bg-[#f7f7fa] opacity-60" : "border-[#e1e4f2] bg-white",
            )}
            key={payment.id ?? `${payment.procedure}-${payment.status}-${index}`}
          >
            <div>
              <p className="flex items-center gap-2 text-sm font-bold text-[#303144]"><CreditCard className="h-4 w-4 text-[#5147dc]" />{payment.procedure}</p>
              <p className="mt-1 text-xs text-[#858696]">{payment.value} · {payment.method}</p>
              {payment.disabledReason ? <p className="mt-1 text-[10px] font-semibold text-[#8a8b9c]">{payment.disabledReason}</p> : null}
            </div>
            <Badge variant={payment.status === "Pago" ? "green" : payment.status === "Bloqueado" ? "amber" : "purple"}>{payment.status}</Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}

function EmptyInline({ text }: { text: string }) {
  return <div className="rounded-[7px] border border-dashed border-[#d9dce8] p-4 text-xs font-semibold text-[#858696]">{text}</div>;
}

function InfoBlock({ icon: Icon, label, value }: { icon: typeof Phone; label: string; value: string }) {
  return (
    <div className="rounded-[6px] border border-[#e9e9ef] bg-[#fbfbfd] p-3">
      <p className="flex items-center gap-2 text-[9px] font-bold uppercase text-[#9697a7]"><Icon className="h-3.5 w-3.5 text-[#5147dc]" />{label}</p>
      <p className="mt-2 text-xs font-semibold text-[#4f5062]">{value}</p>
    </div>
  );
}
