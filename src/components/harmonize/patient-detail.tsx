"use client";

import Image from "next/image";
import { type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useRef, useState } from "react";
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
  FileText,
  Loader2,
  MapPin,
  PencilLine,
  Plus,
  Phone,
  Sparkles,
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
import { CustomerJourney } from "./customer-journey";
import { PatientExpenses } from "./patient-expenses";
import { PhotoEditor } from "./photo-editor/photo-editor";
import { EmptyState, LoadingSkeleton } from "./shared";
import { invalidateClientCache } from "@/lib/client-cache";
import { FormField, fieldClassName } from "@/components/ui/modal";
import { formatCpf, formatInteger, formatPhone } from "@/lib/input-masks";

const tabs = ["Dados", "Avaliação", "Orçamento", "Procedimentos", "Agendamentos", "Observações", "Histórico", "Pagamentos"];

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
};

type PatientJourneyOption = { id: string; name: string; createdAt: string; hasEvaluation?: boolean; hasPaidQuote?: boolean; hasProcedure?: boolean; hasBeforePhoto?: boolean; hasAfterPhoto?: boolean };
type JourneyEditorMode = { type: "create" } | { type: "edit"; journey: PatientJourneyOption };

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
  const [journeys, setJourneys] = useState<PatientJourneyOption[]>([]);
  const [selectedJourneyId, setSelectedJourneyId] = useState<string>();
  const [journeysLoading, setJourneysLoading] = useState(Boolean(patient.id));
  const [journeySaving, setJourneySaving] = useState(false);
  const [journeyEditor, setJourneyEditor] = useState<JourneyEditorMode | null>(null);
  const [journeyName, setJourneyName] = useState("");
  const [journeyError, setJourneyError] = useState("");
  const [tabShake, setTabShake] = useState<string | null>(null);
  const [journeyToDelete, setJourneyToDelete] = useState<PatientJourneyOption | null>(null);
  const [journeyNotice, setJourneyNotice] = useState<PatientJourneyOption | null>(null);
  const [journeyDeleteError, setJourneyDeleteError] = useState("");
  const [journeyDeleting, setJourneyDeleting] = useState(false);
  const [journeyValidationNotice, setJourneyValidationNotice] = useState("");
  const [journeyValidationShake, setJourneyValidationShake] = useState<string | null>(null);
  const [history, setHistory] = useState<PatientHistoryRecord>();
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(Boolean(patient.id && shouldLoadPatientHistory(initialTab)));
  const [returnAppointmentTarget, setReturnAppointmentTarget] = useState<ReturnAppointmentTarget | null>(null);
  const [evaluationCompleted, setEvaluationCompleted] = useState(false);
  const [quoteCompleted, setQuoteCompleted] = useState(false);
  const [procedurePhotos, setProcedurePhotos] = useState({ before: false, after: false });
  const initials = currentPatient.name.split(" ").map((part) => part[0]).slice(0, 2).join("");
  const procedureRecord = history?.procedures[0];
  const hasBeforePhoto = procedurePhotos.before || Boolean(procedureRecord?.beforePhoto);
  const hasAfterPhoto = procedurePhotos.after || Boolean(procedureRecord?.afterPhoto);
  const selectedJourney = journeys.find((item) => item.id === selectedJourneyId);
  const paidQuoteForSelectedJourney = Boolean(selectedJourney?.hasPaidQuote || selectedJourney?.hasProcedure || quoteCompleted);
  useEffect(() => {
    if (!patient.id) return;
    let cancelled = false;
    fetch(`/api/patients/${patient.id}/journeys`)
      .then((response) => response.json() as Promise<{ journeys?: PatientJourneyOption[] }>)
      .then((data) => {
        if (cancelled) return;
        const loaded = data.journeys ?? [];
        setJourneys(loaded);
        setSelectedJourneyId((current) => current && loaded.some((item) => item.id === current) ? current : loaded[0]?.id);
      })
      .catch(() => { if (!cancelled) setJourneys([]); })
      .finally(() => { if (!cancelled) setJourneysLoading(false); });
    return () => { cancelled = true; };
  }, [patient.id]);

  function openCreateJourney() {
    setJourneyName("");
    setJourneyError("");
    setJourneyEditor({ type: "create" });
  }

  function openEditJourney(item: PatientJourneyOption) {
    setJourneyName(item.name);
    setJourneyError("");
    setJourneyEditor({ type: "edit", journey: item });
  }

  async function saveJourney(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patient.id || journeySaving) return;
    const name = journeyName.trim();
    if (!name) {
      setJourneyError("Informe um nome para a jornada.");
      return;
    }
    setJourneySaving(true);
    try {
      const isEditing = journeyEditor?.type === "edit";
      const response = await fetch(`/api/patients/${patient.id}/journeys`, { method: isEditing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isEditing ? { journeyId: journeyEditor.journey.id, name } : { name }) });
      const data = await response.json() as { journey?: PatientJourneyOption; message?: string };
      if (!response.ok || !data.journey) throw new Error(data.message || "Não foi possível salvar a jornada.");
      setJourneys((current) => isEditing ? current.map((item) => item.id === data.journey?.id ? data.journey as PatientJourneyOption : item) : [data.journey as PatientJourneyOption, ...current]);
      selectJourney(data.journey.id);
      setHistory(undefined);
      setJourneyEditor(null);
    } catch (error) {
      setJourneyError(error instanceof Error ? error.message : "Não foi possível salvar a jornada.");
    } finally {
      setJourneySaving(false);
    }
  }

  function selectTab(tab: string) {
    if (tab === "Procedimentos" && !paidQuoteForSelectedJourney) {
      setTabShake(tab);
      window.setTimeout(() => setTabShake(null), 450);
      return;
    }
    if (tab === activeTab) return;
    setHistoryLoading(Boolean(patient.id && shouldLoadPatientHistory(tab)));
    setActiveTab(tab);
  }
  function selectJourney(id: string) {
    if (id === selectedJourneyId) return;
    setSelectedJourneyId(id);
    setHistory(undefined);
    setEvaluationCompleted(false);
    setQuoteCompleted(false);
    setProcedurePhotos({ before: false, after: false });
    setHistoryLoading(Boolean(patient.id && shouldLoadPatientHistory(activeTab)));
    setReturnAppointmentTarget(null);
  }

  async function deleteJourney() {
    if (!patient.id || !journeyToDelete) return;
    const deletedJourney = journeyToDelete;
    const remaining = journeys.filter((item) => item.id !== deletedJourney.id);
    setJourneyDeleteError("");
    setJourneyToDelete(null);
    setJourneyDeleting(true);
    setJourneys(remaining);
    if (selectedJourneyId === deletedJourney.id) {
      setSelectedJourneyId(remaining[0]?.id);
      setHistory(undefined);
    }
    setJourneyNotice(deletedJourney);
    const response = await fetch(`/api/patients/${patient.id}/journeys/${deletedJourney.id}`, { method: "DELETE" });
    const data = await response.json() as { message?: string };
    if (!response.ok) {
      setJourneys((current) => [...current, deletedJourney].sort((left, right) => left.createdAt.localeCompare(right.createdAt)));
      setSelectedJourneyId((current) => current ?? deletedJourney.id);
      setJourneyNotice(null);
      setJourneyToDelete(deletedJourney);
      setJourneyDeleteError(data.message || "Não foi possível excluir a jornada.");
      setJourneyDeleting(false);
      return;
    }
    setJourneyDeleting(false);
    window.setTimeout(() => setJourneyNotice((current) => current?.id === deletedJourney.id ? null : current), 6500);
  }

  async function undoDeleteJourney() {
    if (!patient.id || !journeyNotice || journeyDeleting) return;
    setJourneyDeleting(true);
    const response = await fetch(`/api/patients/${patient.id}/journeys/${journeyNotice.id}`, { method: "PATCH" });
    if (!response.ok) {
      setJourneyDeleting(false);
      return;
    }
    const restored = journeyNotice;
    setJourneys((current) => [...current, restored].sort((left, right) => left.createdAt.localeCompare(right.createdAt)));
    setSelectedJourneyId(restored.id);
    setJourneyNotice(null);
    setJourneyDeleting(false);
  }

  function requestJourneyDelete(item: PatientJourneyOption) {
    if (item.hasPaidQuote) {
      setJourneyValidationNotice("Não é possível excluir esta jornada porque ela possui um orçamento pago.");
      setJourneyValidationShake(item.id);
      window.setTimeout(() => setJourneyValidationShake(null), 450);
      window.setTimeout(() => setJourneyValidationNotice(""), 4200);
      return;
    }
    if (journeys.length <= 1) {
      setJourneyValidationNotice("Mantenha pelo menos uma jornada para o cliente.");
      setJourneyValidationShake(item.id);
      window.setTimeout(() => setJourneyValidationShake(null), 450);
      window.setTimeout(() => setJourneyValidationNotice(""), 4200);
      return;
    }
    setJourneyDeleteError("");
    setJourneyToDelete(item);
  }
  function journeyStagesFor(item: PatientJourneyOption) {
    const selected = item.id === selectedJourneyId;
    const hasEvaluation = Boolean(item.hasEvaluation || (selected && evaluationCompleted) || item.hasPaidQuote || item.hasBeforePhoto || item.hasAfterPhoto);
    const hasQuote = Boolean(item.hasPaidQuote || (selected && quoteCompleted));
    const hasBefore = Boolean(item.hasBeforePhoto || (selected && hasBeforePhoto));
    const hasAfter = Boolean(item.hasAfterPhoto || (selected && hasAfterPhoto));
    const hasProcedure = Boolean(item.hasProcedure || hasQuote || hasBefore || hasAfter);
    const base = item.id === journeys[0]?.id ? journey : newJourneyStages();

    return base.map((stage) => {
      if (stage.id === "evaluation" && hasEvaluation) return { ...stage, status: "completed" as const };
      if (stage.id === "quote" && hasQuote) return { ...stage, status: "completed" as const };
      if (stage.id === "procedure" && !hasProcedure) return { ...stage, status: "pending" as const };
      if (stage.id === "procedure" && hasProcedure) {
        if (hasAfter) return { ...stage, status: "completed" as const };
        if (hasBefore) return { ...stage, status: "in_progress" as const };
        return { ...stage, status: "current" as const };
      }
      if (stage.id === "return" && hasAfter && stage.status === "pending") return { ...stage, status: "current" as const };
      if (stage.id === "aftercare" && !hasAfter) return { ...stage, status: "pending" as const };
      return stage;
    });
  }

  useEffect(() => {
    if (!patient.id || (!selectedJourneyId && activeTab !== "Histórico") || !shouldLoadPatientHistory(activeTab)) return;
    let cancelled = false;
    const historyJourneyQuery = activeTab === "Histórico" ? "" : `&journeyId=${encodeURIComponent(selectedJourneyId as string)}`;
    const historyUrl = `/api/patients/${patient.id}/history?tab=${encodeURIComponent(activeTab)}${historyJourneyQuery}`;
    fetch(historyUrl, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Não foi possível carregar o histórico (${response.status}).`);
        return response.json() as Promise<{ patient?: { appointmentToleranceMinutes?: number; appointments: Array<{ id: string; date: string; time: string; procedure: string; professional: string; status: string; notes: string }>; payments: Array<{ id: string; value: number; method: string; status: string; installments: string }>; quotes: Array<{ id: string; items: string; status: string; createdAt?: string }>; procedureRecords: Array<{ id: string; name: string; professional: string; performedAt: string; notes: string; beforePhoto: string | null; afterPhoto: string | null; photoSessions?: Array<{ id: string; name: string; beforePhoto: string | null; afterPhoto: string | null }> }> } }>;
      })
      .then((data) => {
        if (cancelled) return;
        const appointments = data.patient?.appointments ?? [];
        const payments = data.patient?.payments ?? [];
        const paidQuotes = (data.patient?.quotes ?? []).filter((quote) => ["Pago", "Aprovado"].includes(quote.status));
        const latestQuoteItems = paidQuotes[0]?.items;
        const useQuoteTitle = Boolean(latestQuoteItems && data.patient?.procedureRecords?.length === 1);
        setQuoteCompleted(data.patient?.quotes?.some((quote) => ["Pago", "Aprovado"].includes(quote.status)) ?? false);
        const latestProcedure = data.patient?.procedureRecords?.[0];
        setProcedurePhotos({ before: Boolean(latestProcedure?.beforePhoto), after: Boolean(latestProcedure?.afterPhoto) });
        const persistedProcedures = data.patient?.procedureRecords ?? [];
        const procedures = persistedProcedures.length
          ? persistedProcedures.map((item) => ({ id: item.id, name: useQuoteTitle ? latestQuoteItems ?? item.name : item.name, date: new Date(item.performedAt).toLocaleDateString("pt-BR"), professional: item.professional, status: procedurePhotoStatus(item.beforePhoto, item.afterPhoto), beforePhoto: item.beforePhoto ?? "", afterPhoto: item.afterPhoto ?? "", photoSessions: item.photoSessions?.map((session) => ({ id: session.id, name: session.name, beforePhoto: session.beforePhoto ?? "", afterPhoto: session.afterPhoto ?? "" })) ?? [], notes: item.notes.startsWith("__quote:") ? "" : item.notes }))
          : paidQuotes.map((quote) => ({ name: quote.items, date: quote.createdAt ? new Date(quote.createdAt).toLocaleDateString("pt-BR") : new Date().toLocaleDateString("pt-BR"), professional: "", status: "Aguardando foto", beforePhoto: "", afterPhoto: "", photoSessions: [], notes: "" }))
            .concat(appointments.filter((item) => ["Atendido", "Finalizado"].includes(item.status)).map((item) => ({ name: item.procedure, date: new Date(item.date).toLocaleDateString("pt-BR"), professional: item.professional, status: item.status, beforePhoto: "", afterPhoto: "", photoSessions: [], notes: item.notes })));
        setHistory({
          appointments: appointments.map((item) => ({ id: item.id, date: new Date(item.date).toLocaleDateString("pt-BR"), time: item.time, procedure: item.procedure, professional: item.professional, status: item.status, notes: item.notes })),
          appointmentToleranceMinutes: data.patient?.appointmentToleranceMinutes ?? 15,
          procedures,
          payments: payments.map((item) => ({ id: item.id, procedure: "Atendimento", value: new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(item.value), method: item.method, status: item.status, disabled: item.status === "Pago", disabledReason: item.status === "Pago" ? "Pagamento já finalizado" : undefined })),
          observations: [],
        });
      })
      .catch(() => { if (!cancelled) setHistory(undefined); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [patient.id, activeTab, selectedJourneyId, historyRefreshKey]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <button className="flex items-center gap-2 text-[11px] font-bold text-[#696a7c] hover:text-[#5147dc]" onClick={onBack}>
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para clientes
      </button>

      <Card className="grid overflow-hidden p-0 lg:grid-cols-[350px_minmax(0,1fr)]">
        <div className="flex items-center gap-4 border-b border-[#ececf2] p-4 lg:border-b-0 lg:border-r">
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

        <div className="min-w-0 p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-[9px] font-bold uppercase text-[#9a9baa]">Jornadas do cliente</p><p className="mt-1 text-[10px] text-[#858696]">Selecione uma jornada para abrir os dados relacionados</p></div><Button className="shrink-0" size="sm" type="button" disabled={journeySaving} onClick={openCreateJourney}><Plus className="h-3.5 w-3.5" />Nova jornada</Button></div>
          {journeysLoading ? <div className="hp-skeleton h-28 animate-pulse rounded-[7px]" /> : [...journeys].reverse().map((item) => {
            const selectedJourney = item.id === selectedJourneyId;
            return <div className={cn("mb-3 rounded-[8px] border p-2 last:mb-0", selectedJourney ? "border-[#cfcaff] bg-[#fcfbff]" : "border-transparent")} key={item.id}>
              <div className="mb-1 flex items-center gap-2 px-1"><button className="min-w-0 flex-1 text-left" type="button" onClick={() => selectJourney(item.id)}><span className={cn("block truncate text-[10px] font-bold", selectedJourney ? "text-[#5147dc]" : "text-[#77788a]")}>{item.name}</span></button><button className="hp-pressable rounded p-1 text-[#88899a] hover:bg-[#eeecff] hover:text-[#5147dc] disabled:cursor-default disabled:opacity-35" type="button" aria-label={`Editar ${item.name}`} disabled={journeyDeleting} onClick={() => openEditJourney(item)}><PencilLine className="h-3 w-3" /></button><button className={cn("hp-pressable rounded p-1 text-[#88899a] hover:bg-[#fff0ee] hover:text-[#b42318] disabled:cursor-default disabled:opacity-35", journeyValidationShake === item.id && "animate-[hp-shake_0.42s_ease-in-out]")} type="button" aria-label={`Excluir ${item.name}`} title={item.hasPaidQuote ? "Não é possível excluir uma jornada com orçamento pago" : journeys.length <= 1 ? "Mantenha pelo menos uma jornada" : "Excluir jornada"} disabled={journeyDeleting} onClick={() => requestJourneyDelete(item)}><Trash2 className="h-3 w-3" /></button>{selectedJourney ? <span className="text-[9px] font-semibold text-[#5147dc]">Selecionada</span> : null}</div>
              <CustomerJourney
                compact
                journey={journeyStagesFor(item)}
                onOpenStage={(stageId) => {
                  selectJourney(item.id);
                  const stageTabs = { lead: "Dados", evaluation: "Avaliação", quote: "Orçamento", procedure: "Procedimentos", return: "Agendamentos", aftercare: "Observações" } as const;
                  selectTab(stageTabs[stageId]);
                }}
              />
            </div>;
          })}
        </div>
      </Card>

      <Modal open={Boolean(journeyEditor)} onClose={() => { if (!journeySaving) setJourneyEditor(null); }} title={journeyEditor?.type === "edit" ? "Editar jornada" : "Nova jornada"} description="Escolha um nome para identificar os dados desta jornada.">
        <form className="space-y-4" onSubmit={(event) => void saveJourney(event)}>
          <FormField label="Nome da jornada"><input autoFocus className={cn(fieldClassName, journeyError && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} value={journeyName} onChange={(event) => { setJourneyName(event.target.value); setJourneyError(""); }} placeholder="Ex.: Harmonização facial" /></FormField>
          {journeyError ? <p className="rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318]">{journeyError}</p> : null}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={journeySaving} onClick={() => setJourneyEditor(null)}>Cancelar</Button><Button type="submit" disabled={journeySaving}>{journeySaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{journeySaving ? "Salvando..." : "Salvar jornada"}</Button></div>
        </form>
      </Modal>

      <Modal open={Boolean(journeyToDelete)} onClose={() => setJourneyToDelete(null)} title="Excluir jornada" description="Essa ação remove a jornada da lista, mas permite desfazer por alguns segundos.">
        <div className="space-y-4"><p className="text-sm text-[#555668]">Tem certeza que deseja excluir <strong>{journeyToDelete?.name}</strong>?</p>{journeyDeleteError ? <p className="rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318]">{journeyDeleteError}</p> : null}<div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={journeyDeleting} onClick={() => setJourneyToDelete(null)}>Cancelar</Button><Button type="button" className="bg-[#c43f35] hover:bg-[#a8322a]" disabled={journeyDeleting} onClick={() => void deleteJourney()}>{journeyDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}{journeyDeleting ? "Excluindo..." : "Tenho certeza, excluir"}</Button></div></div>
      </Modal>

      {journeyNotice ? <div className="fixed bottom-6 left-1/2 z-[90] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-[8px] bg-[#25263a] px-4 py-3 text-xs font-bold text-white shadow-[0_18px_45px_rgba(31,32,50,0.24)]"><div className="flex items-center gap-3"><span className="min-w-0 flex-1">Jornada excluída.</span><button className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-black transition hover:bg-white/20 disabled:cursor-default disabled:opacity-60" type="button" disabled={journeyDeleting} onClick={() => void undoDeleteJourney()}>{journeyDeleting ? "Excluindo..." : "Desfazer"}</button></div><div className="mt-3 h-1 rounded-full bg-[#7cffb2] hp-snackbar-progress" style={{ "--snackbar-duration": "6500ms" } as CSSProperties} /></div> : null}
      {journeyValidationNotice ? <div className="fixed bottom-24 left-1/2 z-[120] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 overflow-hidden rounded-[8px] bg-[#25263a] px-4 py-3 text-xs font-bold text-white shadow-[0_18px_45px_rgba(31,32,50,0.24)] animate-[hp-shake_0.42s_ease-in-out] lg:bottom-16" role="alert"><div className="flex items-center gap-3"><span className="min-w-0 flex-1">{journeyValidationNotice}</span></div><div className="mt-3 h-1 rounded-full bg-[#ff8077] hp-snackbar-progress" style={{ "--snackbar-duration": "4200ms" } as CSSProperties} /></div> : null}

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
        <PatientExpenses key={`expenses-${selectedJourneyId ?? "none"}`} patientId={currentPatient.id ?? ""} journeyId={selectedJourneyId} onPaid={() => { setQuoteCompleted(true); setHistory(undefined); setHistoryLoading(true); setHistoryRefreshKey((current) => current + 1); }} />
      ) : (
        <PatientTabContent key={`tab-${activeTab}-${selectedJourneyId ?? "none"}`} patient={currentPatient} journeyId={selectedJourneyId} activeTab={activeTab} history={history} historyLoading={historyLoading} quoteCompleted={paidQuoteForSelectedJourney} returnAppointmentTarget={returnAppointmentTarget} onReturnAppointmentClose={() => setReturnAppointmentTarget(null)} onEvaluationSaved={() => setEvaluationCompleted(true)} onPatientUpdated={setCurrentPatient} onProcedurePhotosChange={(before, after) => setProcedurePhotos({ before, after })} onProcedurePhotoUpdated={(procedureId, photo) => setHistory((current) => current ? { ...current, procedures: current.procedures.map((item) => item.id === procedureId ? { ...item, beforePhoto: photo.beforePhoto ?? "", afterPhoto: photo.afterPhoto ?? "", status: procedurePhotoStatus(photo.beforePhoto, photo.afterPhoto) } : item) } : current)} onScheduleReturn={(procedure, kind = "return") => { setReturnAppointmentTarget({ ...procedure, kind }); selectTab("Agendamentos"); }} />
      )}
    </div>
  );
}

function PatientTabContent({ patient, journeyId, activeTab, history, historyLoading, quoteCompleted, returnAppointmentTarget, onReturnAppointmentClose, onEvaluationSaved, onPatientUpdated, onProcedurePhotosChange, onProcedurePhotoUpdated, onScheduleReturn }: { patient: Patient; journeyId?: string; activeTab: string; history?: PatientHistoryRecord; historyLoading: boolean; quoteCompleted: boolean; returnAppointmentTarget: ReturnAppointmentTarget | null; onReturnAppointmentClose: () => void; onEvaluationSaved: () => void; onPatientUpdated: (patient: Patient) => void; onProcedurePhotosChange: (before: boolean, after: boolean) => void; onProcedurePhotoUpdated: (procedureId: string, photo: { beforePhoto: string | null; afterPhoto: string | null }) => void; onScheduleReturn: (procedure: ReturnAppointmentTarget, kind?: "return" | "procedure") => void }) {

  if (activeTab === "Avaliação") {
    return patient.id ? <PhotoEditor patientId={patient.id} journeyId={journeyId} patientName={patient.name} onSaved={onEvaluationSaved} /> : <EmptyState title="Cliente ainda não foi salvo" description="Salve o cliente antes de adicionar fotos à avaliação." />;
  }

  if (activeTab === "Histórico") {
    return <HistoryTab patient={patient} history={history} />;
  }

  if (activeTab === "Procedimentos") {
    if (!quoteCompleted && !historyLoading) return <EmptyState title="Procedimento bloqueado" description="Quite o orçamento para liberar o acesso ao procedimento." />;
    return <ProceduresTab patientId={patient.id ?? ""} history={history} loading={historyLoading} onProcedurePhotosChange={onProcedurePhotosChange} onProcedurePhotoUpdated={onProcedurePhotoUpdated} onScheduleReturn={onScheduleReturn} />;
  }

  if (activeTab === "Agendamentos") {
    return <AppointmentsTab patientId={patient.id ?? ""} journeyId={journeyId} history={history} loading={historyLoading} returnAppointmentTarget={returnAppointmentTarget} onReturnAppointmentClose={onReturnAppointmentClose} onScheduleReturn={onScheduleReturn} />;
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

function newJourneyStages(): CustomerJourneyStage[] {
  return [
    ["lead", "Lead"],
    ["evaluation", "Avaliação"],
    ["quote", "Orçamento"],
    ["procedure", "Procedimento"],
    ["return", "Retorno"],
    ["aftercare", "Pós-atendimento"],
  ].map(([id, label], index) => ({ id: id as JourneyStageId, label, status: index === 0 ? "completed" as const : "pending" as const, date: null, details: [] }));
}

function shouldLoadPatientHistory(tab: string) {
  return ["Procedimentos", "Agendamentos", "Histórico", "Pagamentos"].includes(tab);
}

function HistoryTab({ patient, history }: { patient: Patient; history?: PatientHistoryRecord }) {
  if (!history || (!history.procedures.length && !history.appointments.length && !history.payments.length && !history.observations.length)) {
    return <EmptyPatientState message={`${patient.name} ainda não possui um histórico.`} />;
  }

  return (
    <div className="space-y-4">
      <Card className="self-start p-5">
        <p className="text-[9px] font-bold uppercase text-[#a0a1af]">Resumo</p>
        <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <SummaryLine label="Procedimentos feitos" value={String(history.procedures.length)} />
          <SummaryLine label="Agendamentos" value={String(history.appointments.length)} />
          <SummaryLine label="Pagamentos registrados" value={String(history.payments.filter((payment) => !payment.disabled).length)} />
          <SummaryLine label="Observações" value={String(history.observations.length)} />
        </div>
      </Card>
      <div>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#5147dc]" />
          <h3 className="text-sm font-bold text-[#303144]">Histórico do cliente</h3>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {history.procedures.map((procedure) => (
            <ProcedureHistoryCard key={`${procedure.name}-${procedure.date}`} procedure={procedure} />
          ))}
          {!history.procedures.length ? <EmptyInline text="Cliente ainda não realizou procedimentos." /> : null}
        </div>
      </div>
    </div>
  );
}

function ProceduresTab({ patientId, history, loading, onProcedurePhotosChange, onProcedurePhotoUpdated, onScheduleReturn }: { patientId: string; history?: PatientHistoryRecord; loading: boolean; onProcedurePhotosChange: (before: boolean, after: boolean) => void; onProcedurePhotoUpdated: (procedureId: string, photo: { beforePhoto: string | null; afterPhoto: string | null }) => void; onScheduleReturn: (procedure: ReturnAppointmentTarget, kind?: "return" | "procedure") => void }) {
  const [procedures, setProcedures] = useState<PatientProcedureRecord[]>(history?.procedures ?? []);
  const [photoOperations, setPhotoOperations] = useState<Record<string, "upload" | "remove">>({});
  const [appointmentStatuses, setAppointmentStatuses] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [currentTime, setCurrentTime] = useState(() => clinicNowForForm());

  const visibleProcedures = history ? (procedures.length ? procedures : history.procedures) : [];
  const primaryProcedure = visibleProcedures[0];
  const returnScheduled = Boolean(history?.appointments.some((appointment) => appointment.procedure.toLocaleLowerCase("pt-BR").includes("retorno")));
  const procedureScheduled = Boolean(primaryProcedure && history?.appointments.some((appointment) => appointment.procedure === primaryProcedure.name && ["Agendado", "Em atendimento"].includes(appointment.status)));

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
      invalidateClientCache(`/api/patients/${patientId}/history`, "/api/appointments", "/api/agenda/bootstrap", "/api/dashboard/bootstrap");
    } catch (appointmentError) {
      setError(appointmentError instanceof Error ? appointmentError.message : "Não foi possível atualizar o procedimento.");
    }
  }

  async function updateProcedurePhoto(procedureId: string | undefined, photoType: "beforePhoto" | "afterPhoto", photo: string | null, operation: "upload" | "remove" = "upload", sessionId?: string) {
    if (!procedureId) return;
    const operationKey = `${procedureId}-${sessionId ?? "main"}-${photoType}`;
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
        onProcedurePhotosChange(Boolean(data.procedure.beforePhoto), Boolean(data.procedure.afterPhoto));
        onProcedurePhotoUpdated(procedureId, data.procedure);
      }
      invalidateClientCache(`/api/patients/${patientId}/history`, `/api/patients/${patientId}/procedures`);
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

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4"><div><h3 className="text-sm font-bold text-[#303144]">Procedimentos realizados</h3><p className="mt-1 text-[10px] text-[#858696]">Os procedimentos aparecem aqui automaticamente a partir do orçamento aprovado. Adicione as fotos de antes e depois no atendimento.</p></div><div className="flex flex-wrap justify-end gap-2"><Button className={cn("shrink-0", procedureScheduled && "border-[#b9e8d8] bg-[#eaf8ef] text-[#16805d] hover:border-[#b9e8d8] hover:bg-[#eaf8ef] hover:text-[#16805d]")} type="button" variant="secondary" disabled={!primaryProcedure || primaryProcedure.status === "Realizado" || procedureScheduled} onClick={() => { if (primaryProcedure) onScheduleReturn(primaryProcedure, "procedure"); }}><CalendarPlus className="h-3.5 w-3.5" />{procedureScheduled ? "Procedimento marcado" : "Marcar procedimento"}</Button><Button className={cn("shrink-0", returnScheduled && "border-[#b9e8d8] bg-[#eaf8ef] text-[#16805d] hover:border-[#b9e8d8] hover:bg-[#eaf8ef] hover:text-[#16805d]")} type="button" variant="secondary" disabled={!primaryProcedure || primaryProcedure.status !== "Realizado" || returnScheduled} onClick={() => { if (primaryProcedure) onScheduleReturn(primaryProcedure, "return"); }}><CalendarPlus className="h-3.5 w-3.5" />{returnScheduled ? "Retorno marcado" : "Marcar retorno"}</Button></div></div>
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
        return <ProcedureHistoryCard key={procedure.id ?? `${procedure.name}-${procedure.date}`} procedure={procedure} editable expandable afterPhotoEnabled={afterPhotoEnabled} afterPhotoMessage={!afterPhotoEnabled ? "Aguardando o dia do procedimento" : undefined} appointment={appointmentWithStatus} canStartProcedure={procedureCanStart} procedureInProgress={procedureInProgress} onProcedureStatusChange={(status) => { if (appointmentWithStatus) void updateProcedureAppointment(appointmentWithStatus, status); }} beforePhotoSaving={Boolean(photoOperations[beforeKey])} afterPhotoSaving={Boolean(photoOperations[afterKey])} beforePhotoOperation={photoOperations[beforeKey]} afterPhotoOperation={photoOperations[afterKey]} onPhotoChange={saveProcedurePhoto} onPhotoRemove={(procedureId, photoType, sessionId) => updateProcedurePhoto(procedureId, photoType, null, "remove", sessionId)} onPhotoSessionCreate={createPhotoSession} />;
      })}</div>}
      {error ? <p className="rounded-[7px] bg-[#fff1f0] px-3 py-2 text-xs font-semibold text-[#b42318]">{error}</p> : null}
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

function ProcedureHistoryCard({ procedure, editable, expandable = false, afterPhotoEnabled = true, afterPhotoMessage, appointment, canStartProcedure, procedureInProgress, onProcedureStatusChange, beforePhotoSaving, afterPhotoSaving, beforePhotoOperation, afterPhotoOperation, onPhotoChange, onPhotoRemove, onPhotoSessionCreate }: { procedure: PatientProcedureRecord; editable?: boolean; expandable?: boolean; afterPhotoEnabled?: boolean; afterPhotoMessage?: string; appointment?: PatientAppointmentRecord; canStartProcedure?: boolean; procedureInProgress?: boolean; onProcedureStatusChange?: (status: "Em atendimento" | "Atendido") => void; beforePhotoSaving?: boolean; afterPhotoSaving?: boolean; beforePhotoOperation?: "upload" | "remove"; afterPhotoOperation?: "upload" | "remove"; onPhotoChange?: (procedureId: string | undefined, photoType: "beforePhoto" | "afterPhoto", file: File, sessionId?: string) => void; onPhotoRemove?: (procedureId: string | undefined, photoType: "beforePhoto" | "afterPhoto", sessionId?: string) => void; onPhotoSessionCreate?: (procedureId: string | undefined, name: string) => Promise<PatientPhotoSession | null> }) {
  const [expandedPhoto, setExpandedPhoto] = useState<{ label: string; src: string } | null>(null);
  const [expanded, setExpanded] = useState(!expandable);
  const [activePhotoSessionId, setActivePhotoSessionId] = useState(() => getProcedurePhotoSessions(procedure)[0]?.id);
  const [viewMode, setViewMode] = useState<"compare" | "sideBySide">("compare");
  const [sliderPosition, setSliderPosition] = useState(50);
  const comparisonRef = useRef<HTMLDivElement>(null);
  const photoEditable = editable && Boolean(procedure.id);
  const beforeLabel = `Antes · ${procedure.date}`;
  const afterLabel = `Depois · ${procedure.date}`;
  const photoSessions = getProcedurePhotoSessions(procedure);
  const activePhotoSession = photoSessions.find((session) => session.id === activePhotoSessionId) ?? photoSessions[0];
  const activeSessionIdForRequest = activePhotoSession?.id.startsWith("legacy-") ? undefined : activePhotoSession?.id;

  async function addPhotoSession() {
    const nextNumber = photoSessions.length + 1;
    const session = await onPhotoSessionCreate?.(procedure.id, `Ângulo ${nextNumber}`);
    if (!session) return;
    setActivePhotoSessionId(session.id);
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
        {expandable ? <ProcedureInfoPanel photoSessions={photoSessions} activePhotoSessionId={activePhotoSession?.id} onSelectPhotoSession={setActivePhotoSessionId} onCreatePhotoSession={addPhotoSession} editable={photoEditable} afterPhotoEnabled={afterPhotoEnabled} afterPhotoMessage={afterPhotoMessage} beforeSaving={beforePhotoSaving} afterSaving={afterPhotoSaving} beforeOperation={beforePhotoOperation} afterOperation={afterPhotoOperation} onBeforePhotoChange={(file) => onPhotoChange?.(procedure.id, "beforePhoto", file, activeSessionIdForRequest)} onAfterPhotoChange={(file) => onPhotoChange?.(procedure.id, "afterPhoto", file, activeSessionIdForRequest)} onBeforePhotoRemove={() => onPhotoRemove?.(procedure.id, "beforePhoto", activeSessionIdForRequest)} onAfterPhotoRemove={() => onPhotoRemove?.(procedure.id, "afterPhoto", activeSessionIdForRequest)} onBeforePreview={(src) => setExpandedPhoto({ label: "Antes", src })} onAfterPreview={(src) => setExpandedPhoto({ label: "Depois", src })} /> : null}
      </div> : null}
      {procedure.notes ? <div className="border-t border-[#ededf3] px-4 py-3 text-xs leading-5 text-[#656678]"><strong className="text-[#3f4053]">Observações: </strong>{procedure.notes}</div> : null}
      <Modal open={Boolean(expandedPhoto)} onClose={() => setExpandedPhoto(null)} title={`Foto de ${expandedPhoto?.label.toLowerCase() ?? "procedimento"}`} description="Visualização ampliada da foto do procedimento.">
        {expandedPhoto ? <div className="relative h-[min(70vh,620px)] w-full overflow-hidden rounded-[7px] bg-[#f7f8fc]"><Image className="object-contain" src={expandedPhoto.src} alt={`Foto ampliada de ${expandedPhoto.label.toLowerCase()}`} fill sizes="(max-width: 640px) 90vw, 560px" /></div> : null}
      </Modal>
    </Card>
  );
}

function ProcedureInfoPanel({ photoSessions, activePhotoSessionId, onSelectPhotoSession, onCreatePhotoSession, editable, afterPhotoEnabled = true, afterPhotoMessage, beforeSaving, afterSaving, beforeOperation, afterOperation, onBeforePhotoChange, onAfterPhotoChange, onBeforePhotoRemove, onAfterPhotoRemove, onBeforePreview, onAfterPreview }: { photoSessions: PatientPhotoSession[]; activePhotoSessionId?: string; onSelectPhotoSession: (sessionId: string) => void; onCreatePhotoSession: () => void; editable?: boolean; afterPhotoEnabled?: boolean; afterPhotoMessage?: string; beforeSaving?: boolean; afterSaving?: boolean; beforeOperation?: "upload" | "remove"; afterOperation?: "upload" | "remove"; onBeforePhotoChange?: (file: File) => void; onAfterPhotoChange?: (file: File) => void; onBeforePhotoRemove?: () => void; onAfterPhotoRemove?: () => void; onBeforePreview?: (src: string) => void; onAfterPreview?: (src: string) => void }) {
  const activePhotoSession = photoSessions.find((session) => session.id === activePhotoSessionId) ?? photoSessions[0];
  const beforeImage = activePhotoSession?.beforePhoto && activePhotoSession.beforePhoto !== "__photo__" ? activePhotoSession.beforePhoto : undefined;
  const afterImage = activePhotoSession?.afterPhoto && activePhotoSession.afterPhoto !== "__photo__" ? activePhotoSession.afterPhoto : undefined;

  return <aside className="h-fit rounded-[7px] border border-[#e7e9f2] bg-[#fafafd] p-3">
    <div className="flex items-center justify-between gap-2"><h4 className="text-xs font-bold text-[#303144]">Sessões de fotos</h4>{editable ? <button className="inline-flex items-center gap-1 rounded-[5px] px-2 py-1 text-[9px] font-bold text-[#5147dc] transition hover:bg-[#f0efff]" type="button" onClick={onCreatePhotoSession}><Plus className="h-3 w-3" />Nova sessão</button> : null}</div>
    <div className="mt-2 grid gap-1.5">{photoSessions.map((session, index) => <button className={cn("flex items-center justify-between gap-2 rounded-[5px] border px-2.5 py-2 text-left text-[10px] font-semibold transition", session.id === activePhotoSessionId ? "border-[#5147dc] bg-[#f0efff] text-[#5147dc]" : "border-[#e7e9f2] bg-white text-[#656678] hover:border-[#bdb9f7]")} type="button" key={session.id} onClick={() => onSelectPhotoSession(session.id)} aria-pressed={session.id === activePhotoSessionId}><span className="truncate">{session.name || `Sessão ${index + 1}`}</span><span className="shrink-0 text-[9px] text-[#858696]">{session.beforePhoto || session.afterPhoto ? "Com fotos" : "Vazia"}</span></button>)}</div>
    <div className="mt-4 border-t border-[#e7e9f2] pt-3"><div className="flex items-center justify-between gap-2"><h4 className="text-xs font-bold text-[#303144]">{activePhotoSession?.name ?? "Fotos"}</h4><span className="text-[9px] font-semibold text-[#858696]">Antes / depois</span></div><div className="mt-2 grid grid-cols-2 gap-2"><ProcedurePhotoThumbnail label="Antes" src={beforeImage} editable={editable} saving={beforeSaving} onPreview={onBeforePreview} onRemove={onBeforePhotoRemove} /><ProcedurePhotoThumbnail label="Depois" src={afterImage} editable={editable} saving={afterSaving} disabled={!afterPhotoEnabled} onPreview={onAfterPreview} onRemove={onAfterPhotoRemove} /></div>{editable ? <div className="mt-3 grid gap-2"><PhotoInput icon={Upload} label={beforeImage ? "Trocar foto antes" : "Adicionar foto antes"} busyLabel={beforeOperation === "remove" ? "Removendo..." : "Carregando..."} disabled={beforeSaving} onChange={onBeforePhotoChange} /><PhotoInput icon={Upload} label={afterImage ? "Trocar foto depois" : "Adicionar foto depois"} busyLabel={afterOperation === "remove" ? "Removendo..." : "Carregando..."} disabled={afterSaving || !afterPhotoEnabled} blocked={!afterPhotoEnabled && !afterSaving} onChange={onAfterPhotoChange} />{afterPhotoMessage && !afterPhotoEnabled ? <p className="text-[9px] font-semibold text-[#858696]">{afterPhotoMessage}</p> : null}</div> : null}</div>
  </aside>;
}

function ProcedurePhotoThumbnail({ label, src, editable, saving, disabled, onPreview, onRemove }: { label: string; src?: string; editable?: boolean; saving?: boolean; disabled?: boolean; onPreview?: (src: string) => void; onRemove?: () => void }) {
  return <div className="overflow-hidden rounded-[5px] border border-[#e7e9f2] bg-white"><div className="px-2 py-1.5 text-[9px] font-bold uppercase text-[#858696]">{label}</div><div className="relative aspect-[9/16] bg-[#f1f2f7]">{src ? <button className="absolute inset-0 cursor-zoom-in" type="button" onClick={() => onPreview?.(src)} aria-label={`Ampliar foto ${label.toLowerCase()}`}><Image className="object-cover" src={src} alt={`Miniatura da foto ${label.toLowerCase()}`} fill sizes="130px" /></button> : <span className="absolute inset-0 grid place-items-center px-2 text-center text-[9px] font-semibold text-[#858696]">Sem foto</span>}{editable && src ? <button className="absolute right-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded-full bg-[#25263a]/80 text-white transition hover:bg-[#b42318] disabled:cursor-not-allowed disabled:opacity-50" type="button" aria-label={`Remover foto ${label.toLowerCase()}`} disabled={saving || disabled} onClick={onRemove}><X className="h-3 w-3" /></button> : null}</div></div>;
}

function BeforeAfterComparison({ beforeSrc, afterSrc, beforeLabel, afterLabel, sliderPosition, comparisonRef, onPointerDown, onPointerMove, onPointerUp, onBeforePreview, onAfterPreview, editable, showControls = true, beforeSaving, afterSaving, beforeOperation, afterOperation, afterPhotoEnabled, afterPhotoMessage, onBeforePhotoChange, onAfterPhotoChange, onBeforePhotoRemove, onAfterPhotoRemove }: { beforeSrc?: string; afterSrc?: string; beforeLabel: string; afterLabel: string; sliderPosition: number; comparisonRef: RefObject<HTMLDivElement | null>; onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void; onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void; onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void; onBeforePreview: (src: string) => void; onAfterPreview: (src: string) => void; editable?: boolean; showControls?: boolean; beforeSaving?: boolean; afterSaving?: boolean; beforeOperation?: "upload" | "remove"; afterOperation?: "upload" | "remove"; afterPhotoEnabled?: boolean; afterPhotoMessage?: string; onBeforePhotoChange?: (file: File) => void; onAfterPhotoChange?: (file: File) => void; onBeforePhotoRemove?: () => void; onAfterPhotoRemove?: () => void }) {
  const beforeImage = beforeSrc && beforeSrc !== "__photo__" ? beforeSrc : undefined;
  const afterImage = afterSrc && afterSrc !== "__photo__" ? afterSrc : undefined;

  return (
    <div className="mx-auto w-full max-w-[460px]">
      <div ref={comparisonRef} className="relative aspect-[9/16] w-full cursor-ew-resize touch-none select-none overflow-hidden rounded-[7px] border border-[#e7e9f2] bg-[#f7f8fc]" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <ComparisonPhotoLayer src={afterImage} alt="Foto depois do procedimento" label={afterLabel} onPreview={onAfterPreview} />
        <div className="pointer-events-none absolute inset-0" style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}>
          <ComparisonPhotoLayer src={beforeImage} alt="Foto antes do procedimento" label={beforeLabel} onPreview={onBeforePreview} />
        </div>
        <div className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-white shadow-[0_0_0_1px_rgba(37,38,58,0.12)]" style={{ left: `${sliderPosition}%` }}>
          <span className="absolute left-1/2 top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-[#5147dc] text-white shadow-[0_5px_16px_rgba(37,38,58,0.28)]"><ArrowLeftRight className="h-4 w-4" /></span>
        </div>
      </div>
      {editable && showControls ? <ComparisonPhotoControls label="Antes" saving={beforeSaving} operation={beforeOperation} onPhotoChange={onBeforePhotoChange} onPhotoRemove={onBeforePhotoRemove} /> : null}
      {editable && showControls ? <ComparisonPhotoControls label="Depois" saving={afterSaving} operation={afterOperation} photoInputEnabled={afterPhotoEnabled} blockedMessage={afterPhotoMessage} onPhotoChange={onAfterPhotoChange} onPhotoRemove={onAfterPhotoRemove} /> : null}
    </div>
  );
}

function ComparisonPhotoLayer({ src, alt, label, onPreview }: { src?: string; alt: string; label: string; onPreview: (src: string) => void }) {
  return src ? <button className="absolute inset-0 h-full w-full cursor-zoom-in" type="button" aria-label={`Ampliar ${label.toLowerCase()}`} onClick={(event) => { event.stopPropagation(); onPreview(src); }}><Image className="object-cover" src={src} alt={alt} fill draggable={false} onDragStart={(event) => event.preventDefault()} sizes="(max-width: 640px) 90vw, 420px" /><span className="absolute bottom-3 left-3 rounded-full bg-white/90 px-2.5 py-1 text-[9px] font-bold text-[#303144] shadow-[0_3px_10px_rgba(37,38,58,0.12)]">{label}</span></button> : <div className="absolute inset-0 grid place-items-center px-4 text-center text-xs font-semibold text-[#858696]"><span>{label}<br />Nenhuma foto cadastrada</span></div>;
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
  return (
    <label className={cn("inline-flex h-7 flex-1 cursor-pointer items-center justify-center gap-1 rounded-full border border-[#dddfea] bg-white px-2 text-[9px] font-bold text-[#5147dc] transition hover:border-[#5147dc]", disabled && "pointer-events-none opacity-50")}>
      <Icon className="h-3 w-3" />
      {disabled && !blocked ? <><Loader2 className="h-3 w-3 animate-spin" />{busyLabel}</> : label}
      <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture={capture ? "environment" : undefined} disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) onChange?.(file); event.currentTarget.value = ""; }} />
    </label>
  );
}

function AppointmentsTab({ patientId, journeyId, history, loading, returnAppointmentTarget, onReturnAppointmentClose, onScheduleReturn }: { patientId: string; journeyId?: string; history?: PatientHistoryRecord; loading: boolean; returnAppointmentTarget: ReturnAppointmentTarget | null; onReturnAppointmentClose: () => void; onScheduleReturn: (procedure: ReturnAppointmentTarget, kind?: "return" | "procedure") => void }) {
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
      invalidateClientCache(`/api/patients/${patientId}/history`, "/api/appointments", "/api/agenda/bootstrap", "/api/dashboard/bootstrap");
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
          ...(editingAppointment?.id ? {} : { patientId, journeyId }),
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
                <div className="flex flex-wrap items-center justify-end gap-2"><Badge variant={appointment.status === "Atendido" ? "green" : appointment.status === "Em atendimento" ? "amber" : "purple"}>{appointment.status}</Badge>{appointment.status === "Agendado" && appointment.id ? <><Button className="h-8 px-2" type="button" variant="secondary" disabled={!appointmentCanStart(appointment, history?.appointmentToleranceMinutes ?? 15, currentTime)} onClick={() => void updateAppointmentStatus(appointment, "Em atendimento")} title={appointmentCanStart(appointment, history?.appointmentToleranceMinutes ?? 15, currentTime) ? "Iniciar atendimento" : "Aguarde o horário do atendimento"}>{updatingAppointmentId === appointment.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock3 className="h-3.5 w-3.5" />}{updatingAppointmentId === appointment.id ? "Atualizando..." : "Iniciar atendimento"}</Button><Button className="h-8 px-2" type="button" variant="secondary" aria-label="Editar retorno" title="Editar retorno" onClick={() => openEditAppointment(appointment)}><PencilLine className="h-3.5 w-3.5" /></Button></> : null}{appointment.status === "Em atendimento" && appointment.id ? <Button className="h-8 px-2" type="button" onClick={() => void updateAppointmentStatus(appointment, "Atendido")}><CheckCircle2 className="h-3.5 w-3.5" />{updatingAppointmentId === appointment.id ? "Atualizando..." : "Finalizar atendimento"}</Button> : null}</div>
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

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-[7px] bg-[#f7f8fc] px-3 py-2">
      <span className="text-[#77788a]">{label}</span>
      <strong className="text-[#303144]">{value}</strong>
    </div>
  );
}

function InfoBlock({ icon: Icon, label, value }: { icon: typeof Phone; label: string; value: string }) {
  return (
    <div className="rounded-[6px] border border-[#e9e9ef] bg-[#fbfbfd] p-3">
      <p className="flex items-center gap-2 text-[9px] font-bold uppercase text-[#9697a7]"><Icon className="h-3.5 w-3.5 text-[#5147dc]" />{label}</p>
      <p className="mt-2 text-xs font-semibold text-[#4f5062]">{value}</p>
    </div>
  );
}
