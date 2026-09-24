"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Camera,
  Clock3,
  CreditCard,
  FileText,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import type { CustomerJourneyStage, Patient } from "@/types/clinic";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { CustomerJourney } from "./customer-journey";
import { PatientExpenses } from "./patient-expenses";
import { PhotoEditor } from "./photo-editor/photo-editor";
import { EmptyState } from "./shared";
import { getCachedJson, invalidateClientCache } from "@/lib/client-cache";

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
  date: string;
  time: string;
  procedure: string;
  professional: string;
  status: string;
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
  observations: string[];
  payments: PatientPaymentRecord[];
};

export function PatientDetail({
  patient,
  journey,
  onBack,
}: {
  patient: Patient;
  journey: CustomerJourneyStage[];
  onBack: () => void;
}) {
  const [activeTab, setActiveTab] = useState("Avaliação");
  const [history, setHistory] = useState<PatientHistoryRecord>();
  const [historyLoadedKey, setHistoryLoadedKey] = useState("");
  const [evaluationCompleted, setEvaluationCompleted] = useState(false);
  const [quoteCompleted, setQuoteCompleted] = useState(false);
  const [procedurePhotos, setProcedurePhotos] = useState({ before: false, after: false });
  const initials = patient.name.split(" ").map((part) => part[0]).slice(0, 2).join("");
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
    getCachedJson<{ patient?: { appointments: Array<{ date: string; time: string; procedure: string; professional: string; status: string }>; payments: Array<{ id: string; value: number; method: string; status: string; installments: string }>; quotes: Array<{ items: string; status: string }>; procedureRecords: Array<{ id: string; name: string; professional: string; performedAt: string; notes: string; beforePhoto: string | null; afterPhoto: string | null }>; evaluations: Array<{ photos: unknown[] }> } }>(`/api/patients/${patient.id}/history`)
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
          appointments: appointments.map((item) => ({ date: new Date(item.date).toLocaleDateString("pt-BR"), time: item.time, procedure: item.procedure, professional: item.professional, status: item.status })),
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
            <h2 className="truncate text-lg font-bold text-[#242538]">{patient.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[#77788a]">
              <span className="flex items-center gap-1.5"><Phone className="h-3 w-3" />{patient.phone}</span>
              <span>{patient.age} anos</span>
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
                lead: "Histórico",
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
                "border-b-2 px-5 py-3 text-[10px] font-semibold transition",
                activeTab === tab
                  ? "border-[#5147dc] bg-[#faf9ff] text-[#5147dc]"
                  : "border-transparent text-[#77788a] hover:text-[#4f5062]",
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
        <PatientExpenses patientId={patient.id ?? ""} onPaid={() => setQuoteCompleted(true)} />
      ) : (
        <PatientTabContent patient={patient} activeTab={activeTab} history={history} historyLoading={historyLoadedKey !== `${patient.id}:${activeTab}`} onEvaluationSaved={() => setEvaluationCompleted(true)} onProcedurePhotosChange={(before, after) => setProcedurePhotos({ before, after })} onProcedurePhotoUpdated={(procedureId, photo) => setHistory((current) => current ? { ...current, procedures: current.procedures.map((item) => item.id === procedureId ? { ...item, beforePhoto: photo.beforePhoto ?? "", afterPhoto: photo.afterPhoto ?? "", status: procedurePhotoStatus(photo.beforePhoto, photo.afterPhoto) } : item) } : current)} />
      )}
    </div>
  );
}

