"use client";

import Image from "next/image";
import { type FormEvent, useEffect, useState } from "react";
import {
  ArrowLeft,
  CalendarPlus,
  CalendarDays,
  CheckCircle2,
  Camera,
  Clock3,
  CreditCard,
  FileText,
  Loader2,
  MapPin,
  PencilLine,
  Phone,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import type { CustomerJourneyStage, Patient } from "@/types/clinic";
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
import { getCachedJson, invalidateClientCache } from "@/lib/client-cache";
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
  notes?: string;
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

type ReturnAppointmentTarget = Pick<PatientProcedureRecord, "name" | "professional">;

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
  const [activeTab, setActiveTab] = useState("Avaliação");
  const [history, setHistory] = useState<PatientHistoryRecord>();
  const [historyLoadedKey, setHistoryLoadedKey] = useState("");
  const [returnAppointmentTarget, setReturnAppointmentTarget] = useState<ReturnAppointmentTarget | null>(null);
  const [evaluationCompleted, setEvaluationCompleted] = useState(false);
  const [quoteCompleted, setQuoteCompleted] = useState(false);
  const [procedurePhotos, setProcedurePhotos] = useState({ before: false, after: false });
  const initials = currentPatient.name.split(" ").map((part) => part[0]).slice(0, 2).join("");
  const evaluationStageCompleted = evaluationCompleted || quoteCompleted || journey.some((stage) => ["quote", "procedure", "return", "aftercare"].includes(stage.id) && ["completed", "current"].includes(stage.status));
  const procedureRecord = history?.procedures[0];
  const hasBeforePhoto = procedurePhotos.before || Boolean(procedureRecord?.beforePhoto);
  const hasAfterPhoto = procedurePhotos.after || Boolean(procedureRecord?.afterPhoto);
  const visibleJourney = journey.map((stage) => {
    if (stage.id === "evaluation" && evaluationStageCompleted) return { ...stage, status: "completed" as const };
    if (stage.id === "quote" && quoteCompleted) return { ...stage, status: "completed" as const };
    if (stage.id === "procedure" && (quoteCompleted || hasBeforePhoto || hasAfterPhoto)) {
      if (hasAfterPhoto) return { ...stage, status: "completed" as const };
      if (hasBeforePhoto) return { ...stage, status: "in_progress" as const };
      return { ...stage, status: "pending" as const };
    }
    if (stage.id === "return" && hasAfterPhoto && stage.status === "pending") return { ...stage, status: "current" as const };
    if (stage.id === "aftercare" && !hasAfterPhoto) return { ...stage, status: "pending" as const };
    return stage;
  });

  useEffect(() => {
    if (!patient.id) return;
    const historyLoadKey = `${patient.id}:${activeTab}`;
    let cancelled = false;
    getCachedJson<{ patient?: { appointmentToleranceMinutes?: number; appointments: Array<{ id: string; date: string; time: string; procedure: string; professional: string; status: string; notes: string }>; payments: Array<{ id: string; value: number; method: string; status: string; installments: string }>; quotes: Array<{ items: string; status: string }>; procedureRecords: Array<{ id: string; name: string; professional: string; performedAt: string; notes: string; beforePhoto: string | null; afterPhoto: string | null }>; evaluations: Array<{ photos: unknown[] }> } }>(`/api/patients/${patient.id}/history`)
      .then((data) => {
        if (cancelled) return;
        const appointments = data.patient?.appointments ?? [];
        const payments = data.patient?.payments ?? [];
        const latestQuoteItems = data.patient?.quotes?.[0]?.items;
        const useQuoteTitle = Boolean(latestQuoteItems && data.patient?.procedureRecords?.length === 1);
        setEvaluationCompleted(data.patient?.evaluations?.some((evaluation) => evaluation.photos?.length > 0) ?? false);
        const latestProcedure = data.patient?.procedureRecords?.[0];
        setProcedurePhotos({ before: Boolean(latestProcedure?.beforePhoto), after: Boolean(latestProcedure?.afterPhoto) });
        setHistory({
          appointments: appointments.map((item) => ({ id: item.id, date: new Date(item.date).toLocaleDateString("pt-BR"), time: item.time, procedure: item.procedure, professional: item.professional, status: item.status, notes: item.notes })),
          appointmentToleranceMinutes: data.patient?.appointmentToleranceMinutes ?? 15,
          procedures: data.patient?.procedureRecords?.length ? data.patient.procedureRecords.map((item) => ({ id: item.id, name: useQuoteTitle ? latestQuoteItems ?? item.name : item.name, date: new Date(item.performedAt).toLocaleDateString("pt-BR"), professional: item.professional, status: procedurePhotoStatus(item.beforePhoto, item.afterPhoto), beforePhoto: item.beforePhoto ?? "", afterPhoto: item.afterPhoto ?? "", notes: item.notes.startsWith("__quote:") ? "" : item.notes })) : appointments.filter((item) => ["Atendido", "Finalizado"].includes(item.status)).map((item) => ({ name: item.procedure, date: new Date(item.date).toLocaleDateString("pt-BR"), professional: item.professional, status: item.status, beforePhoto: "", afterPhoto: "" })),
          payments: payments.map((item) => ({ id: item.id, procedure: "Atendimento", value: new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(item.value), method: item.method, status: item.status, disabled: item.status === "Pago", disabledReason: item.status === "Pago" ? "Pagamento já finalizado" : undefined })),
          observations: [],
        });
      })
      .catch(() => { if (!cancelled) setHistory(undefined); })
      .finally(() => { if (!cancelled) setHistoryLoadedKey(historyLoadKey); });
    getCachedJson<{ quotes?: Array<{ status: string }> }>(`/api/quotes?patientId=${encodeURIComponent(patient.id)}`)
      .then((data) => { if (!cancelled) setQuoteCompleted(data.quotes?.some((quote) => ["Pago", "Aprovado"].includes(quote.status)) ?? false); })
      .catch(() => { if (!cancelled) setQuoteCompleted(false); });
    return () => { cancelled = true; };
  }, [patient.id, activeTab]);

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
          <CustomerJourney
            compact
            journey={visibleJourney}
            onOpenStage={(stageId) => {
              const stageTabs = {
                lead: "Dados",
                evaluation: "Avaliação",
                quote: "Orçamento",
                procedure: "Procedimentos",
                return: "Agendamentos",
                aftercare: "Observações",
              } as const;
              setActiveTab(stageTabs[stageId]);
            }}
          />
        </div>
      </Card>

      <Card className="overflow-x-auto p-0">
        <div className="flex min-w-max px-2">
          {tabs.map((tab) => (
            <button
              className={cn(
                "border-b-2 px-5 py-3 text-[10px] font-semibold transition-colors",
                activeTab === tab
                  ? "border-[#5147dc] bg-[#faf9ff] text-[#5147dc]"
                  : "border-transparent text-[#77788a] hover:bg-[#faf9ff] hover:text-[#5147dc]",
              )}
              key={tab}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
      </Card>

      {activeTab === "Orçamento" ? (
        <PatientExpenses patientId={currentPatient.id ?? ""} onPaid={() => setQuoteCompleted(true)} />
      ) : (
        <PatientTabContent patient={currentPatient} activeTab={activeTab} history={history} historyLoading={historyLoadedKey !== `${currentPatient.id}:${activeTab}`} returnAppointmentTarget={returnAppointmentTarget} onReturnAppointmentClose={() => setReturnAppointmentTarget(null)} onEvaluationSaved={() => setEvaluationCompleted(true)} onPatientUpdated={setCurrentPatient} onProcedurePhotosChange={(before, after) => setProcedurePhotos({ before, after })} onProcedurePhotoUpdated={(procedureId, photo) => setHistory((current) => current ? { ...current, procedures: current.procedures.map((item) => item.id === procedureId ? { ...item, beforePhoto: photo.beforePhoto ?? "", afterPhoto: photo.afterPhoto ?? "", status: procedurePhotoStatus(photo.beforePhoto, photo.afterPhoto) } : item) } : current)} onScheduleReturn={(procedure) => { setReturnAppointmentTarget(procedure); setActiveTab("Agendamentos"); }} />
      )}
    </div>
  );
}

function PatientTabContent({ patient, activeTab, history, historyLoading, returnAppointmentTarget, onReturnAppointmentClose, onEvaluationSaved, onPatientUpdated, onProcedurePhotosChange, onProcedurePhotoUpdated, onScheduleReturn }: { patient: Patient; activeTab: string; history?: PatientHistoryRecord; historyLoading: boolean; returnAppointmentTarget: ReturnAppointmentTarget | null; onReturnAppointmentClose: () => void; onEvaluationSaved: () => void; onPatientUpdated: (patient: Patient) => void; onProcedurePhotosChange: (before: boolean, after: boolean) => void; onProcedurePhotoUpdated: (procedureId: string, photo: { beforePhoto: string | null; afterPhoto: string | null }) => void; onScheduleReturn: (procedure: ReturnAppointmentTarget) => void }) {

  if (activeTab === "Avaliação") {
    return patient.id ? <PhotoEditor patientId={patient.id} patientName={patient.name} onSaved={onEvaluationSaved} /> : <EmptyState title="Cliente ainda não foi salvo" description="Salve o cliente antes de adicionar fotos à avaliação." />;
  }

  if (activeTab === "Histórico") {
    return <HistoryTab patient={patient} history={history} />;
  }

  if (activeTab === "Procedimentos") {
    return <ProceduresTab patientId={patient.id ?? ""} history={history} loading={historyLoading} onProcedurePhotosChange={onProcedurePhotosChange} onProcedurePhotoUpdated={onProcedurePhotoUpdated} onScheduleReturn={onScheduleReturn} />;
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

function HistoryTab({ patient, history }: { patient: Patient; history?: PatientHistoryRecord }) {
  if (!history || (!history.procedures.length && !history.appointments.length && !history.payments.length && !history.observations.length)) {
    return <EmptyPatientState message={`${patient.name} ainda não possui um histórico.`} />;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#5147dc]" />
          <h3 className="text-sm font-bold text-[#303144]">Histórico do cliente</h3>
        </div>
        <div className="mt-5 space-y-3">
          {history.procedures.map((procedure) => (
            <ProcedureHistoryCard key={`${procedure.name}-${procedure.date}`} procedure={procedure} />
          ))}
          {!history.procedures.length ? <EmptyInline text="Cliente ainda não realizou procedimentos." /> : null}
        </div>
      </Card>
      <Card className="p-5">
        <p className="text-[9px] font-bold uppercase text-[#a0a1af]">Resumo</p>
        <div className="mt-4 grid gap-3 text-xs">
          <SummaryLine label="Procedimentos feitos" value={String(history.procedures.length)} />
          <SummaryLine label="Agendamentos" value={String(history.appointments.length)} />
          <SummaryLine label="Pagamentos registrados" value={String(history.payments.filter((payment) => !payment.disabled).length)} />
          <SummaryLine label="Observações" value={String(history.observations.length)} />
        </div>
      </Card>
    </div>
  );
}

function ProceduresTab({ patientId, history, loading, onProcedurePhotosChange, onProcedurePhotoUpdated, onScheduleReturn }: { patientId: string; history?: PatientHistoryRecord; loading: boolean; onProcedurePhotosChange: (before: boolean, after: boolean) => void; onProcedurePhotoUpdated: (procedureId: string, photo: { beforePhoto: string | null; afterPhoto: string | null }) => void; onScheduleReturn: (procedure: ReturnAppointmentTarget) => void }) {
  const [procedures, setProcedures] = useState<PatientProcedureRecord[]>(history?.procedures ?? []);
  const [photoOperations, setPhotoOperations] = useState<Record<string, "upload" | "remove">>({});
  const [error, setError] = useState("");

  const visibleProcedures = history ? (procedures.length ? procedures : history.procedures) : [];
  const primaryProcedure = visibleProcedures[0];
  const returnScheduled = Boolean(history?.appointments.some((appointment) => appointment.procedure.toLocaleLowerCase("pt-BR").includes("retorno")));

  async function updateProcedurePhoto(procedureId: string | undefined, photoType: "beforePhoto" | "afterPhoto", photo: string | null, operation: "upload" | "remove" = "upload") {
    if (!procedureId) return;
    const operationKey = `${procedureId}-${photoType}`;
    setPhotoOperations((current) => ({ ...current, [operationKey]: operation }));
    setError("");
    try {
      const response = await fetch(`/api/patients/${patientId}/procedures/${procedureId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoType, photo }),
      });
      const data = await response.json() as { procedure?: { beforePhoto: string | null; afterPhoto: string | null }; message?: string };
      if (!response.ok || !data.procedure) throw new Error(data.message ?? "Não foi possível atualizar a foto.");
      setProcedures((current) => (current.length ? current : history?.procedures ?? []).map((item) => item.id === procedureId ? { ...item, beforePhoto: data.procedure?.beforePhoto ?? "", afterPhoto: data.procedure?.afterPhoto ?? "", status: procedurePhotoStatus(data.procedure?.beforePhoto ?? null, data.procedure?.afterPhoto ?? null) } : item));
      onProcedurePhotosChange(Boolean(data.procedure.beforePhoto), Boolean(data.procedure.afterPhoto));
      onProcedurePhotoUpdated(procedureId, data.procedure);
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

  async function saveProcedurePhoto(procedureId: string | undefined, photoType: "beforePhoto" | "afterPhoto", file: File) {
    const photo = await readProcedurePhoto(file);
    if (!photo) {
      setError("Selecione uma imagem JPG, PNG ou WEBP válida.");
      return;
    }
    await updateProcedurePhoto(procedureId, photoType, photo);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4"><div><h3 className="text-sm font-bold text-[#303144]">Procedimentos realizados</h3><p className="mt-1 text-[10px] text-[#858696]">Os procedimentos aparecem aqui automaticamente a partir do orçamento aprovado. Adicione as fotos de antes e depois no atendimento.</p></div><Button className={cn("shrink-0", returnScheduled && "border-[#b9e8d8] bg-[#eaf8ef] text-[#16805d] hover:border-[#b9e8d8] hover:bg-[#eaf8ef] hover:text-[#16805d]")} type="button" variant="secondary" disabled={!primaryProcedure || primaryProcedure.status !== "Realizado" || returnScheduled} onClick={() => { if (primaryProcedure) onScheduleReturn(primaryProcedure); }}><CalendarPlus className="h-3.5 w-3.5" />{returnScheduled ? "Retorno marcado" : "Marcar retorno"}</Button></div>
      {loading ? <ProcedureCardsSkeleton /> : !visibleProcedures.length ? <EmptyPatientState message="Este cliente ainda não possui procedimentos realizados." /> : <div className="grid gap-4 xl:grid-cols-2">{visibleProcedures.map((procedure) => {
        const beforeKey = `${procedure.id}-beforePhoto`;
        const afterKey = `${procedure.id}-afterPhoto`;
        return <ProcedureHistoryCard key={procedure.id ?? `${procedure.name}-${procedure.date}`} procedure={procedure} editable beforePhotoSaving={Boolean(photoOperations[beforeKey])} afterPhotoSaving={Boolean(photoOperations[afterKey])} beforePhotoOperation={photoOperations[beforeKey]} afterPhotoOperation={photoOperations[afterKey]} onPhotoChange={saveProcedurePhoto} onPhotoRemove={(procedureId, photoType) => updateProcedurePhoto(procedureId, photoType, null, "remove")} />;
      })}</div>}
      {error ? <p className="rounded-[7px] bg-[#fff1f0] px-3 py-2 text-xs font-semibold text-[#b42318]">{error}</p> : null}
    </div>
  );
}

function ProcedureCardsSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-2" aria-label="Carregando procedimentos">
      {[0, 1].map((item) => (
        <Card className="animate-pulse overflow-hidden p-0" key={item}>
          <div className="flex items-start justify-between gap-3 border-b border-[#ededf3] p-4">
            <div className="space-y-2"><div className="h-4 w-32 rounded bg-[#ececf3]" /><div className="h-3 w-44 rounded bg-[#f1f1f6]" /></div>
            <div className="h-6 w-20 rounded-full bg-[#f0efff]" />
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            {[0, 1].map((photo) => <div className="overflow-hidden rounded-[7px] border border-[#e7e9f2]" key={photo}><div className="h-7 border-b border-[#e7e9f2] bg-[#fafafd]" /><div className="h-56 bg-[#f1f2f7] sm:h-64" /></div>)}
          </div>
        </Card>
      ))}
    </div>
  );
}

async function readProcedurePhoto(value: FormDataEntryValue | null) {
  if (!(value instanceof File) || !value.size) return null;
  if (!["image/jpeg", "image/png", "image/webp"].includes(value.type)) return null;
  return new Promise<string | null>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null); reader.onerror = () => resolve(null); reader.readAsDataURL(value); });
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

function appointmentCanStart(appointment: PatientAppointmentRecord, toleranceMinutes: number, now: { date: string; time: string }) {
  const [day, month, year] = appointment.date.split("/");
  const appointmentDate = `${year}-${month}-${day}`;
  if (appointmentDate !== now.date) return false;
  const [hours, minutes] = appointment.time.split(":").map(Number);
  const startMinutes = hours * 60 + minutes;
  const nowMinutes = Number(now.time.slice(0, 2)) * 60 + Number(now.time.slice(3));
  return nowMinutes >= startMinutes && nowMinutes < startMinutes + toleranceMinutes;
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

function ProcedureHistoryCard({ procedure, editable, beforePhotoSaving, afterPhotoSaving, beforePhotoOperation, afterPhotoOperation, onPhotoChange, onPhotoRemove }: { procedure: PatientProcedureRecord; editable?: boolean; beforePhotoSaving?: boolean; afterPhotoSaving?: boolean; beforePhotoOperation?: "upload" | "remove"; afterPhotoOperation?: "upload" | "remove"; onPhotoChange?: (procedureId: string | undefined, photoType: "beforePhoto" | "afterPhoto", file: File) => void; onPhotoRemove?: (procedureId: string | undefined, photoType: "beforePhoto" | "afterPhoto") => void }) {
  const [expandedPhoto, setExpandedPhoto] = useState<{ label: string; src: string } | null>(null);

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-start justify-between gap-3 border-b border-[#ededf3] p-4">
        <div>
          <h3 className="text-sm font-bold text-[#303144]">{procedure.name}</h3>
          <p className="mt-1 text-xs text-[#858696]">{procedure.date} · {procedure.professional}</p>
        </div>
        <Badge variant={procedure.status === "Realizado" ? "green" : procedure.status === "Em procedimento" ? "amber" : "slate"}>{procedure.status}</Badge>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <BeforeAfterPhoto label="Antes" src={procedure.beforePhoto} editable={editable && Boolean(procedure.id)} saving={beforePhotoSaving} operation={beforePhotoOperation} onPhotoChange={(file) => onPhotoChange?.(procedure.id, "beforePhoto", file)} onPhotoRemove={() => onPhotoRemove?.(procedure.id, "beforePhoto")} onPreview={(src) => setExpandedPhoto({ label: "Antes", src })} />
        <BeforeAfterPhoto label="Depois" src={procedure.afterPhoto} editable={editable && Boolean(procedure.id)} saving={afterPhotoSaving} operation={afterPhotoOperation} onPhotoChange={(file) => onPhotoChange?.(procedure.id, "afterPhoto", file)} onPhotoRemove={() => onPhotoRemove?.(procedure.id, "afterPhoto")} onPreview={(src) => setExpandedPhoto({ label: "Depois", src })} />
      </div>
      {procedure.notes ? <div className="border-t border-[#ededf3] px-4 py-3 text-xs leading-5 text-[#656678]"><strong className="text-[#3f4053]">Observações: </strong>{procedure.notes}</div> : null}
      <Modal open={Boolean(expandedPhoto)} onClose={() => setExpandedPhoto(null)} title={`Foto de ${expandedPhoto?.label.toLowerCase() ?? "procedimento"}`} description="Visualização ampliada da foto do procedimento.">
        {expandedPhoto ? <div className="relative h-[min(70vh,620px)] w-full overflow-hidden rounded-[7px] bg-[#f7f8fc]"><Image className="object-contain" src={expandedPhoto.src} alt={`Foto ampliada de ${expandedPhoto.label.toLowerCase()}`} fill sizes="(max-width: 640px) 90vw, 560px" /></div> : null}
      </Modal>
    </Card>
  );
}

function BeforeAfterPhoto({ label, src, editable, saving, operation, onPhotoChange, onPhotoRemove, onPreview }: { label: string; src?: string; editable?: boolean; saving?: boolean; operation?: "upload" | "remove"; onPhotoChange?: (file: File) => void; onPhotoRemove?: () => void; onPreview?: (src: string) => void }) {
  return (
    <div className="overflow-hidden rounded-[7px] border border-[#e7e9f2] bg-[#f7f8fc]">
      <div className="flex items-center gap-2 px-3 py-2 text-[9px] font-bold uppercase text-[#858696]">
        <Camera className="h-3.5 w-3.5 text-[#5147dc]" />
        {label}
      </div>
      <div className="relative grid h-56 w-full place-items-center text-xs font-semibold text-[#858696] sm:h-64">
        {saving ? <div className="flex flex-col items-center gap-2 text-[#5147dc]" aria-label={`${operation === "remove" ? "Removendo" : "Carregando"} foto de ${label.toLowerCase()}`}>
          <div className="h-12 w-16 animate-pulse rounded-[5px] bg-[#e8e8f8]" />
          <span className="flex items-center gap-1 text-xs font-bold"><Loader2 className="h-3.5 w-3.5 animate-spin" />{operation === "remove" ? "Removendo foto..." : "Carregando foto..."}</span>
        </div> : src ? <>
          <button type="button" className="absolute inset-0 cursor-zoom-in" aria-label={`Ampliar foto de ${label.toLowerCase()}`} onClick={() => onPreview?.(src)}><Image className="object-cover transition-transform duration-200 hover:scale-[1.02]" src={src} alt={`Foto de ${label.toLowerCase()} do procedimento`} fill sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 400px" /></button>
          {editable ? <button type="button" className="absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-full bg-[#25263a]/80 text-white transition hover:bg-[#b42318] disabled:cursor-not-allowed disabled:opacity-50" aria-label={`Remover foto de ${label.toLowerCase()}`} disabled={saving} onClick={onPhotoRemove}><X className="h-3.5 w-3.5" /></button> : null}
        </> : "Nenhuma foto cadastrada"}
      </div>
      {editable ? <div className="flex gap-2 border-t border-[#e7e9f2] bg-white p-2">
        <PhotoInput icon={Upload} label={src ? "Trocar foto" : "Enviar foto"} busyLabel={operation === "remove" ? "Removendo..." : "Carregando..."} disabled={saving} onChange={onPhotoChange} />
        <PhotoInput icon={Camera} label="Tirar foto" busyLabel={operation === "remove" ? "Removendo..." : "Carregando..."} capture disabled={saving} onChange={onPhotoChange} />
      </div> : null}
    </div>
  );
}

function PhotoInput({ icon: Icon, label, busyLabel, capture, disabled, onChange }: { icon: typeof Camera; label: string; busyLabel: string; capture?: boolean; disabled?: boolean; onChange?: (file: File) => void }) {
  return (
    <label className={cn("inline-flex h-7 flex-1 cursor-pointer items-center justify-center gap-1 rounded-full border border-[#dddfea] bg-white px-2 text-[9px] font-bold text-[#5147dc] transition hover:border-[#5147dc]", disabled && "pointer-events-none opacity-50")}>
      <Icon className="h-3 w-3" />
      {disabled ? <><Loader2 className="h-3 w-3 animate-spin" />{busyLabel}</> : label}
      <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture={capture ? "environment" : undefined} disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) onChange?.(file); event.currentTarget.value = ""; }} />
    </label>
  );
}

function AppointmentsTab({ patientId, history, loading, returnAppointmentTarget, onReturnAppointmentClose, onScheduleReturn }: { patientId: string; history?: PatientHistoryRecord; loading: boolean; returnAppointmentTarget: ReturnAppointmentTarget | null; onReturnAppointmentClose: () => void; onScheduleReturn: (procedure: ReturnAppointmentTarget) => void }) {
  const [returnDate, setReturnDate] = useState(() => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [returnTime, setReturnTime] = useState("09:00");
  const [returnReason, setReturnReason] = useState(() => returnAppointmentTarget ? `Retorno - ${returnAppointmentTarget.name}` : "");
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
          ...(editingAppointment?.id ? {} : { patientId }),
          procedure: returnReason.trim(),
          professional: editingAppointment?.professional ?? returnAppointmentTarget?.professional,
          date: `${returnDate}T${returnTime}:00`,
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
      <div className="flex items-start justify-between gap-4"><div><h3 className="text-sm font-bold text-[#303144]">Agendamentos do cliente</h3><p className="mt-1 text-[10px] text-[#858696]">Acompanhe os atendimentos e agende o próximo retorno.</p></div><Button className={cn("shrink-0", returnScheduled && "border-[#b9e8d8] bg-[#eaf8ef] text-[#16805d] hover:border-[#b9e8d8] hover:bg-[#eaf8ef] hover:text-[#16805d]")} type="button" variant="secondary" disabled={!primaryProcedure || primaryProcedure.status !== "Realizado" || returnScheduled} onClick={() => { if (primaryProcedure) onScheduleReturn(primaryProcedure); }}><CalendarPlus className="h-3.5 w-3.5" />{returnScheduled ? "Retorno marcado" : "Marcar retorno"}</Button></div>
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
      <Modal open={Boolean(returnAppointmentTarget || editingAppointment)} onClose={() => { if (!returnSaving) { setEditingAppointment(null); onReturnAppointmentClose(); } }} title={editingAppointment ? "Editar retorno" : "Marcar retorno"} description={editingAppointment ? "Atualize os dados do retorno agendado." : "O retorno será incluído na lista de agendamentos da clínica."}>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveReturnAppointment}>
          <div className="sm:col-span-2 rounded-[7px] border border-[#e8e8ef] bg-[#fafafd] p-3 text-xs text-[#555668]">Procedimento: <strong className="text-[#303144]">{editingAppointment?.procedure ?? returnAppointmentTarget?.name}</strong></div>
          <FormField label="Data"><input className={cn(fieldClassName, invalidReturnFields.has("date") && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} type="date" value={returnDate} required onChange={(event) => { setReturnDate(event.target.value); setInvalidReturnFields((current) => { const next = new Set(current); next.delete("date"); return next; }); setReturnError(""); }} /></FormField>
          <FormField label="Horário"><input className={cn(fieldClassName, invalidReturnFields.has("time") && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} type="time" value={returnTime} required onChange={(event) => { setReturnTime(event.target.value); setInvalidReturnFields((current) => { const next = new Set(current); next.delete("time"); return next; }); setReturnError(""); }} /></FormField>
          <div className="sm:col-span-2"><FormField label="Motivo do retorno"><input className={fieldClassName} value={returnReason} required placeholder="Ex.: avaliação do resultado" onChange={(event) => setReturnReason(event.target.value)} /></FormField></div>
          <div className="sm:col-span-2"><FormField label="Observações"><textarea className={`${fieldClassName} h-24 resize-none py-2`} value={returnNotes} placeholder="Adicione informações importantes para o atendimento" onChange={(event) => setReturnNotes(event.target.value)} /></FormField></div>
          {returnError ? <p className="rounded-[7px] bg-[#fff1f0] px-3 py-2 text-xs font-semibold text-[#b42318] sm:col-span-2">{returnError}</p> : null}
          <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" disabled={returnSaving} onClick={() => { setEditingAppointment(null); onReturnAppointmentClose(); }}>Cancelar</Button><Button type="submit" disabled={returnSaving}>{returnSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : editingAppointment ? <PencilLine className="h-3.5 w-3.5" /> : <CalendarPlus className="h-3.5 w-3.5" />}{returnSaving ? "Salvando..." : editingAppointment ? "Salvar alterações" : "Confirmar retorno"}</Button></div>
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