function PatientTabContent({ patient, activeTab, history, historyLoading, onEvaluationSaved, onProcedurePhotosChange, onProcedurePhotoUpdated }: { patient: Patient; activeTab: string; history?: PatientHistoryRecord; historyLoading: boolean; onEvaluationSaved: () => void; onProcedurePhotosChange: (before: boolean, after: boolean) => void; onProcedurePhotoUpdated: (procedureId: string, photo: { beforePhoto: string | null; afterPhoto: string | null }) => void }) {

  if (activeTab === "Avaliação") {
    return patient.id ? <PhotoEditor patientId={patient.id} patientName={patient.name} onSaved={onEvaluationSaved} /> : <EmptyState title="Cliente ainda não foi salvo" description="Salve o cliente antes de adicionar fotos à avaliação." />;
  }

  if (activeTab === "Histórico") {
    return <HistoryTab patient={patient} history={history} />;
  }

  if (activeTab === "Procedimentos") {
    return <ProceduresTab patientId={patient.id ?? ""} history={history} loading={historyLoading} onProcedurePhotosChange={onProcedurePhotosChange} onProcedurePhotoUpdated={onProcedurePhotoUpdated} />;
  }

  if (activeTab === "Agendamentos") {
    return <AppointmentsTab history={history} />;
  }

  if (activeTab === "Observações") {
    return <ObservationsTab history={history} />;
  }

  if (activeTab === "Pagamentos") {
    return <PaymentsTab history={history} />;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#5147dc]" />
          <h3 className="text-sm font-bold text-[#303144]">{activeTab}</h3>
        </div>
        <p className="mt-2 text-xs leading-5 text-[#858696]">Informações de {activeTab.toLowerCase()} vinculadas ao prontuário de {patient.name}.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <InfoBlock icon={Phone} label="Telefone" value={patient.phone} />
          <InfoBlock icon={Mail} label="E-mail" value={`${patient.name.toLowerCase().replaceAll(" ", ".")}@email.com`} />
          <InfoBlock icon={CalendarDays} label="Último atendimento" value={patient.lastVisit} />
          <InfoBlock icon={Clock3} label="Próximo retorno" value={patient.nextReturn} />
        </div>
      </Card>
      <Card className="p-5">
        <p className="text-[9px] font-bold uppercase text-[#a0a1af]">Resumo da cliente</p>
        <div className="mt-4 space-y-4 text-xs text-[#555668]">
          <p className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-[#5147dc]" />São Paulo, SP</p>
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

function ProceduresTab({ patientId, history, loading, onProcedurePhotosChange, onProcedurePhotoUpdated }: { patientId: string; history?: PatientHistoryRecord; loading: boolean; onProcedurePhotosChange: (before: boolean, after: boolean) => void; onProcedurePhotoUpdated: (procedureId: string, photo: { beforePhoto: string | null; afterPhoto: string | null }) => void }) {
  const [procedures, setProcedures] = useState<PatientProcedureRecord[]>(history?.procedures ?? []);
  const [photoOperations, setPhotoOperations] = useState<Record<string, "upload" | "remove">>({});
  const [error, setError] = useState("");

  const visibleProcedures = history ? (procedures.length ? procedures : history.procedures) : [];

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
      <div><h3 className="text-sm font-bold text-[#303144]">Procedimentos realizados</h3><p className="mt-1 text-[10px] text-[#858696]">Os procedimentos aparecem aqui automaticamente a partir do orçamento aprovado. Adicione as fotos de antes e depois no atendimento.</p></div>
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

function AppointmentsTab({ history }: { history?: PatientHistoryRecord }) {
  if (!history?.appointments.length) return <EmptyPatientState message="Este cliente ainda não possui agendamentos registrados." />;

  return (
    <Card className="p-5">
      <h3 className="text-sm font-bold text-[#303144]">Agendamentos do cliente</h3>
      <div className="mt-4 space-y-3">
        {history.appointments.map((appointment) => (
          <div className="flex flex-col gap-3 rounded-[7px] border border-[#ececf3] p-4 sm:flex-row sm:items-center sm:justify-between" key={`${appointment.date}-${appointment.time}`}>
            <div>
              <p className="text-sm font-bold text-[#303144]">{appointment.procedure}</p>
              <p className="mt-1 text-xs text-[#858696]">{appointment.date} às {appointment.time} · {appointment.professional}</p>
            </div>
            <Badge variant={appointment.status === "Atendido" ? "green" : "purple"}>{appointment.status}</Badge>
          </div>
        ))}
      </div>
    </Card>
  );
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
