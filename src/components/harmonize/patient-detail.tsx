"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, type PointerEvent as ReactPointerEvent, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowLeftRight,
  CalendarPlus,
  CalendarDays,
  CheckCircle2,
  Camera,
  ChevronDown,
  Clock3,
  ClipboardList,
  Columns2,
  CreditCard,
  FolderOpen,
  ChevronRight,
  Eye,
  EyeOff,
  FileText,
  Filter,
  Loader2,
  LayoutDashboard,
  MessageSquare,
  Paperclip,
  PencilLine,
  Plus,
  Phone,
  Search,
  Sparkles,
  Syringe,
  Trash2,
  UserRound,
  Upload,
  X,
} from "lucide-react";
import type { CustomerJourneyStage, JourneyStageId, Patient } from "@/types/clinic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SlidingIndicator } from "@/components/ui/sliding-indicator";
import { AnimatedPage } from "./animated-page";
import { MaskedInput } from "@/components/ui/masked-input";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { MaterialCheckModal } from "./material-check-modal";
import { MaterialsUsedList, type MaterialUsed } from "./materials-used";
import { PatientExpenses } from "./patient-expenses";
import { PatientFinance } from "./patient-finance";
import { CustomerJourney } from "./customer-journey";
import { PhotoEditor } from "./photo-editor/photo-editor";
import { EmptyState, LoadingSkeleton } from "./shared";
import { CLIENT_CACHE_INVALIDATED_EVENT, getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { observationKindsFor, type ObservationKind } from "@/lib/permissions";
import { useCan, useCurrentRole, useOwnProfessionalName } from "./current-user";
import { appointmentSlotError, appointmentWithinStartWindow, canRequestAppointmentStart, clinicNow, latestAppointmentStart, matchesProcedureAppointment } from "@/lib/clinic-time";
import { appointmentMatchesProcedure, assignProcedureAppointmentsToCards,mergePatientAppointments, procedureCardScheduleAction } from "@/lib/patient-appointments";
import { FormField, fieldClassName } from "@/components/ui/modal";
import { formatCpf, formatInteger, formatPhone } from "@/lib/input-masks";
import { PatientOverview, PatientTreatments, type PatientJourneySummary } from "./patient-profile-views";
import { ProcedureImage } from "./procedure-image";
import { ClinicTimePicker } from "./clinic-time-picker";
import { clinicDateKey, type EncounterItem } from "@/lib/clinical-record-rules";
import type { AnamnesisRequest } from "@/lib/anamnesis-rules";
import { guardDraftNavigation } from "./use-draft-autosave";
import { PatientAnamnesis } from "./patient-anamnesis";
import { PatientClinicalDocuments } from "./patient-clinical-documents";
import { PatientClinicalPhotos } from "./patient-clinical-photos";
import { EvaluationSummaryDialog } from "./evaluation-summary-dialog";
import { isDocumentCategory, type DocumentCategory } from "@/lib/clinical-files-rules";
import { photoRef, type PhotoFilters } from "@/lib/photo-gallery-rules";
import { PatientClinicalSummary } from "./patient-clinical-summary";
import { PatientAppointmentsList } from "./patient-appointments-list";
import { anamnesisKey, useCachedResource, type AnamnesisOverview } from "./patient-clinical-data";
import { initialEvaluationLabel, useAnamnesisStartGate, type AnamnesisOpenMode } from "./anamnesis-start-gate";

const tabs = [
  { label: "Visão geral", icon: LayoutDashboard },
  { label: "Tratamentos", icon: Syringe },
  { label: "Prontuário", icon: FileText },
  { label: "Financeiro", icon: CreditCard },
];
// O prontuário tem 5 áreas. "Agendamentos" lista os horários da Agenda deste cliente; Observações foi para o Resumo
// clínico e Dados virou o botão "Editar dados" do cabeçalho.
const recordTabs = [
  { label: "Resumo clínico", icon: FileText },
  { label: "Agendamentos", icon: CalendarDays },
  { label: "Anamnese", icon: ClipboardList },
  { label: "Documentos clínicos", icon: FolderOpen },
  { label: "Fotos", icon: Camera },
];
// Documentos e Fotos são telas independentes. Nomes antigos ("Avaliação", "Procedimentos", "Atendimentos", "Histórico",
// "Arquivos e fotos") continuam aceitos por selectRecordTab e levam ao destino equivalente.

function historyCacheKey(patientId: string, tab: string, journeyId?: string | null) {
  const procedureNames = ["Agendamentos", "Procedimentos"].includes(tab) ? "&includeProcedureNames=1" : "";
  const journey = journeyId ? `&journeyId=${encodeURIComponent(journeyId)}` : "";
  return `/api/patients/${patientId}/history?tab=${encodeURIComponent(tab)}${procedureNames}${journey}`;
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
  sessions?: Array<{ id: string; procedureName: string; professional: string; performedAt: string; status: string; technique: string; treatedAreas: string; durationMinutes: number | null }>;
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
  // Dia no fuso da clínica (aaaa-mm-dd) e tratamento vinculado.
  dateKey?: string;
  journeyId?: string | null;
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
  procedureNames: Array<{ name: string }>;
  appointments: PatientAppointmentRecord[];
  appointmentToleranceMinutes?: number;
  observations: PatientObservation[];
  payments: PatientPaymentRecord[];
  materialsUsed: MaterialUsed[];
};

type PatientObservation = { id: string; text: string; authorName: string; createdAt: string; kind: "clinical" | "administrative" };

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
  materials?: MaterialUsed[];
};


type PinnedJourney = { key: string; title: string; stages: CustomerJourneyStage[] };

type EvaluationSummary = { id: string; professional: string; createdAt: string };

type ReturnAppointmentTarget = Pick<PatientProcedureRecord, "name" | "professional"> & { kind?: "return" | "procedure"; journeyId?: string };

export function PatientDetail({
  patient,
  onBack,
  initialSection = null,
}: {
  patient: Patient;
  onBack: () => void;
  // "anamnese": vem do cadastro ("Preencher anamnese") e abre Prontuário > Anamnese já iniciando o preenchimento.
  initialSection?: AnamnesisOpenMode | null;
}) {
  const router = useRouter();
  const [currentPatient, setCurrentPatient] = useState(patient);
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window === "undefined") return "Visão geral";
    const params = new URLSearchParams(window.location.search);
    return params.has("journey") ? "Tratamentos" : initialSection ? "Prontuário" : "Visão geral";
  });
  const [recordTab, setRecordTab] = useState(() => initialSection ? "Anamnese" : "Resumo clínico");
  const [summaryEvaluationId, setSummaryEvaluationId] = useState<string | null>(null);
  const [photosPreset, setPhotosPreset] = useState<{ filters: Partial<PhotoFilters>; nonce: number }>({ filters: {}, nonce: 0 });
  const [documentsPreset, setDocumentsPreset] = useState<{ category: DocumentCategory | null; nonce: number }>({ category: null, nonce: 0 });
  // Vem do fluxo de cadastro ("Preencher anamnese") ou do gate de início de atendimento.
  const requestCounter = useRef(1);
  const [anamnesisRequest, setAnamnesisRequest] = useState<AnamnesisRequest | null>(() => initialSection === "fill" || initialSection === "new-version" ? { mode: initialSection, nonce: 1 } : null);
  const [editPatientOpen, setEditPatientOpen] = useState(false);
  const [treatmentRequest, setTreatmentRequest] = useState(0);
  const [selectedJourneyId, setSelectedJourneyId] = useState<string | null>(() => typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("journey"));
  const [selectedJourneyLabel, setSelectedJourneyLabel] = useState("Jornada");
  const [history, setHistory] = useState<PatientHistoryRecord | undefined>();
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const retryAppointmentsHistory = () => { setHistoryError(false); setHistoryLoading(true); setHistoryRefreshKey((current) => current + 1); };
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [returnAppointmentTarget, setReturnAppointmentTarget] = useState<ReturnAppointmentTarget | null>(null);
  const [quoteCompleted, setQuoteCompleted] = useState(false);
  const [encounterMode, setEncounterMode] = useState(false);
  const [encounterQuoteMode, setEncounterQuoteMode] = useState(false);
  const [encounterProcedureMode, setEncounterProcedureMode] = useState(false);
  const [encounterPostProcedureMode, setEncounterPostProcedureMode] = useState(false);
  const [encounterPostProcedureSessionId, setEncounterPostProcedureSessionId] = useState<string>();
  const [encounterPostProcedureInitialView, setEncounterPostProcedureInitialView] = useState<"post" | "return">("post");
  const [encounterQuoteId, setEncounterQuoteId] = useState<string>();
  // Orçamento escolhido na aba Financeiro para abrir direto na etapa de orçamento da jornada.
  const quoteFocusRef = useRef<string | null>(null);
  const [encounterQuoteFocusId, setEncounterQuoteFocusId] = useState<string>();
  // Vem dos dados da jornada (procedimento já realizado): avaliação e orçamento passam a abrir só para consulta.
  const [journeyPastProcedure, setJourneyPastProcedure] = useState(false);
  const [encounterEvaluationId, setEncounterEvaluationId] = useState<string | undefined>();
  const [encounterLabel, setEncounterLabel] = useState("Novo atendimento");
  const [journeyWorkflowLoading, setJourneyWorkflowLoading] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("journey"));
  const [journeyWorkflowError, setJourneyWorkflowError] = useState("");
  const [journeyWorkflowRetry, setJourneyWorkflowRetry] = useState(0);
  // Apenas uma linha do tempo de procedimento fica exibida no topo por vez.
  const [pinnedJourney, setPinnedJourney] = useState<PinnedJourney | null>(null);
  const [pinnedRefreshKey, setPinnedRefreshKey] = useState(0);
  const pinnedJourneyKey = pinnedJourney?.key;
  const journeyPage = activeTab === "Tratamentos" && Boolean(selectedJourneyId);
  const canWriteClinical = useCan("clinical:write");
  // Fotos são dado clínico: a subaba nem aparece para quem não pode vê-las.
  const canReadClinicalPhotos = useCan("clinical:read");
  const visibleRecordTabs = canReadClinicalPhotos ? recordTabs : recordTabs.filter((tab) => tab.label !== "Fotos");
  const journeysResource = useCachedResource<{ journeys?: PatientJourneySummary[] }>(patient.id ? `/api/patients/${encodeURIComponent(patient.id)}/journeys` : "");
  // Sem anamnese concluída (ausente ou só rascunho), o cabeçalho oferece preenchê-la no lugar de iniciar o atendimento.
  const anamnesisOverview = useCachedResource<AnamnesisOverview>(canWriteClinical && patient.id ? anamnesisKey(patient.id) : "").data;
  const anamnesisUnfilled = anamnesisOverview !== undefined && !anamnesisOverview.restricted && (anamnesisOverview.state === "AUSENTE" || anamnesisOverview.state === "SOMENTE_RASCUNHO");
  const activeJourney = (journeysResource.data?.journeys ?? []).filter((item) => item.status === "Em andamento").sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))[0] ?? null;
  const openAnamnesis = useCallback((mode: AnamnesisOpenMode) => {
    setActiveTab("Prontuário");
    setRecordTab("Anamnese");
    requestCounter.current += 1;
    setAnamnesisRequest(mode === "view" ? null : { mode, nonce: requestCounter.current });
  }, []);
  // Gate único: todo ponto que inicia um atendimento passa por aqui antes de seguir.
  const startGate = useAnamnesisStartGate({ patientId: patient.id ?? "", onOpenAnamnesis: openAnamnesis });
  // Sair da tela com a anamnese em edição salva o rascunho pendente (ou pergunta) antes de seguir.
  const guarded = (action: () => void) => { void guardDraftNavigation().then((ok) => { if (ok) action(); }); };
  const primaryStartLabel = activeJourney ? "Continuar atendimento" : initialEvaluationLabel;
  // Sem saber se há tratamento ativo, "Iniciar atendimento" não pode presumir "nenhum" e abrir um tratamento novo.
  const journeysLoading = journeysResource.loading && !journeysResource.data;
  const journeysFailed = journeysResource.error && !journeysResource.data;
  const requestPrimaryStart = () => {
    if (journeysLoading) { toast.info("Carregando os tratamentos da cliente. Tente novamente em instantes."); return; }
    if (journeysFailed) { toast.error("Não foi possível verificar os tratamentos desta cliente. Tente novamente.", { action: { label: "Tentar de novo", onClick: journeysResource.retry } }); return; }
    startGate.requestStart(startPrimaryEncounter, { skipLabel: primaryStartLabel });
  };

  useEffect(() => {
    const syncJourneyRoute = () => {
      const params = new URLSearchParams(window.location.search);
      setSelectedJourneyId(params.get("journey"));
      setJourneyWorkflowLoading(params.has("journey"));
      setJourneyWorkflowError("");
      setEncounterMode(false);
      setEncounterQuoteMode(false);
      setEncounterProcedureMode(false);
      setEncounterPostProcedureMode(false);
      setEncounterPostProcedureInitialView("post");
      if (params.has("journey")) setActiveTab("Tratamentos");
    };
    window.addEventListener("popstate", syncJourneyRoute);
    return () => window.removeEventListener("popstate", syncJourneyRoute);
  }, []);

  const initials = currentPatient.name.split(" ").map((part) => part[0]).slice(0, 2).join("");
  // A lista de agendamentos do cliente cobre todos os tratamentos (sem filtro de jornada).
  const historyTab = activeTab === "Prontuário" && recordTab === "Agendamentos" ? "Agendamentos" : null;
  const currentHistoryKey = patient.id && historyTab ? historyCacheKey(patient.id, historyTab, null) : null;
  useEffect(() => {
    if (!patient.id) return;
    let cancelled = false;
    getCachedJson<{ quotes?: Array<{ status: string }> }>(`/api/quotes?patientId=${encodeURIComponent(patient.id)}&journeyId=${encodeURIComponent(selectedJourneyId ?? "")}`)
      .then((data) => { if (!cancelled && data.quotes?.some((quote) => ["Pago", "Aprovado"].includes(quote.status))) setQuoteCompleted(true); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [patient.id, selectedJourneyId]);

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
      getCachedJson<PatientHistoryResponse>(historyCacheKey(patient.id, "Procedimentos", selectedJourneyId)),
      getCachedJson<{ evaluations?: EvaluationSummary[] }>(`/api/patients/${patient.id}/evaluation?list=1${selectedJourneyId ? `&journeyId=${encodeURIComponent(selectedJourneyId)}` : ""}`),
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
  }, [patient.id, pinnedJourneyKey, pinnedRefreshKey, selectedJourneyId]);

  function selectTab(tab: string) {
    if (tab === activeTab) return;
    if (tab === "Prontuário" && recordTab === "Agendamentos") primeAppointmentsHistory();
    setActiveTab(tab);
  }

  function openJourney(journeyId: string | null, resolveWorkflow = true) {
    // Abertura normal da jornada nunca herda um foco de orçamento pedido antes (e não atendido).
    quoteFocusRef.current = null;
    setSelectedJourneyId(journeyId);
    setJourneyPastProcedure(false);
    setActiveTab("Tratamentos");
    setJourneyWorkflowLoading(Boolean(journeyId));
    setJourneyWorkflowError("");
    if (journeyId && resolveWorkflow) {
      setEncounterMode(false);
      setEncounterQuoteMode(false);
      setEncounterProcedureMode(false);
      setEncounterPostProcedureMode(false);
      setEncounterPostProcedureSessionId(undefined);
      setEncounterQuoteId(undefined);
      setEncounterQuoteFocusId(undefined);
      setEncounterEvaluationId(undefined);
    }
    if (!journeyId) {
      setEncounterMode(false);
      setEncounterQuoteMode(false);
      setEncounterProcedureMode(false);
      setEncounterPostProcedureMode(false);
      setEncounterPostProcedureSessionId(undefined);
      setEncounterQuoteId(undefined);
      setEncounterQuoteFocusId(undefined);
      setEncounterEvaluationId(undefined);
      setJourneyWorkflowLoading(false);
    }
    const params = new URLSearchParams(window.location.search);
    params.set("patient", currentPatient.id ?? currentPatient.name);
    if (journeyId) params.set("journey", journeyId);
    else params.delete("journey");
    router.push(`/clientes?${params.toString()}`);
  }

  function openJourneyAtQuote(journeyId: string, quoteId: string) {
    openJourney(journeyId);
    quoteFocusRef.current = quoteId;
  }

  function returnToPatientProfile() {
    openJourney(null);
    setActiveTab("Visão geral");
  }

  // Mostra o cache (se houver) ao abrir "Agendamentos"; sem cache, a lista começa em carregamento.
  function primeAppointmentsHistory() {
    const cached = patient.id ? readClientCache<PatientHistoryResponse>(historyCacheKey(patient.id, "Agendamentos", null)) : undefined;
    setHistory(cached ? mapPatientHistory(cached).history : undefined);
    setHistoryLoading(Boolean(patient.id && !cached));
    setHistoryError(false);
  }

  // Aceita as áreas atuais e também os nomes das sub-abas antigas: "Atendimentos"/"Histórico" levam a "Agendamentos",
  // Observações ao Resumo clínico e Dados ao botão "Editar dados". Assim os pontos de entrada existentes seguem valendo.
  function selectRecordTab(tab: string) {
    if (tab === "Orçamento") { selectTab("Financeiro"); return; }
    if (tab === "Dados") { setEditPatientOpen(true); return; }
    if (tab === "Observações") { setRecordTab("Resumo clínico"); return; }
    if (tab === "Avaliação") { openPhotos({ view: "evaluations" }); return; }
    if (tab === "Procedimentos") { openPhotos({ view: "procedures" }); return; }
    if (tab === "Arquivos e fotos" || (tab === "Fotos" && !canReadClinicalPhotos)) { openPhotos({}); return; }
    if (tab === "Agendamentos" || tab === "Atendimentos" || tab === "Histórico") { primeAppointmentsHistory(); setRecordTab("Agendamentos"); return; }
    const [area, preset] = tab.split(":");
    if (area === "Documentos clínicos") setDocumentsPreset((current) => ({ category: isDocumentCategory(preset) ? preset : null, nonce: current.nonce + 1 }));
    setRecordTab(area);
  }

  function openPhotos(filters: Partial<PhotoFilters>) {
    // Fotos clínicas (avaliações, procedimentos, evoluções) são só da equipe clínica; a API também recusa.
    if (!canReadClinicalPhotos) { toast.info("As fotos clínicas são acessíveis só à equipe clínica."); return; }
    setPhotosPreset((current) => ({ filters, nonce: current.nonce + 1 }));
    setActiveTab("Prontuário");
    setRecordTab("Fotos");
  }

  // Diálogo de agendamento (montado dentro de Prontuário > Agendamentos), aberto a partir de qualquer ponto da ficha.
  function openAppointmentDialog(target: ReturnAppointmentTarget) {
    setReturnAppointmentTarget(target);
    setActiveTab("Prontuário");
    setRecordTab("Agendamentos");
    primeAppointmentsHistory();
  }

  function startNewTreatment() {
    selectTab("Tratamentos");
    setTreatmentRequest(1);
  }

  function startPrimaryEncounter() {
    if (activeJourney) openJourney(activeJourney.id);
    else startNewTreatment();
  }

  function openEncounter(item: EncounterItem) {
    // Avaliação concluída (ou sem tratamento) é consultada no painel de avaliações; o resto segue o fluxo guiado do tratamento.
    if (item.type === "evaluation" && (item.status === "Concluído" || !item.journeyId)) {
      setSummaryEvaluationId(item.id);
      return;
    }
    if (!item.journeyId) return;
    setEncounterPostProcedureInitialView(item.type === "followup" ? "return" : "post");
    openJourney(item.journeyId);
  }

  async function changeMainTab(label: string) {
    if (await guardDraftNavigation()) selectTab(label);
  }

  async function changeRecordTab(label: string) {
    if (label === recordTab || !await guardDraftNavigation()) return;
    selectRecordTab(label);
  }

  function openNewAppointment() {
    openAppointmentDialog({ name: "", professional: "", kind: "procedure", journeyId: selectedJourneyId ?? undefined });
  }

  function openJourneyEvaluation(journey: PatientJourneySummary, evaluationId?: string) {
    setEncounterEvaluationId(evaluationId);
    setEncounterLabel(journey.name);
    setEncounterMode(true);
  }

  useEffect(() => {
    if (!journeyPage || !selectedJourneyId || !currentPatient.id) return;
    let cancelled = false;
    const focusQuoteId = quoteFocusRef.current;
    Promise.all([
      getCachedJson<{ journeys?: PatientJourneySummary[] }>(`/api/patients/${encodeURIComponent(currentPatient.id)}/journeys`),
      getCachedJson<{ evaluations?: Array<{ id: string; status?: string; updatedAt?: string }> }>(`/api/patients/${encodeURIComponent(currentPatient.id)}/evaluation?list=1&journeyId=${encodeURIComponent(selectedJourneyId)}`),
      getCachedJson<{ quotes?: Array<{ id: string; status: string; evaluationId?: string | null }> }>(`/api/quotes?patientId=${encodeURIComponent(currentPatient.id)}&journeyId=${encodeURIComponent(selectedJourneyId)}`),
    ])
      .then(([journeyData, evaluationData, quoteData]) => {
        if (cancelled) return;
        const journey = journeyData.journeys?.find((item) => item.id === selectedJourneyId);
        if (!journey) throw new Error("Não foi possível localizar este tratamento.");
        const evaluations = evaluationData.evaluations ?? [];
        const focusedQuote = focusQuoteId ? quoteData.quotes?.find((item) => item.id === focusQuoteId) : undefined;
        const focusedEvaluation = focusedQuote?.evaluationId ? evaluations.find((item) => item.id === focusedQuote.evaluationId && item.status !== "Rascunho") : undefined;
        const evaluation = focusedEvaluation ?? evaluations.find((item) => item.status === "Rascunho") ?? evaluations[0];
        const approvedQuote = quoteData.quotes?.find((item) => ["Aprovado", "Pago"].includes(item.status));
        setSelectedJourneyLabel(journey.name);
        setEncounterLabel(journey.name);
        setEncounterEvaluationId(evaluation?.id);
        // Com sessão concluída, o orçamento de referência é o da própria sessão (volta do pós ao orçamento/procedimento).
        setEncounterQuoteId(journey.latestCompletedQuoteId ?? approvedQuote?.id ?? undefined);
        setEncounterPostProcedureSessionId(journey.latestCompletedSessionId ?? undefined);
        setJourneyPastProcedure(journey.hasProcedure || Boolean(journey.latestCompletedSessionId));

        if (!journey.hasEvaluation || !evaluation || evaluation.status === "Rascunho") {
          if (!canReadClinicalPhotos) {
            // Atendente não abre a avaliação: fica na lista de tratamentos, sem a jornada na URL.
            toast.info("Este tratamento está na etapa de avaliação, que só a equipe clínica pode abrir.");
            setSelectedJourneyId(null);
            setJourneyWorkflowLoading(false);
            const params = new URLSearchParams(window.location.search);
            params.delete("journey");
            window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
            return;
          }
          setEncounterMode(true);
        } else if (focusedQuote) {
          // Vindo do Financeiro: abre a etapa de orçamento (onde o pagamento é registrado) com esse orçamento selecionado.
          quoteFocusRef.current = null;
          setEncounterQuoteFocusId(focusedQuote.id);
          setEncounterQuoteMode(true);
        } else if (!journey.hasPaidQuote) {
          if (!evaluation?.id) throw new Error("A avaliação desta jornada não foi encontrada para continuar ao orçamento.");
          setEncounterQuoteMode(true);
        } else if (!journey.hasProcedure) {
          if (!approvedQuote?.id && !journey.latestCompletedQuoteId) throw new Error("Não foi possível localizar o orçamento aprovado desta jornada.");
          setEncounterProcedureMode(true);
        } else if (journey.latestCompletedSessionId) {
          // Jornada com retorno agendado ou realizado abre direto na etapa de retorno.
          setEncounterPostProcedureInitialView(journey.hasReturnScheduled || journey.hasReturn ? "return" : "post");
          setEncounterPostProcedureMode(true);
        } else if (approvedQuote?.id || journey.latestCompletedQuoteId) {
          setEncounterQuoteId(approvedQuote?.id ?? journey.latestCompletedQuoteId ?? undefined);
          setEncounterProcedureMode(true);
        } else {
          throw new Error("Esta jornada ainda não possui uma sessão para abrir o pós-procedimento.");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setJourneyWorkflowError(error instanceof Error ? error.message : "Não foi possível abrir esta jornada.");
      })
      .finally(() => { if (!cancelled) setJourneyWorkflowLoading(false); });
    return () => { cancelled = true; };
  }, [journeyPage, selectedJourneyId, currentPatient.id, journeyWorkflowRetry, canReadClinicalPhotos]);

  useEffect(() => {
    if (!currentHistoryKey || !historyTab || !shouldLoadPatientHistory(historyTab)) return;
    let cancelled = false;
    getCachedJson<PatientHistoryResponse>(currentHistoryKey)
      .then((data) => {
        if (cancelled) return;
        const mapped = mapPatientHistory(data);
        setQuoteCompleted(mapped.hasPaidQuote);
        setHistory(mapped.history);
        setHistoryError(false);
      })
      .catch(() => { if (!cancelled) { setHistory(undefined); setHistoryError(true); } })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [currentHistoryKey, historyTab, historyRefreshKey]);

  if (journeyPage && journeyWorkflowLoading) {
    return <div className="mx-auto max-w-[1400px] space-y-4"><Card className="space-y-4 p-6"><LoadingSkeleton className="h-5 w-48" /><LoadingSkeleton className="h-20 w-full" /><LoadingSkeleton className="h-80 w-full" /></Card></div>;
  }

  if (journeyPage && journeyWorkflowError) {
    return <div className="mx-auto max-w-[1400px]"><Card className="space-y-3 p-6 text-center"><p role="alert" className="text-sm font-semibold text-destructive">{journeyWorkflowError}</p><div className="flex justify-center gap-2"><Button variant="outline" onClick={() => openJourney(null)}>Voltar aos tratamentos</Button><Button onClick={() => { setJourneyWorkflowError(""); setJourneyWorkflowLoading(true); setJourneyWorkflowRetry((value) => value + 1); }}>Tentar novamente</Button></div></Card></div>;
  }

  if (encounterMode && currentPatient.id) {
    return <div className="mx-auto max-w-[1400px]"><PhotoEditor patientId={currentPatient.id} evaluationId={encounterEvaluationId} journeyId={selectedJourneyId ?? undefined} patientName={currentPatient.name} encounterLabel={encounterLabel} readOnly={journeyPastProcedure} encounter={{ patient: currentPatient, onContinue: (savedEvaluationId) => { setEncounterEvaluationId(savedEvaluationId); setEncounterMode(false); setEncounterQuoteMode(true); }, onClients: onBack, onPatient: returnToPatientProfile, onJourney: () => openJourney(null) }} onSaved={() => { setHistory(undefined); setHistoryLoading(true); setHistoryRefreshKey((current) => current + 1); }} /></div>;
  }

  if (encounterQuoteMode && currentPatient.id) {
    return <div className="mx-auto max-w-[1400px]"><PatientExpenses key={`${currentPatient.id}-${selectedJourneyId ?? "none"}-${encounterEvaluationId ?? "none"}`} patientId={currentPatient.id} patient={currentPatient} journeyId={selectedJourneyId ?? undefined} evaluationId={encounterEvaluationId} quoteId={encounterQuoteFocusId} journeyLabel={encounterLabel} breadcrumb={{ onClients: onBack, onPatient: returnToPatientProfile, onJourney: () => openJourney(null) }} mode="encounter" readOnly={journeyPastProcedure} onReturnToEvaluation={() => { setEncounterQuoteMode(false); setEncounterMode(true); }} onAdvance={(quoteId) => { setEncounterQuoteId(quoteId); setEncounterQuoteMode(false); setEncounterProcedureMode(true); }} /></div>;
  }

  if (encounterProcedureMode && currentPatient.id && encounterQuoteId) {
    return <div className="mx-auto max-w-[1400px]"><PatientExpenses key={`${currentPatient.id}-${selectedJourneyId ?? "none"}-${encounterQuoteId}`} patientId={currentPatient.id} patient={currentPatient} journeyId={selectedJourneyId ?? undefined} quoteId={encounterQuoteId} breadcrumb={{ onClients: onBack, onPatient: returnToPatientProfile, onJourney: () => openJourney(null) }} mode="procedure" onReturnToQuote={() => { setEncounterProcedureMode(false); setEncounterQuoteFocusId(encounterQuoteId); setEncounterQuoteMode(true); }} onCompleted={(sessionId) => { setJourneyPastProcedure(true); setEncounterProcedureMode(false); setEncounterPostProcedureInitialView("post"); setEncounterPostProcedureSessionId(sessionId); setEncounterPostProcedureMode(true); setActiveTab("Tratamentos"); setHistory(undefined); setHistoryLoading(true); setHistoryRefreshKey((value) => value + 1); setPinnedRefreshKey((value) => value + 1); }} /></div>;
  }

  if (encounterPostProcedureMode && currentPatient.id && selectedJourneyId && encounterPostProcedureSessionId) {
    return <div className="mx-auto max-w-[1400px]"><PatientExpenses key={`${currentPatient.id}-${selectedJourneyId}-${encounterPostProcedureSessionId}`} patientId={currentPatient.id} patient={currentPatient} journeyId={selectedJourneyId} sessionId={encounterPostProcedureSessionId} initialView={encounterPostProcedureInitialView} breadcrumb={{ onClients: onBack, onPatient: returnToPatientProfile, onJourney: () => openJourney(null) }} mode="post-procedure" onReturnToQuote={encounterQuoteId ? () => { setEncounterPostProcedureMode(false); setEncounterQuoteFocusId(encounterQuoteId); setEncounterQuoteMode(true); } : undefined} onReturnToProcedure={encounterQuoteId ? () => { setEncounterPostProcedureMode(false); setEncounterProcedureMode(true); } : undefined} onFinish={() => { setEncounterPostProcedureMode(false); setEncounterPostProcedureSessionId(undefined); setEncounterPostProcedureInitialView("post"); setHistory(undefined); setHistoryLoading(true); setHistoryRefreshKey((value) => value + 1); setPinnedRefreshKey((value) => value + 1); openJourney(null); }} /></div>;
  }

  if (journeyPage) return <div className="mx-auto max-w-[1400px]" />;

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      {journeyPage ? (
        <nav aria-label="Navegação estrutural" className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <button className="transition-colors hover:text-primary" type="button" onClick={onBack}>Clientes</button>
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
          <button className="transition-colors hover:text-primary" type="button" onClick={returnToPatientProfile}>{currentPatient.name}</button>
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
          <span aria-current="page" className="font-semibold text-foreground">{selectedJourneyLabel}</span>
        </nav>
      ) : (
        <>
        <nav aria-label="Navegação estrutural" className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <button className="rounded-sm transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" type="button" onClick={() => guarded(onBack)}>Clientes</button>
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
          <span aria-current="page" className="font-semibold text-foreground">{currentPatient.name}</span>
        </nav>
        <button type="button" onClick={() => guarded(onBack)} className="flex items-center gap-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"><ArrowLeft className="h-4 w-4" />Voltar para clientes</button>
        </>
      )}

      <Card className={cn("grid overflow-hidden p-0", pinnedJourney && "lg:grid-cols-[350px_minmax(0,1fr)]")}>
        <div className={cn("flex flex-wrap items-center justify-between gap-4 p-4", pinnedJourney && "border-b border-[#ececf2] lg:border-b-0 lg:border-r")}>
          <div className="flex min-w-0 items-center gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full border-4 border-[#f2f0ff] bg-[#e8e5ff] text-base font-black text-[#5147dc]">{initials}</div>
          <div className="min-w-0">
            <h2 className="truncate text-lg sm:text-xl font-bold text-[#242538]">{currentPatient.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-[#77788a]">
              <span className="flex items-center gap-1.5"><UserRound className="h-3 w-3" />{currentPatient.age} anos</span>
              <span className="flex items-center gap-1.5"><Phone className="h-3 w-3" />{currentPatient.phone}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant={currentPatient.status.toLocaleLowerCase("pt-BR").includes("ativ") ? "green" : "slate"}>{currentPatient.status}</Badge>
              <span className="rounded-full bg-[#f2f3f7] px-2.5 py-1 text-xs font-semibold text-[#747587]">Paciente desde {currentPatient.createdAt ? new Date(currentPatient.createdAt).toLocaleDateString("pt-BR") : "data indisponível"}</span>
            </div>
          </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => guarded(() => setEditPatientOpen(true))}><PencilLine className="h-4 w-4" />Editar dados</Button>
            {canWriteClinical && anamnesisUnfilled ? <Button type="button" onClick={() => guarded(() => openAnamnesis("fill"))}><ClipboardList className="h-4 w-4" />Preencher anamnese</Button> : null}
          </div>
        </div>

        {pinnedJourney ? (
          <div className="relative min-w-0 p-4">
            <button className="absolute right-3 top-3 z-10 grid h-7 w-7 place-items-center rounded-full text-[#88899a] transition hover:bg-[#f3f2ff] hover:text-[#5147dc]" type="button" aria-label="Ocultar linha do tempo" title="Ocultar linha do tempo" onClick={() => setPinnedJourney(null)}><X className="h-3.5 w-3.5" /></button>
            <CustomerJourney key={pinnedJourney.key} compact title={pinnedJourney.title} journey={pinnedJourney.stages} onOpenStage={(stageId) => { const tab = stageId === "procedure" ? "Procedimentos" : procedureJourneyTabs[stageId]; if (tab) { selectTab("Prontuário"); selectRecordTab(tab); } }} />
          </div>
        ) : null}
      </Card>


      {!journeyPage ? <Card className="overflow-x-auto p-0">
        <div className="relative flex min-w-max px-2" role="tablist" aria-label="Áreas do prontuário">
          {tabs.map(({ label, icon: Icon }) => (
            <button
              className={cn(
                "flex items-center gap-2 border-b-2 border-transparent px-5 py-3 text-sm font-semibold transition-colors",
                activeTab === label
                  ? "bg-[#faf9ff] text-[#5147dc]"
                  : "text-[#77788a] hover:bg-[#faf9ff] hover:text-[#5147dc]",
              )}
              key={label}
              role="tab"
              aria-selected={activeTab === label}
              type="button"
              onClick={() => void changeMainTab(label)}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </button>
          ))}
          <SlidingIndicator />
        </div>
      </Card> : null}

      <AnimatedPage routeKey={activeTab}>
      {activeTab === "Visão geral" ? <PatientOverview patient={currentPatient} onOpen={(area, tab) => { if (tab === "Dados") { setEditPatientOpen(true); return; } selectTab(area); if (tab) selectRecordTab(tab); }} onOpenJourney={(journeyId) => openJourney(journeyId)} onNewAppointment={openNewAppointment} onOpenFollowUp={(journey, sessionId) => { openJourney(journey.id); setEncounterPostProcedureSessionId(sessionId); setEncounterPostProcedureInitialView("return"); setEncounterPostProcedureMode(true); }} /> : null}
      {activeTab === "Tratamentos" ? <PatientTreatments patient={currentPatient} onBeforeNewTreatment={(proceed) => startGate.requestStart(proceed, { skipLabel: initialEvaluationLabel })} newTreatmentRequest={treatmentRequest} onNewTreatmentRequestHandled={() => setTreatmentRequest(0)} selectedJourneyId={selectedJourneyId} onSelect={openJourney} onJourneyLabelChange={setSelectedJourneyLabel} onBack={() => openJourney(null)} onOpenClinical={(tab) => { if (tab === "Financeiro") selectTab(tab); else if (tab === "Fotos" || tab === "Arquivos e fotos") openPhotos({ journeyId: selectedJourneyId ?? "" }); else { selectTab("Prontuário"); selectRecordTab(tab); } }} onOpenEvaluation={openJourneyEvaluation} onNewSession={(journey) => openAppointmentDialog({ name: journey.name, professional: journey.professional, kind: "procedure", journeyId: journey.id })} onScheduleReturn={(journey) => openAppointmentDialog({ name: journey.name, professional: journey.professional, kind: "return", journeyId: journey.id })} onOpenFollowUp={(journey, sessionId) => { openJourney(journey.id); setEncounterPostProcedureInitialView("post"); setEncounterPostProcedureSessionId(sessionId); setEncounterPostProcedureMode(true); }} /> : null}
      {activeTab === "Prontuário" ? <div className="space-y-4">
        <div className="relative flex gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="Seções do prontuário">{visibleRecordTabs.map(({ label, icon: Icon }) => <button className={cn("flex shrink-0 items-center gap-2 border-b-2 border-transparent px-4 py-2.5 text-sm font-semibold transition-colors", recordTab === label ? "text-primary" : "text-muted-foreground hover:text-foreground")} type="button" key={label} role="tab" aria-selected={recordTab === label} onClick={() => void changeRecordTab(label)}><Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{label}</button>)}<SlidingIndicator /></div>
        <AnimatedPage routeKey={recordTab} skipInitial className="space-y-4">
        {recordTab === "Resumo clínico" ? <PatientClinicalSummary patientId={currentPatient.id ?? ""} onStart={() => requestPrimaryStart()} onOpenEncounter={openEncounter} onGoToAppointments={() => selectRecordTab("Agendamentos")} onGoToAnamnesis={() => openAnamnesis("view")} onGoToDocuments={() => setRecordTab("Documentos clínicos")} onGoToTreatments={() => selectTab("Tratamentos")} onReschedule={(next) => openAppointmentDialog({ name: next?.procedure ?? "", professional: next?.professional ?? "", kind: "return", journeyId: next?.journeyId ?? selectedJourneyId ?? undefined })} observations={<ObservationsTab patientId={currentPatient.id ?? ""} />} /> : null}
        {recordTab === "Agendamentos" && currentPatient.id ? <AppointmentsTab requestStart={startGate.requestStart} patientId={currentPatient.id} history={history} loading={historyLoading} error={historyError} onRetry={retryAppointmentsHistory} journeyNames={Object.fromEntries((journeysResource.data?.journeys ?? []).map((journey) => [journey.id, journey.name]))} onNew={openNewAppointment} onOpenJourney={(journeyId) => openJourney(journeyId)} returnAppointmentTarget={returnAppointmentTarget} onReturnAppointmentClose={() => setReturnAppointmentTarget(null)} /> : null}
        {recordTab === "Anamnese" ? currentPatient.id ? <PatientAnamnesis patientId={currentPatient.id} patientName={currentPatient.name} request={anamnesisRequest} onRequestHandled={() => setAnamnesisRequest(null)} /> : <EmptyState title="Cliente ainda não foi salvo" description="Salve o cliente antes de preencher a anamnese." /> : null}
        {recordTab === "Documentos clínicos" && currentPatient.id ? <PatientClinicalDocuments key={`documents-${documentsPreset.nonce}`} patientId={currentPatient.id} initialCategory={documentsPreset.category} onOpenAnamnesis={() => openAnamnesis("view")} onOpenEvaluation={(evaluationId) => setSummaryEvaluationId(evaluationId)} /> : null}
        {recordTab === "Fotos" && canReadClinicalPhotos && currentPatient.id ? <PatientClinicalPhotos key={`photos-${photosPreset.nonce}`} patientId={currentPatient.id} initialFilters={photosPreset.filters} /> : null}
        </AnimatedPage>
        <EvaluationSummaryDialog patientId={currentPatient.id ?? ""} evaluationId={summaryEvaluationId} onClose={() => setSummaryEvaluationId(null)} onViewPhotos={(evaluationId) => { setSummaryEvaluationId(null); openPhotos({ encounterKey: photoRef("evaluation", evaluationId) }); }} />
      </div> : null}
      {activeTab === "Financeiro" ? <PatientFinance patientId={currentPatient.id ?? ""} onOpenJourney={(journeyId) => openJourney(journeyId)} onRegisterPayment={openJourneyAtQuote} /> : null}
      </AnimatedPage>
      {startGate.gate}
      <PatientEditModal patient={currentPatient} open={editPatientOpen} onClose={() => setEditPatientOpen(false)} onUpdated={setCurrentPatient} />
    </div>
  );
}

// Edição dos dados cadastrais (antes na sub-aba "Dados"); agora um modal aberto pelo cabeçalho.
function PatientEditModal({ patient, open, onClose, onUpdated }: { patient: Patient; open: boolean; onClose: () => void; onUpdated: (patient: Patient) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());

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
    try {
      const response = await fetch(`/api/patients/${patient.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, cpf, phone, age }) });
      const data = await response.json().catch(() => null) as { patient?: Patient; message?: string } | null;
      if (!response.ok || !data?.patient) {
        setError(data?.message ?? "Não foi possível atualizar os dados.");
        if (response.status === 409 || data?.message?.toLowerCase().includes("cpf")) {
          setInvalidFields(new Set(["cpf"]));
          window.setTimeout(() => setInvalidFields(new Set()), 450);
        }
        return;
      }
      onUpdated({ ...patient, ...data.patient });
      invalidateClientCache("/api/patients", `/api/patients/${patient.id}`, `/api/patients/${patient.id}/history`);
      toast.success("Dados atualizados.");
      onClose();
    } catch {
      setError("Não foi possível atualizar os dados. Verifique a conexão.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={() => { if (!saving) { setError(""); onClose(); } }} title="Editar dados" description={`Atualize os dados cadastrais de ${patient.name}.`}>
      <form className="grid gap-4 sm:grid-cols-2" noValidate onSubmit={savePatient} key={`${patient.id}-${open}`}>
        <FormField label="Nome"><input className={cn(fieldClassName, invalidFields.has("name") && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} name="name" defaultValue={patient.name} required /></FormField>
        <FormField label="CPF"><MaskedInput className={cn(fieldClassName, invalidFields.has("cpf") && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} formatter={formatCpf} name="cpf" inputMode="numeric" maxLength={14} placeholder="000.000.000-00" defaultValue={patient.cpf ?? ""} /></FormField>
        <FormField label="Telefone"><MaskedInput className={cn(fieldClassName, invalidFields.has("phone") && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} formatter={formatPhone} name="phone" inputMode="tel" maxLength={15} placeholder="(00) 00000-0000" defaultValue={patient.phone} required /></FormField>
        <FormField label="Idade"><MaskedInput className={cn(fieldClassName, invalidFields.has("age") && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} formatter={(value) => formatInteger(value, 3)} name="age" inputMode="numeric" maxLength={3} defaultValue={String(patient.age)} required /></FormField>
        {error ? <p role="alert" className="rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318] sm:col-span-2">{error}</p> : null}
        <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" disabled={saving} onClick={() => { setError(""); onClose(); }}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{saving ? "Salvando..." : "Salvar dados"}</Button></div>
      </form>
    </Modal>
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
          <span className="hidden rounded-full bg-[#f1f0ff] px-2.5 py-1 text-xs font-bold uppercase text-[#5147dc] sm:inline-flex">Linha do tempo</span>
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
            <input className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar no histórico" aria-label="Buscar no histórico" />
          </label>
          <label className="relative flex h-10 items-center gap-2 rounded-[8px] border border-input bg-white px-3 text-xs text-foreground transition focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
            <Filter className="h-4 w-4 shrink-0 text-primary" />
            <select className="min-w-0 flex-1 appearance-none bg-transparent pr-5 text-sm outline-none" value={eventFilter} onChange={(event) => setEventFilter(event.target.value as HistoryEventKind | "all")} aria-label="Filtrar eventos">
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
            <select className="min-w-0 flex-1 appearance-none bg-transparent pr-5 text-sm outline-none" value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value as "all" | "30" | "90")} aria-label="Filtrar período">
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
    materials: history.materialsUsed.filter((item) => item.kind === "procedure" && item.attendanceName === procedure.name),
  }));
  const appointments: HistoryTimelineEvent[] = history.appointments.map((appointment) => ({
    key: `appointment-${appointment.id ?? `${appointment.date}-${appointment.time}-${appointment.procedure}`}`,
    kind: "appointment" as const,
    date: appointment.date,
    title: "Agendamento confirmado",
    subtitle: `${appointment.date} às ${appointment.time} · ${appointment.procedure}${appointment.professional ? ` · ${appointment.professional}` : ""}`,
    status: appointment.status,
    details: appointment.notes || "Agendamento registrado para este atendimento.",
    materials: appointment.id ? history.materialsUsed.filter((item) => item.appointmentId === appointment.id) : [],
  }));
  const payments: HistoryTimelineEvent[] = history.payments.filter((payment) => !payment.disabled).map((payment, index) => ({
    key: `payment-${payment.id ?? index}`,
    kind: "payment" as const,
    title: payment.procedure,
    subtitle: `${payment.method} · ${payment.value}`,
    status: payment.status,
    details: `Pagamento registrado em ${payment.method}, no valor de ${payment.value}.`,
  }));
  const observations: HistoryTimelineEvent[] = history.observations.map((observation) => ({
    key: `observation-${observation.id}`,
    kind: "observation" as const,
    title: "Observação registrada",
    date: new Date(observation.createdAt).toLocaleDateString("pt-BR"),
    subtitle: `${new Date(observation.createdAt).toLocaleDateString("pt-BR")} · ${observation.authorName}${observation.kind === "administrative" ? " · Administrativa" : ""}`,
    status: "Registrada",
    details: observation.text,
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
  return <div className="flex items-center gap-3 rounded-[7px] border border-[#e8e9f2] bg-[#fbfbfd] p-3"><span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-[9px]", tones[tone])}><Icon className="h-5 w-5" /></span><div><p className="text-xs text-[#77788a]">{label}</p><strong className="mt-0.5 block text-lg leading-5 text-[#303144]">{value}</strong></div></div>;
}

function HistoryTimelineEventCard({ event, expanded, onToggle, onViewProcedure }: { event: HistoryTimelineEvent; expanded: boolean; onToggle: () => void; onViewProcedure: (procedure: PatientProcedureRecord) => void }) {
  const canReadClinical = useCan("clinical:read");
  const isProcedure = event.kind === "procedure" && event.procedure;
  const dateParts = formatHistoryDateParts(event.date);
  const statusVariant = event.status === "Realizado" || event.status === "Atendido" || event.status === "Concluído" || event.status === "Pago" ? "green" : event.status === "Em procedimento" ? "amber" : "slate";

  return (
    <div className={cn("relative grid gap-3 sm:grid-cols-[66px_minmax(0,1fr)]", isProcedure && expanded && "") }>
      <div className="hidden pt-4 text-center sm:block"><strong className="block text-sm text-[#303144]">{dateParts.day}</strong><span className="text-xs font-bold uppercase text-[#858696]">{dateParts.month}</span></div>
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
            {canReadClinical ? <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" onClick={() => onViewProcedure(event.procedure as PatientProcedureRecord)}><Eye className="h-3.5 w-3.5" />Ver procedimento</Button>
              <Button type="button" variant="secondary" size="sm" disabled title="Visualização de anexos em breve"><Paperclip className="h-3.5 w-3.5" />Ver anexos ({getProcedurePhotoSessions(event.procedure as PatientProcedureRecord).length})</Button>
              <div className="ml-auto flex -space-x-1.5">{getProcedurePhotoSessions(event.procedure as PatientProcedureRecord).slice(0, 3).flatMap((session) => [session.beforePhoto, session.afterPhoto]).filter((src) => Boolean(src && src !== "__photo__")).slice(0, 3).map((src, index) => <span className="relative h-8 w-8 overflow-hidden rounded-[5px] border-2 border-white bg-[#f1f2f7]" key={`${src}-${index}`}><Image src={src as string} alt="Miniatura do procedimento" fill className="object-cover" sizes="32px" /></span>)}</div>
            </div> : null}
          </> : <div className="rounded-[7px] border border-[#e8e9f2] bg-[#fbfbfd] p-3 text-xs text-[#656678]">{event.details}</div>}
          {canReadClinical && event.materials?.length ? <div className="mt-3"><MaterialsUsedList items={event.materials} showAttendance={false} /></div> : null}
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
      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-bold uppercase text-[#858696]">Ângulo selecionado</p><p className="mt-1 text-sm font-bold text-[#303144]">{activeSession?.name ?? "Sessão principal"}</p></div><Button type="button" variant="secondary" size="sm" disabled title="Visualização de anexos em breve"><Paperclip className="h-3.5 w-3.5" />Ver anexos</Button></div>
      <div className="flex justify-center"><div className="inline-flex rounded-[7px] border border-[#dddfea] bg-[#fafafd] p-1"><button className={cn("inline-flex h-8 items-center gap-1.5 rounded-[5px] px-3 text-xs font-bold", viewMode === "compare" ? "bg-[#5147dc] text-white" : "text-[#77788a] hover:bg-white hover:text-[#5147dc]")} type="button" onClick={() => setViewMode("compare")} aria-pressed={viewMode === "compare"}><ArrowLeftRight className="h-3.5 w-3.5" />Comparar</button><button className={cn("inline-flex h-8 items-center gap-1.5 rounded-[5px] px-3 text-xs font-bold", viewMode === "sideBySide" ? "bg-[#5147dc] text-white" : "text-[#77788a] hover:bg-white hover:text-[#5147dc]")} type="button" onClick={() => setViewMode("sideBySide")} aria-pressed={viewMode === "sideBySide"}><Columns2 className="h-3.5 w-3.5" />Lado a lado</button></div></div>
      <div className="relative mx-auto w-full max-w-[420px]">
        <div className="flex min-h-0 justify-center">{viewMode === "compare" ? <BeforeAfterComparison compact beforeSrc={activeSession?.beforePhoto} afterSrc={activeSession?.afterPhoto} beforeLabel={`Antes · ${procedure.date}`} afterLabel={`Depois · ${procedure.date}`} sliderPosition={sliderPosition} comparisonRef={comparisonRef} onPointerDown={handleSliderPointerDown} onPointerMove={handleSliderPointerMove} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onBeforePreview={(src) => setExpandedPhoto({ label: "Antes", src })} onAfterPreview={(src) => setExpandedPhoto({ label: "Depois", src })} /> : <div className="grid w-full max-w-[380px] gap-2 sm:grid-cols-2"><BeforeAfterPhoto label="Antes" overlayLabel={`Antes · ${procedure.date}`} src={activeSession?.beforePhoto} onPreview={(src) => setExpandedPhoto({ label: "Antes", src })} /><BeforeAfterPhoto label="Depois" overlayLabel={`Depois · ${procedure.date}`} src={activeSession?.afterPhoto} onPreview={(src) => setExpandedPhoto({ label: "Depois", src })} /></div>}</div>
      </div>
      <div className="text-center"><p className="text-xs font-bold text-[#303144]">{activeSession?.name ?? "Sessão principal"}</p><p className="mt-0.5 text-xs text-[#858696]">Ângulo {activeIndex + 1} de {sessions.length}</p></div>
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

function ProceduresTab({ requestStart, patientId, onOpenTab, pinnedJourneyKey, onPinJourney, history, loading, onProcedurePhotoUpdated, onScheduleReturn }: { requestStart?: (proceed: () => void) => void; patientId: string; onOpenTab: (tab: string) => void; pinnedJourneyKey?: string; onPinJourney: (journey: PinnedJourney | null) => void; history?: PatientHistoryRecord; loading: boolean; onProcedurePhotoUpdated: (procedureId: string, photo: { beforePhoto: string | null; afterPhoto: string | null }) => void; onScheduleReturn: (procedure: ReturnAppointmentTarget, kind?: "return" | "procedure") => void }) {
  const canReadClinical = useCan("clinical:read");
  const [procedures, setProcedures] = useState<PatientProcedureRecord[]>(history?.procedures ?? []);
  const [photoOperations, setPhotoOperations] = useState<Record<string, "upload" | "remove">>({});
  const [deletingPhotoSessionKey, setDeletingPhotoSessionKey] = useState<string>();
  const [appointmentStatuses, setAppointmentStatuses] = useState<Record<string, string>>({});
  const [updatingProcedureAppointmentId, setUpdatingProcedureAppointmentId] = useState<string | null>(null);
  const [updatingProcedureAppointmentStatus, setUpdatingProcedureAppointmentStatus] = useState<"Em atendimento" | "Atendido" | null>(null);
  const updatingProcedureAppointmentIds = useRef(new Set<string>());
  const [startConfirmation, setStartConfirmation] = useState<PatientAppointmentRecord | null>(null);
  const [error, setError] = useState("");
  const [currentTime, setCurrentTime] = useState(() => clinicNowForForm());
  const [evaluations, setEvaluations] = useState<EvaluationSummary[]>([]);
  const [checkAppointmentId, setCheckAppointmentId] = useState<string | null>(null);

  useEffect(() => {
    if (!patientId) return;
    getCachedJson<{ evaluations?: EvaluationSummary[] }>(`/api/patients/${patientId}/evaluation?list=1`)
      .then((data) => setEvaluations(data.evaluations ?? []))
      .catch(() => setEvaluations([]));
  }, [patientId]);

  const visibleProcedures = history ? (procedures.length ? procedures : history.procedures) : [];
  const hasOpenAppointment = (name: string) => Boolean(history?.appointments.some((appointment) => appointmentMatchesProcedure(appointment.procedure, name) && ["Agendado", "Em atendimento"].includes(appointment.status)));
  const proceduresToSchedule = visibleProcedures.filter((procedure) => procedure.status !== "Realizado" && !hasOpenAppointment(procedure.name));
  const returnsToSchedule = visibleProcedures.filter((procedure) => procedure.status === "Realizado" && !hasOpenAppointment(`Retorno - ${procedure.name}`));

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(clinicNowForForm()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  async function updateProcedureAppointment(appointment: PatientAppointmentRecord, status: "Em atendimento" | "Atendido") {
    if (!appointment.id || updatingProcedureAppointmentIds.current.has(appointment.id)) return false;
    updatingProcedureAppointmentIds.current.add(appointment.id);
    setUpdatingProcedureAppointmentId(appointment.id);
    setUpdatingProcedureAppointmentStatus(status);
    setError("");
    try {
      const response = await fetch(`/api/appointments/${appointment.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const data = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(data?.message ?? "Não foi possível atualizar o procedimento.");
      setAppointmentStatuses((current) => ({ ...current, [appointment.id as string]: status }));
      invalidateClientCache(`/api/patients/${patientId}/history`, "/api/patients", "/api/agenda", "/api/dashboard/bootstrap");
      if (status === "Atendido") setCheckAppointmentId(appointment.id);
      return true;
    } catch (appointmentError) {
      setError(appointmentError instanceof Error ? appointmentError.message : "Não foi possível atualizar o procedimento.");
      return false;
    } finally {
      updatingProcedureAppointmentIds.current.delete(appointment.id);
      setUpdatingProcedureAppointmentId(null);
      setUpdatingProcedureAppointmentStatus(null);
    }
  }

  function requestProcedureStart(appointment: PatientAppointmentRecord) {
    const start = () => {
      if (appointmentWithinStartWindow(appointment, history?.appointmentToleranceMinutes ?? 15, currentTime)) {
        void updateProcedureAppointment(appointment, "Em atendimento");
        return;
      }
      setStartConfirmation(appointment);
    };
    // Mesmo gate de anamnese dos demais pontos de "Iniciar atendimento".
    if (requestStart) requestStart(start); else start();
  }

  async function confirmProcedureStart() {
    if (!startConfirmation) return;
    const started = await updateProcedureAppointment(startConfirmation, "Em atendimento");
    if (started) setStartConfirmation(null);
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
      invalidateClientCache(`/api/patients/${patientId}/history`, "/api/patients");
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
      invalidateClientCache(`/api/patients/${patientId}/history`);
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
      invalidateClientCache(`/api/patients/${patientId}/history`);
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
      invalidateClientCache(`/api/patients/${patientId}/history`);
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
      <div><h3 className="text-sm font-bold text-[#303144]">Procedimentos realizados</h3><p className="mt-1 text-xs text-[#858696]">Os procedimentos aparecem aqui automaticamente a partir do orçamento aprovado. Adicione as fotos de antes e depois no atendimento.</p></div>
      {loading ? <ProcedureCardsSkeleton /> : !visibleProcedures.length ? <EmptyPatientState message="Este cliente ainda não possui procedimentos realizados." /> : <div className="grid gap-4">{(() => {
        const procedureAppointments = assignProcedureAppointmentsToCards(history?.appointments ?? [], visibleProcedures, history?.procedureNames ?? []);
        return visibleProcedures.map((procedure, procedureIndex) => {
        const canScheduleProcedure = proceduresToSchedule.includes(procedure);
        const canScheduleReturn = returnsToSchedule.includes(procedure);
        const cardScheduleAction = procedureCardScheduleAction(procedure.status, canScheduleProcedure, canScheduleReturn);
        const scheduleAction = <Button className={cn("h-8 px-2", cardScheduleAction.disabled && "border-[#b9e8d8] bg-[#eaf8ef] text-[#16805d] hover:border-[#b9e8d8] hover:bg-[#eaf8ef] hover:text-[#16805d]")} type="button" variant="secondary" disabled={cardScheduleAction.disabled} onClick={() => onScheduleReturn(procedure, cardScheduleAction.kind)}><CalendarPlus className="h-3.5 w-3.5" />{cardScheduleAction.label}</Button>;
        if (!canReadClinical) {
          return <Card className="flex flex-wrap items-center justify-between gap-3 p-4" key={procedure.id ?? `${procedure.name}-${procedure.date}`}>
            <div className="min-w-0"><strong className="block text-sm text-[#303144]">{procedure.name}</strong><span className="mt-1 block text-xs text-[#858696]">{procedure.date}{procedure.professional ? ` · ${procedure.professional}` : ""}</span></div>
            <div className="flex flex-wrap items-center justify-end gap-2"><Badge variant={procedure.status === "Realizado" ? "green" : procedure.status === "Em procedimento" ? "amber" : "slate"}>{procedure.status}</Badge>{scheduleAction}</div>
          </Card>;
        }
        const beforeKey = `${procedure.id}-beforePhoto`;
        const afterKey = `${procedure.id}-afterPhoto`;
        const appointment = procedureAppointments[procedureIndex];
        const effectiveStatus = appointment?.id ? appointmentStatuses[appointment.id] ?? appointment.status : undefined;
        const appointmentWithStatus = appointment ? { ...appointment, status: effectiveStatus ?? appointment.status } : undefined;
        const procedureStarted = appointmentWithStatus?.status === "Em atendimento" || appointmentWithStatus?.status === "Atendido";
        const photoEditingEnabled = !appointmentWithStatus || procedureStarted || procedure.status === "Realizado";
        const afterPhotoEnabled = procedure.status === "Realizado" || procedureStarted;
        const procedureCanStart = appointmentWithStatus?.status === "Agendado" && appointmentWithinStartWindow(appointmentWithStatus, history?.appointmentToleranceMinutes ?? 15, currentTime);
        const procedureInProgress = appointmentWithStatus?.status === "Em atendimento";
        const journey = journeyFor(procedure);
        const journeyKey = procedureKey(procedure);
        const journeyPinned = pinnedJourneyKey === journeyKey;
        const procedureMaterials = appointment?.id ? (history?.materialsUsed ?? []).filter((item) => item.appointmentId === appointment.id) : [];
        return <div className="space-y-2" key={procedure.id ?? `${procedure.name}-${procedure.date}`}><ProcedureHistoryCard procedure={procedure} scheduleAction={scheduleAction} materials={procedureMaterials} journey={<div className="flex flex-col gap-3 sm:flex-row sm:items-start"><CustomerJourney compact title="Jornada do procedimento" journey={journey} onOpenStage={(stageId) => { const tab = procedureJourneyTabs[stageId]; if (tab) onOpenTab(tab); }} /><Button className={cn("shrink-0", journeyPinned && "border-[#cfcaff] bg-[#f3f2ff] text-[#5147dc]")} size="sm" type="button" variant="secondary" aria-pressed={journeyPinned} onClick={() => onPinJourney(journeyPinned ? null : { key: journeyKey, title: `Jornada · ${procedure.name}`, stages: journey })}>{journeyPinned ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}{journeyPinned ? "Ocultar do topo" : "Exibir linha do tempo"}</Button></div>} editable={photoEditingEnabled} expandable afterPhotoEnabled={afterPhotoEnabled} afterPhotoMessage={!afterPhotoEnabled ? "Inicie o atendimento para adicionar fotos" : undefined} appointment={appointmentWithStatus} canStartProcedure={procedureCanStart} procedureStartSaving={appointmentWithStatus?.id === updatingProcedureAppointmentId} procedureFinishSaving={appointmentWithStatus?.id === updatingProcedureAppointmentId && updatingProcedureAppointmentStatus === "Atendido"} procedureInProgress={procedureInProgress} onProcedureStatusChange={(status) => { if (appointmentWithStatus) { if (status === "Em atendimento") requestProcedureStart(appointmentWithStatus); else void updateProcedureAppointment(appointmentWithStatus, status); } }} beforePhotoSaving={Boolean(photoOperations[beforeKey])} afterPhotoSaving={Boolean(photoOperations[afterKey])} beforePhotoOperation={photoOperations[beforeKey]} afterPhotoOperation={photoOperations[afterKey]} onPhotoChange={saveProcedurePhoto} onPhotoRemove={(procedureId, photoType, sessionId) => updateProcedurePhoto(procedureId, photoType, null, "remove", sessionId)} onPhotoSessionCreate={createPhotoSession} onPhotoSessionDelete={deletePhotoSession} onPhotoSessionRename={renamePhotoSession} deletingPhotoSessionKey={deletingPhotoSessionKey} /></div>;
        });
      })()}</div>}
      {error ? <p className="rounded-[7px] bg-[#fff1f0] px-3 py-2 text-xs font-semibold text-[#b42318]">{error}</p> : null}
      <Modal open={Boolean(startConfirmation)} onClose={() => { if (!updatingProcedureAppointmentId) setStartConfirmation(null); }} title="Iniciar fora do horário" description={startConfirmation ? `Procedimento agendado para ${startConfirmation.date} às ${startConfirmation.time}.` : undefined}>
        <div className="space-y-4">
          <p className="text-sm leading-6 text-muted-foreground">O horário atual está fora do período normal deste agendamento. Tem certeza que deseja iniciar o procedimento agora?</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={Boolean(updatingProcedureAppointmentId)} onClick={() => setStartConfirmation(null)}>Cancelar</Button>
            <Button type="button" disabled={Boolean(updatingProcedureAppointmentId)} onClick={() => void confirmProcedureStart()}>{updatingProcedureAppointmentId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock3 className="h-3.5 w-3.5" />}{updatingProcedureAppointmentId ? "Iniciando..." : "Confirmar início"}</Button>
          </div>
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

type PatientHistoryResponse = { patient?: { appointmentToleranceMinutes?: number; appointmentProcedureNames?: Array<{ name: string }>; observations?: PatientObservation[]; materialsUsed?: MaterialUsed[]; appointments: Array<{ id: string; date: string; time: string; procedure: string; professional: string; status: string; notes: string; materialsCheck?: string | null; journeyId?: string | null }>; payments: Array<{ id: string; value: number; method: string; status: string; installments: string }>; quotes: Array<{ id: string; items: string; status: string; createdAt?: string }>; procedureRecords: Array<{ id: string; quoteId?: string | null; name: string; professional: string; performedAt: string; notes: string; beforePhoto: string | null; afterPhoto: string | null; sessions?: Array<{ id: string; procedureName: string; professional: string; performedAt: string; status: string; technique: string; treatedAreas: string; durationMinutes: number | null }>; photoSessions?: Array<{ id: string; name: string; beforePhoto: string | null; afterPhoto: string | null }> }> } };

function mapPatientHistory(data: PatientHistoryResponse) {
  const appointments = data.patient?.appointments ?? [];
  const payments = data.patient?.payments ?? [];
  const paidQuotes = (data.patient?.quotes ?? []).filter((quote) => ["Pago", "Aprovado"].includes(quote.status));
  const latestQuoteItems = paidQuotes[0]?.items;
  const useQuoteTitle = Boolean(latestQuoteItems && data.patient?.procedureRecords?.length === 1);
  const persistedProcedures = data.patient?.procedureRecords ?? [];
  const quoteDates = new Map((data.patient?.quotes ?? []).map((quote) => [quote.id, quote.createdAt]));
  const procedures = persistedProcedures.length
    ? persistedProcedures.map((item) => ({ id: item.id, name: useQuoteTitle ? latestQuoteItems ?? item.name : item.name, date: new Date(item.performedAt).toLocaleDateString("pt-BR"), professional: item.professional, status: procedurePhotoStatus(item.beforePhoto, item.afterPhoto), beforePhoto: item.beforePhoto ?? "", afterPhoto: item.afterPhoto ?? "", photoSessions: item.photoSessions?.map((session) => ({ id: session.id, name: session.name, beforePhoto: session.beforePhoto ?? "", afterPhoto: session.afterPhoto ?? "" })) ?? [], sessions: item.sessions ?? [], notes: item.notes, quoteDate: item.quoteId ? quoteDates.get(item.quoteId) : undefined }))
    : paidQuotes.map((quote): PatientProcedureRecord => ({ name: quote.items, date: quote.createdAt ? new Date(quote.createdAt).toLocaleDateString("pt-BR") : new Date().toLocaleDateString("pt-BR"), professional: "", status: "Aguardando foto", beforePhoto: "", afterPhoto: "", photoSessions: [], notes: "", quoteDate: quote.createdAt }))
      .concat(appointments.filter((item) => ["Atendido", "Finalizado"].includes(item.status)).map((item) => ({ name: item.procedure, date: new Date(item.date).toLocaleDateString("pt-BR"), professional: item.professional, status: item.status, beforePhoto: "", afterPhoto: "", photoSessions: [], notes: item.notes })));
  const history: PatientHistoryRecord = {
    appointments: appointments.map((item) => ({ id: item.id, date: new Date(item.date).toLocaleDateString("pt-BR"), time: item.time, procedure: item.procedure, professional: item.professional, status: item.status, notes: item.notes, materialsCheck: item.materialsCheck ?? null, dateKey: clinicDateKey(item.date), journeyId: item.journeyId ?? null })),
    appointmentToleranceMinutes: data.patient?.appointmentToleranceMinutes ?? 15,
    procedures,
    procedureNames: data.patient?.appointmentProcedureNames ?? procedures.map(({ name }) => ({ name })),
    payments: payments.map((item) => ({ id: item.id, procedure: "Atendimento", value: new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(item.value), method: item.method, status: item.status, disabled: item.status === "Pago", disabledReason: item.status === "Pago" ? "Pagamento já finalizado" : undefined })),
    observations: data.patient?.observations ?? [],
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

function ProcedureHistoryCard({ procedure, scheduleAction, materials, journey, editable, expandable = false, afterPhotoEnabled = true, afterPhotoMessage, appointment, canStartProcedure, procedureStartSaving, procedureFinishSaving, procedureInProgress, onProcedureStatusChange, beforePhotoSaving, afterPhotoSaving, beforePhotoOperation, afterPhotoOperation, onPhotoChange, onPhotoRemove, onPhotoSessionCreate, onPhotoSessionDelete, onPhotoSessionRename, deletingPhotoSessionKey }: {
  journey?: ReactNode; scheduleAction?: ReactNode; materials?: MaterialUsed[]; procedure: PatientProcedureRecord; editable?: boolean; expandable?: boolean; afterPhotoEnabled?: boolean; afterPhotoMessage?: string; appointment?: PatientAppointmentRecord; canStartProcedure?: boolean; procedureStartSaving?: boolean; procedureFinishSaving?: boolean; procedureInProgress?: boolean; onProcedureStatusChange?: (status: "Em atendimento" | "Atendido") => void; beforePhotoSaving?: boolean; afterPhotoSaving?: boolean; beforePhotoOperation?: "upload" | "remove"; afterPhotoOperation?: "upload" | "remove"; onPhotoChange?: (procedureId: string | undefined, photoType: "beforePhoto" | "afterPhoto", file: File, sessionId?: string) => void; onPhotoRemove?: (procedureId: string | undefined, photoType: "beforePhoto" | "afterPhoto", sessionId?: string) => void; onPhotoSessionCreate?: (procedureId: string | undefined, name: string) => Promise<PatientPhotoSession | null>; onPhotoSessionDelete?: (procedureId: string | undefined, sessionId: string) => Promise<boolean>; onPhotoSessionRename?: (procedureId: string | undefined, sessionId: string, name: string) => Promise<boolean>; deletingPhotoSessionKey?: string }) {
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
          <div className="flex min-w-0 items-center gap-2"><ProcedureImage name={procedure.name} decorative className="h-9 w-9 rounded" /><h3 className="truncate text-sm font-bold text-[#303144]">{procedure.name}</h3></div>
          <p className="mt-1 text-xs text-[#858696]">{procedure.date}{procedure.professional ? ` · ${procedure.professional}` : ""}</p>
        </button>
        <div className="flex flex-wrap items-center justify-end gap-2"><Badge variant={procedure.status === "Realizado" ? "green" : procedure.status === "Em procedimento" ? "amber" : "slate"}>{procedure.status}</Badge>{scheduleAction}{(appointment?.status === "Agendado" || appointment?.status === "Faltou") && appointment.id ? <Button className="h-8 px-2" type="button" disabled={procedureStartSaving} onClick={() => onProcedureStatusChange?.("Em atendimento")} title={canStartProcedure ? "Iniciar procedimento" : "Confirmar início fora do período agendado"}>{procedureStartSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock3 className="h-3.5 w-3.5" />}{procedureStartSaving ? "Iniciando..." : "Iniciar procedimento"}</Button> : null}{procedureInProgress && appointment?.id ? <Button className="h-8 px-2" type="button" disabled={procedureFinishSaving} onClick={() => onProcedureStatusChange?.("Atendido")}>{procedureFinishSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{procedureFinishSaving ? "Finalizando..." : "Finalizar procedimento"}</Button> : null}{expandable ? <button className="grid h-8 w-8 place-items-center rounded-full text-[#77788a] transition hover:bg-[#f3f2ff] hover:text-[#5147dc]" type="button" onClick={() => setExpanded((current) => !current)} aria-label={expanded ? "Recolher procedimento" : "Expandir procedimento"} aria-expanded={expandable ? expanded : undefined}><ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} /></button> : null}</div>
      </div>
      {expanded && journey ? <div className="border-b border-[#ededf3] px-4 py-3">{journey}</div> : null}
      {expanded && materials?.length ? <div className="border-b border-[#ededf3] px-4 py-3"><MaterialsUsedList items={materials} title="Materiais e produtos usados neste procedimento" showAttendance={false} /></div> : null}
      {expanded ? <div className={cn("p-4", expandable && "grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]")}>
        <div className="min-w-0">
          <div className="mb-3 flex justify-end">
            <div className="inline-flex rounded-[7px] border border-[#dddfea] bg-[#fafafd] p-1">
              <button className={cn("inline-flex h-8 items-center gap-1.5 rounded-[5px] px-3 text-xs font-bold transition", viewMode === "compare" ? "bg-[#5147dc] text-white shadow-[0_4px_12px_rgba(81,71,220,0.2)]" : "text-[#77788a] hover:bg-white hover:text-[#5147dc]")} type="button" onClick={() => setViewMode("compare")} aria-pressed={viewMode === "compare"}><ArrowLeftRight className="h-3.5 w-3.5" />Comparar</button>
              <button className={cn("inline-flex h-8 items-center gap-1.5 rounded-[5px] px-3 text-xs font-bold transition", viewMode === "sideBySide" ? "bg-[#5147dc] text-white shadow-[0_4px_12px_rgba(81,71,220,0.2)]" : "text-[#77788a] hover:bg-white hover:text-[#5147dc]")} type="button" onClick={() => setViewMode("sideBySide")} aria-pressed={viewMode === "sideBySide"}><Columns2 className="h-3.5 w-3.5" />Lado a lado</button>
            </div>
          </div>
          {procedure.sessions?.length ? <div className="mb-3 space-y-2 rounded-[5px] bg-[#f7f7fb] p-3"><h4 className="text-xs font-bold">Sessões clínicas registradas</h4>{procedure.sessions.map((session) => <div className="flex flex-wrap justify-between gap-2 border-t border-[#e7e8ef] pt-2 text-xs" key={session.id}><span><strong>{session.procedureName}</strong> · {new Date(session.performedAt).toLocaleDateString("pt-BR")} · {session.professional || "Profissional não informado"}<small className="mt-0.5 block text-[#77788a]">{session.technique || "Técnica não informada"} · {session.treatedAreas || "Região não informada"}{session.durationMinutes ? ` · ${session.durationMinutes} min` : ""}</small></span><Badge variant={session.status === "Concluída" ? "green" : "amber"}>{session.status}</Badge></div>)}</div> : null}
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
    <div className="flex items-center justify-between gap-2"><h4 className="text-xs font-bold text-[#303144]">Sessões de fotos</h4>{editable ? <button className="inline-flex items-center gap-1 rounded-[5px] px-2 py-1 text-xs font-bold text-[#5147dc] transition hover:bg-[#f0efff] disabled:cursor-not-allowed disabled:opacity-60" type="button" onClick={onCreatePhotoSession} disabled={creatingPhotoSession} aria-busy={creatingPhotoSession}>{creatingPhotoSession ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}{creatingPhotoSession ? "Criando..." : "Nova sessão"}</button> : null}</div>
    <div className="mt-2 grid gap-1.5">{photoSessions.map((session, index) => { const sessionKey = `${procedureId ?? "procedure"}-${session.id}`; const canManage = editable && !session.id.startsWith("legacy-"); return <div className={cn("flex items-center gap-1 rounded-[5px] border p-1 transition", session.id === activePhotoSessionId ? "border-[#5147dc] bg-[#f0efff]" : "border-[#e7e9f2] bg-white")} key={session.id}><button className={cn("min-w-0 flex-1 rounded-[4px] px-1.5 py-1.5 text-left text-xs font-semibold", session.id === activePhotoSessionId ? "text-[#5147dc]" : "text-[#656678] hover:text-[#5147dc]")} type="button" onClick={() => onSelectPhotoSession(session.id)} aria-pressed={session.id === activePhotoSessionId}><span className="block truncate">{session.name || `Sessão ${index + 1}`}</span><span className="block text-xs text-[#858696]">{session.beforePhoto || session.afterPhoto ? "Com fotos" : "Vazia"}</span></button>{canManage ? <><button className="grid h-7 w-7 shrink-0 place-items-center rounded-[4px] text-[#858696] transition hover:bg-[#f0efff] hover:text-[#5147dc]" type="button" aria-label={`Editar ${session.name || `Sessão ${index + 1}`}`} title="Editar nome" onClick={() => onEditPhotoSession(session.id)}><PencilLine className="h-3.5 w-3.5" /></button><button className="grid h-7 w-7 shrink-0 place-items-center rounded-[4px] text-[#858696] transition hover:bg-[#fff0ee] hover:text-[#b42318] disabled:cursor-not-allowed disabled:opacity-45" type="button" aria-label={`Excluir ${session.name || `Sessão ${index + 1}`}`} title="Excluir sessão" disabled={Boolean(deletingPhotoSessionKey === sessionKey)} onClick={() => onDeletePhotoSession(session.id)}><Trash2 className="h-3.5 w-3.5" /></button></> : null}</div>; })}</div>
    <div className="mt-4 border-t border-[#e7e9f2] pt-3"><div className="flex items-center justify-between gap-2"><h4 className="text-xs font-bold text-[#303144]">{activePhotoSession?.name ?? "Fotos"}</h4><span className="text-xs font-semibold text-[#858696]">Antes / depois</span></div><div className="mt-2 grid grid-cols-2 gap-2"><ProcedurePhotoThumbnail label="Antes" src={beforeImage} editable={editable} saving={beforeSaving} onPreview={onBeforePreview} onRemove={onBeforePhotoRemove} /><ProcedurePhotoThumbnail label="Depois" src={afterImage} editable={editable} saving={afterSaving} disabled={!afterPhotoEnabled} onPreview={onAfterPreview} onRemove={onAfterPhotoRemove} /></div>{editable ? <div className="mt-3 grid gap-2"><PhotoInput icon={Upload} label={beforeImage ? "Trocar foto antes" : "Adicionar foto antes"} busyLabel={beforeOperation === "remove" ? "Removendo..." : "Carregando..."} disabled={beforeSaving} onChange={onBeforePhotoChange} /><PhotoInput icon={Upload} label={afterImage ? "Trocar foto depois" : "Adicionar foto depois"} busyLabel={afterOperation === "remove" ? "Removendo..." : "Carregando..."} disabled={afterSaving || !afterPhotoEnabled} blocked={!afterPhotoEnabled && !afterSaving} onChange={onAfterPhotoChange} />{afterPhotoMessage && !afterPhotoEnabled ? <p className="text-xs font-semibold text-[#858696]">{afterPhotoMessage}</p> : null}</div> : null}</div>
  </aside>;
}

function ProcedurePhotoThumbnail({ label, src, editable, saving, disabled, onPreview, onRemove }: { label: string; src?: string; editable?: boolean; saving?: boolean; disabled?: boolean; onPreview?: (src: string) => void; onRemove?: () => void }) {
  return <div className="overflow-hidden rounded-[5px] border border-[#e7e9f2] bg-white"><div className="px-2 py-1.5 text-xs font-bold uppercase text-[#858696]">{label}</div><div className="relative aspect-[9/16] bg-[#f1f2f7]">{src ? <button className="absolute inset-0 cursor-zoom-in" type="button" onClick={() => onPreview?.(src)} aria-label={`Ampliar foto ${label.toLowerCase()}`}><Image className="object-cover" src={src} alt={`Miniatura da foto ${label.toLowerCase()}`} fill sizes="130px" /></button> : <span className="absolute inset-0 grid place-items-center px-2 text-center text-xs font-semibold text-[#858696]">Sem foto</span>}{editable && src ? <button className="absolute right-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded-full bg-[#25263a]/80 text-white transition hover:bg-[#b42318] disabled:cursor-not-allowed disabled:opacity-50" type="button" aria-label={`Remover foto ${label.toLowerCase()}`} disabled={saving || disabled} onClick={onRemove}><X className="h-3 w-3" /></button> : null}</div></div>;
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
  return src ? <button className="absolute inset-0 h-full w-full cursor-zoom-in" type="button" aria-label={`Ampliar ${label.toLowerCase()}`} onClick={(event) => { event.stopPropagation(); onPreview(src); }}><Image className="object-cover" src={src} alt={alt} fill draggable={false} onDragStart={(event) => event.preventDefault()} sizes="(max-width: 640px) 90vw, 420px" /><span className="absolute bottom-3 left-3 rounded-full bg-white/90 px-2.5 py-1 text-xs font-bold text-[#303144] shadow-[0_3px_10px_rgba(37,38,58,0.12)]">{label}</span></button> : <div className="absolute inset-0"><span className={cn("absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-xs font-semibold text-[#858696]", emptySide === "before" ? "left-[5%]" : "right-[5%]")}>Nenhuma foto cadastrada</span></div>;
}

function ComparisonPhotoControls({ label, saving, operation, photoInputEnabled = true, blockedMessage, onPhotoChange, onPhotoRemove }: { label: string; saving?: boolean; operation?: "upload" | "remove"; photoInputEnabled?: boolean; blockedMessage?: string; onPhotoChange?: (file: File) => void; onPhotoRemove?: () => void }) {
  return <div className="mt-2 flex gap-2"><PhotoInput icon={Upload} label={`${label}: enviar`} busyLabel={operation === "remove" ? "Removendo..." : "Carregando..."} disabled={saving || !photoInputEnabled} blocked={!photoInputEnabled && !saving} onChange={onPhotoChange} /><PhotoInput icon={Camera} label={`${label}: tirar`} busyLabel={operation === "remove" ? "Removendo..." : "Carregando..."} capture disabled={saving || !photoInputEnabled} blocked={!photoInputEnabled && !saving} onChange={onPhotoChange} />{onPhotoRemove ? <button className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[#dddfea] text-[#77788a] transition hover:border-[#b42318] hover:text-[#b42318] disabled:cursor-not-allowed disabled:opacity-50" type="button" aria-label={`Remover foto de ${label.toLowerCase()}`} disabled={saving || !photoInputEnabled} onClick={onPhotoRemove}><X className="h-3 w-3" /></button> : null}{blockedMessage && !photoInputEnabled ? <span className="sr-only">{blockedMessage}</span> : null}</div>;
}

function BeforeAfterPhoto({ label, overlayLabel, src, editable, photoInputEnabled = true, blockedMessage, saving, operation, onPhotoChange, onPhotoRemove, onPreview }: { label: string; overlayLabel?: string; src?: string; editable?: boolean; photoInputEnabled?: boolean; blockedMessage?: string; saving?: boolean; operation?: "upload" | "remove"; onPhotoChange?: (file: File) => void; onPhotoRemove?: () => void; onPreview?: (src: string) => void }) {
  const imageSrc = src && src !== "__photo__" ? src : undefined;
  const hasPhoto = Boolean(src);
  return (
    <div className="w-full max-w-[280px] overflow-hidden rounded-[7px] border border-[#e7e9f2] bg-[#f7f8fc]">
      <div className="flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase text-[#858696]">
        <Camera className="h-3.5 w-3.5 text-[#5147dc]" />
        {label}
      </div>
      <div className="relative grid aspect-[9/16] w-full place-items-center text-xs font-semibold text-[#858696]">
        {saving ? <div className="flex flex-col items-center gap-2 text-[#5147dc]" aria-label={`${operation === "remove" ? "Removendo" : "Carregando"} foto de ${label.toLowerCase()}`}>
          <div className="hp-skeleton h-12 w-16 animate-pulse rounded-[5px]" />
          <span className="flex items-center gap-1 text-xs font-bold"><Loader2 className="h-3.5 w-3.5 animate-spin" />{operation === "remove" ? "Removendo foto..." : "Carregando foto..."}</span>
        </div> : imageSrc ? <>
          <button type="button" className="absolute inset-0 cursor-zoom-in" aria-label={`Ampliar foto de ${label.toLowerCase()}`} onClick={() => onPreview?.(imageSrc)}><Image className="object-cover transition-transform duration-200 hover:scale-[1.02]" src={imageSrc} alt={`Foto de ${label.toLowerCase()} do procedimento`} fill sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 400px" /></button>
          {overlayLabel ? <span className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-full bg-white/90 px-2.5 py-1 text-xs font-bold text-[#303144] shadow-[0_3px_10px_rgba(37,38,58,0.12)]">{overlayLabel}</span> : null}
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
    <label className={cn("inline-flex h-7 flex-1 cursor-pointer items-center justify-center gap-1 rounded-full border border-[#dddfea] bg-white px-2 text-xs font-bold text-[#5147dc] transition hover:border-[#5147dc]", disabled && "pointer-events-none opacity-50")} aria-busy={busy}>
      {busy ? <><Loader2 className="h-3 w-3 animate-spin" />{busyLabel}</> : <><Icon className="h-3 w-3" />{label}</>}
      <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture={capture ? "environment" : undefined} disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) onChange?.(file); event.currentTarget.value = ""; }} />
    </label>
  );
}

function AppointmentsTab({ requestStart, patientId, history, loading, error, onRetry, journeyNames, onNew, onOpenJourney, returnAppointmentTarget, onReturnAppointmentClose }: { requestStart?: (proceed: () => void) => void; patientId: string; history?: PatientHistoryRecord; loading: boolean; error: boolean; onRetry: () => void; journeyNames: Record<string, string>; onNew: () => void; onOpenJourney: (journeyId: string) => void; returnAppointmentTarget: ReturnAppointmentTarget | null; onReturnAppointmentClose: () => void }) {
  const canRun = useCan("appointment:run");
  const [returnDate, setReturnDate] = useState(() => clinicDateAfterDays(0));
  const [returnTime, setReturnTime] = useState("09:00");
  const [clinicHours, setClinicHours] = useState<{ openingTime: string; closingTime: string } | null>(() => readClientCache<{ openingTime: string; closingTime: string }>("/api/appointments/options") ?? null);
  const [returnReason, setReturnReason] = useState(() => returnAppointmentTarget ? returnAppointmentTarget.kind === "procedure" ? returnAppointmentTarget.name : `Retorno - ${returnAppointmentTarget.name}` : "");
  const [returnNotes, setReturnNotes] = useState("");
  const [returnSaving, setReturnSaving] = useState(false);
  const [returnError, setReturnError] = useState("");
  const [invalidReturnFields, setInvalidReturnFields] = useState<Set<string>>(new Set());
  const [editingAppointment, setEditingAppointment] = useState<PatientAppointmentRecord | null>(null);
  const [professionals, setProfessionals] = useState<Array<{ id: string; name: string }>>(() => readClientCache<{ professionals: Array<{ id: string; name: string }> }>("/api/team/professionals")?.professionals ?? []);
  const [professionalChoice, setProfessionalChoice] = useState<{ source: object; name: string } | null>(null);
  const professionalSource = editingAppointment ?? returnAppointmentTarget;
  // PROFESSIONAL só agenda para si mesmo ao criar; ao editar, o profissional original é mantido.
  const ownProfessional = useOwnProfessionalName();
  const lockedProfessional = editingAppointment ? null : ownProfessional;
  const returnProfessional = lockedProfessional ?? (professionalChoice && professionalChoice.source === professionalSource ? professionalChoice.name : professionalSource?.professional ?? "");

  useEffect(() => {
    if (!returnAppointmentTarget && !editingAppointment) return;
    let active = true;
    getCachedJson<{ openingTime: string; closingTime: string }>("/api/appointments/options")
      .then((data) => {
        if (!active) return;
        setClinicHours(data);
        if (!editingAppointment) setReturnTime(data.openingTime);
      })
      .catch(() => { if (active) setReturnError("Não foi possível carregar o horário de funcionamento da clínica."); });
    getCachedJson<{ professionals: Array<{ id: string; name: string }> }>("/api/team/professionals")
      .then((data) => { if (active) setProfessionals(data.professionals); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [returnAppointmentTarget, editingAppointment]);

  const [editedAppointments, setEditedAppointments] = useState<Record<string, PatientAppointmentRecord>>({});
  const [createdAppointments, setCreatedAppointments] = useState<PatientAppointmentRecord[]>([]);
  const [updatingAppointmentId, setUpdatingAppointmentId] = useState<string | null>(null);
  const [startConfirmation, setStartConfirmation] = useState<PatientAppointmentRecord | null>(null);
  const [checkAppointmentId, setCheckAppointmentId] = useState<string | null>(null);
  const [checkedAppointmentIds, setCheckedAppointmentIds] = useState<string[]>([]);
  const [currentTime, setCurrentTime] = useState(() => clinicNowForForm());
  const scheduleKind = returnAppointmentTarget?.kind ?? "return";
  const appointments = mergePatientAppointments(history?.appointments ?? [], createdAppointments)
    .map((appointment) => appointment.id && editedAppointments[appointment.id] ? editedAppointments[appointment.id] : appointment)
    .sort(comparePatientAppointments);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(clinicNowForForm()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  async function updateAppointmentStatus(appointment: PatientAppointmentRecord, status: "Em atendimento" | "Atendido") {
    if (!appointment.id) return false;
    setUpdatingAppointmentId(appointment.id);
    try {
      const response = await fetch(`/api/appointments/${appointment.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const data = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(data?.message ?? "Não foi possível atualizar o atendimento.");
      setEditedAppointments((current) => ({ ...current, [appointment.id as string]: { ...appointment, status } }));
      invalidateClientCache(`/api/patients/${patientId}/history`, "/api/agenda", "/api/dashboard/bootstrap", ...(status === "Atendido" ? ["/api/patients"] : []));
      if (status === "Atendido") setCheckAppointmentId(appointment.id);
      return true;
    } catch (statusError) {
      const message = statusError instanceof Error ? statusError.message : "Não foi possível atualizar o atendimento.";
      setReturnError(message);
      toast.error(message);
      return false;
    } finally {
      setUpdatingAppointmentId(null);
    }
  }

  async function confirmAppointmentStart() {
    if (!startConfirmation) return;
    if (await updateAppointmentStatus(startConfirmation, "Em atendimento")) setStartConfirmation(null);
  }

  function openEditAppointment(appointment: PatientAppointmentRecord) {
    setEditingAppointment(appointment);
    setProfessionalChoice(null);
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
    if (!clinicHours) {
      setReturnError("Não foi possível carregar o horário de funcionamento da clínica.");
      return;
    }
    if (!editingAppointment?.id && !returnProfessional) {
      setReturnError("Escolha o profissional.");
      return;
    }
    const slotError = appointmentSlotError(returnDate, returnTime, clinicHours.openingTime, clinicHours.closingTime, clinicNow());
    if (slotError) {
      setInvalidReturnFields(new Set([/data|passou/i.test(slotError) ? "date" : "time"]));
      setReturnError(slotError);
      return;
    }
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
          ...(editingAppointment?.id ? {} : { patientId, journeyId: returnAppointmentTarget?.journeyId }),
          procedure: returnReason.trim(),
          professional: returnProfessional || editingAppointment?.professional || returnAppointmentTarget?.professional,
          date: `${returnDate}T${returnTime}:00-03:00`,
          time: returnTime,
          notes: returnNotes.trim(),
        }),
      });
      const data = await response.json().catch(() => null) as { appointment?: { id: string; date: string; time: string; procedure: string; professional: string; status: string; notes: string; materialsCheck?: string | null; journeyId?: string | null }; message?: string } | null;
      const updatedAppointment = data?.appointment;
      if (!response.ok || !updatedAppointment) throw new Error(data?.message ?? "Não foi possível salvar o retorno.");
      const appointmentRecord: PatientAppointmentRecord = { id: updatedAppointment.id, date: formatAppointmentDisplayDate(updatedAppointment.date), time: updatedAppointment.time, procedure: updatedAppointment.procedure, professional: updatedAppointment.professional, status: updatedAppointment.status, notes: updatedAppointment.notes, materialsCheck: updatedAppointment.materialsCheck ?? null, dateKey: clinicDateKey(updatedAppointment.date), journeyId: updatedAppointment.journeyId ?? null };
      if (editingAppointment?.id) {
        setEditedAppointments((current) => ({ ...current, [editingAppointment.id as string]: { ...editingAppointment, date: formatAppointmentDisplayDate(updatedAppointment.date), time: updatedAppointment.time, procedure: updatedAppointment.procedure, professional: updatedAppointment.professional, status: updatedAppointment.status, notes: updatedAppointment.notes, dateKey: clinicDateKey(updatedAppointment.date) } }));
      } else {
        setCreatedAppointments((current) => mergePatientAppointments(current, [appointmentRecord]));
      }
      invalidateClientCache(`/api/patients/${patientId}/history`, "/api/patients", "/api/agenda", "/api/dashboard/bootstrap");
      setEditingAppointment(null); setProfessionalChoice(null);
      onReturnAppointmentClose();
    } catch (scheduleError) {
      setReturnError(scheduleError instanceof Error ? scheduleError.message : "Não foi possível marcar o retorno.");
    } finally {
      setReturnSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <PatientAppointmentsList
        appointments={appointments}
        loading={loading}
        error={error}
        onRetry={onRetry}
        journeyNames={journeyNames}
        canRun={canRun}
        updatingId={updatingAppointmentId}
        materialsPendingIds={new Set(appointments.flatMap((appointment) => appointment.id && appointment.status === "Atendido" && appointment.materialsCheck === "pending" && !checkedAppointmentIds.includes(appointment.id) ? [appointment.id] : []))}
        startState={(appointment) => {
          const withinWindow = appointmentWithinStartWindow(appointment, history?.appointmentToleranceMinutes ?? 15, currentTime);
          const updating = updatingAppointmentId === appointment.id;
          return { allowed: canRequestAppointmentStart(appointment, history?.procedureNames ?? [], withinWindow, updating), updating, title: withinWindow ? "Iniciar atendimento" : matchesProcedureAppointment(appointment, history?.procedureNames ?? []) ? "Confirmar início fora do horário" : "Aguarde o horário do atendimento" };
        }}
        onNew={onNew}
        onStart={(appointment) => {
          const withinWindow = appointmentWithinStartWindow(appointment, history?.appointmentToleranceMinutes ?? 15, currentTime);
          const start = () => { if (matchesProcedureAppointment(appointment, history?.procedureNames ?? []) && !withinWindow) setStartConfirmation(appointment); else void updateAppointmentStatus(appointment, "Em atendimento"); };
          if (requestStart) requestStart(start); else start();
        }}
        onFinish={(appointment) => void updateAppointmentStatus(appointment, "Atendido")}
        onReschedule={openEditAppointment}
        onOpenJourney={onOpenJourney}
        onCheckMaterials={(appointment) => setCheckAppointmentId(appointment.id ?? null)}
      />
      <Modal open={Boolean(returnAppointmentTarget || editingAppointment)} onClose={() => { if (!returnSaving) { setEditingAppointment(null); setProfessionalChoice(null); onReturnAppointmentClose(); } }} title={editingAppointment ? "Reagendar" : scheduleKind === "procedure" ? "Marcar procedimento" : "Marcar retorno"} description={editingAppointment ? "Atualize os dados do retorno agendado." : scheduleKind === "procedure" ? "O procedimento será incluído na lista de agendamentos da clínica." : "O retorno será incluído na lista de agendamentos da clínica."}>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveReturnAppointment}>
          <div className="sm:col-span-2 rounded-[7px] border border-[#e8e8ef] bg-[#fafafd] p-3 text-xs text-[#555668]">Procedimento: <strong className="text-[#303144]">{editingAppointment?.procedure ?? returnAppointmentTarget?.name}</strong></div>
          <div className="sm:col-span-2"><FormField label="Profissional"><select className={fieldClassName} value={returnProfessional} disabled={Boolean(lockedProfessional)} onChange={(event) => { if (professionalSource) setProfessionalChoice({ source: professionalSource, name: event.target.value }); }} required>
            {!returnProfessional ? <option value="" disabled>Selecione o profissional</option> : null}
            {returnProfessional && !professionals.some((professional) => professional.name === returnProfessional) ? <option value={returnProfessional}>{returnProfessional}</option> : null}
            {professionals.map((professional) => <option key={professional.id} value={professional.name}>{professional.name}</option>)}
          </select></FormField></div>
          <FormField label="Data"><input className={cn(fieldClassName, invalidReturnFields.has("date") && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} type="date" value={returnDate} required onChange={(event) => { setReturnDate(event.target.value); setInvalidReturnFields((current) => { const next = new Set(current); next.delete("date"); return next; }); setReturnError(""); }} /></FormField>
          <FormField label="Horário">{clinicHours ? <ClinicTimePicker openingTime={clinicHours.openingTime} closingTime={clinicHours.closingTime} latestTime={latestAppointmentStart(clinicHours.closingTime)} value={returnTime} invalid={invalidReturnFields.has("time")} className={fieldClassName} onChange={(value) => { setReturnTime(value); setInvalidReturnFields((current) => { const next = new Set(current); next.delete("time"); return next; }); setReturnError(""); }} /> : <button type="button" disabled className={cn(fieldClassName, "text-left opacity-60")}>Carregando horários...</button>}</FormField>
          <div className="sm:col-span-2"><FormField label={editingAppointment || scheduleKind === "procedure" ? "Procedimento" : "Motivo do retorno"}><input className={fieldClassName} value={returnReason} required placeholder={scheduleKind === "procedure" ? "Ex.: Botox" : "Ex.: avaliação do resultado"} onChange={(event) => setReturnReason(event.target.value)} /></FormField></div>
          <div className="sm:col-span-2"><FormField label="Observações"><textarea className={`${fieldClassName} h-24 resize-none py-2`} value={returnNotes} placeholder="Adicione informações importantes para o atendimento" onChange={(event) => setReturnNotes(event.target.value)} /></FormField></div>
          {returnError ? <p className="rounded-[7px] bg-[#fff1f0] px-3 py-2 text-xs font-semibold text-[#b42318] sm:col-span-2">{returnError}</p> : null}
          <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" disabled={returnSaving} onClick={() => { setEditingAppointment(null); setProfessionalChoice(null); onReturnAppointmentClose(); }}>Cancelar</Button><Button type="submit" disabled={returnSaving || !clinicHours}>{returnSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : editingAppointment ? <PencilLine className="h-3.5 w-3.5" /> : <CalendarPlus className="h-3.5 w-3.5" />}{returnSaving ? "Salvando..." : editingAppointment ? "Salvar alterações" : scheduleKind === "procedure" ? "Confirmar procedimento" : "Confirmar retorno"}</Button></div>
        </form>
      </Modal>
      <Modal open={Boolean(startConfirmation)} onClose={() => { if (!updatingAppointmentId) setStartConfirmation(null); }} title="Iniciar fora do horário" description={startConfirmation ? `Agendado para ${startConfirmation.date} às ${startConfirmation.time}.` : undefined}>
        <div className="space-y-4">
          <p className="text-sm text-[#555668]">Este procedimento está fora do período normal do agendamento. Deseja iniciar mesmo assim?</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={Boolean(updatingAppointmentId)} onClick={() => setStartConfirmation(null)}>Cancelar</Button><Button type="button" disabled={Boolean(updatingAppointmentId)} onClick={() => void confirmAppointmentStart()}>{updatingAppointmentId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock3 className="h-3.5 w-3.5" />}{updatingAppointmentId ? "Iniciando..." : "Confirmar início"}</Button></div>
        </div>
      </Modal>
      {checkAppointmentId ? <MaterialCheckModal appointmentId={checkAppointmentId} onClose={() => setCheckAppointmentId(null)} onDone={(message) => { setCheckedAppointmentIds((current) => [...current, checkAppointmentId]); setCheckAppointmentId(null); invalidateClientCache(`/api/patients/${patientId}/history`); toast.success(message); }} /> : null}
    </div>
  );
}

function ObservationsTab({ patientId }: { patientId: string }) {
  const url = `/api/patients/${patientId}/observations`;
  const [observations, setObservations] = useState<PatientObservation[] | null>(() => readClientCache<{ observations: PatientObservation[] }>(url)?.observations ?? null);
  const kinds = observationKindsFor(useCurrentRole());
  const [kind, setKind] = useState<ObservationKind>("clinical");
  const effectiveKind = kinds.includes(kind) ? kind : kinds[0];
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!patientId) return;
    let active = true;
    getCachedJson<{ observations: PatientObservation[] }>(url).then((data) => { if (active) setObservations(data.observations); }).catch(() => { if (active) setObservations((current) => current ?? []); });
    return () => { active = false; };
  }, [patientId, url]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, kind: effectiveKind }) });
      const data = await response.json().catch(() => null) as { observation?: PatientObservation; message?: string } | null;
      if (!response.ok || !data?.observation) { setError(data?.message ?? "Não foi possível salvar a observação."); return; }
      invalidateClientCache(url, `/api/patients/${patientId}/history`);
      setObservations((current) => [data.observation as PatientObservation, ...(current ?? [])]);
      setText("");
      setAdding(false);
      toast.success("Observação adicionada.");
    } catch {
      setError("Não foi possível salvar a observação.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div><h3 className="text-sm font-bold text-[#303144]">Observações do paciente</h3><p className="mt-1 text-xs text-[#858696]">Anotações da equipe sobre este cliente.</p></div>
        {!adding ? <Button className="shrink-0" type="button" variant="secondary" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" />Adicionar observação</Button> : null}
      </div>
      {adding ? (
        <Card className="p-4">
          <form className="space-y-3" onSubmit={save}>
            {kinds.length > 1 ? <FormField label="Tipo"><select className={fieldClassName} value={effectiveKind} onChange={(event) => setKind(event.target.value as ObservationKind)}><option value="clinical">Clínica</option><option value="administrative">Administrativa</option></select></FormField> : null}
            <FormField label="Observação"><textarea className={`${fieldClassName} h-24 resize-none py-2`} value={text} maxLength={2000} autoFocus placeholder="Escreva a observação" onChange={(event) => { setText(event.target.value); setError(""); }} /></FormField>
            {error ? <p className="rounded-[7px] bg-[#fff1f0] px-3 py-2 text-xs font-semibold text-[#b42318]">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" disabled={saving} onClick={() => { setAdding(false); setText(""); setError(""); }}>Cancelar</Button>
              <Button type="submit" disabled={saving || !text.trim()}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{saving ? "Salvando..." : "Salvar observação"}</Button>
            </div>
          </form>
        </Card>
      ) : null}
      {observations === null ? <Card className="space-y-3 p-5"><LoadingSkeleton className="h-4 w-44" /><LoadingSkeleton className="h-3 w-64 max-w-full" /></Card>
        : !observations.length ? (adding ? null : <EmptyPatientState message="Este cliente ainda não possui observações." />)
        : <div className="space-y-3">{observations.map((observation) => (
          <Card className="p-4" key={observation.id}>
            <p className="whitespace-pre-wrap text-sm leading-6 text-[#555668]">{observation.text}</p>
            <p className="mt-2 text-xs text-[#858696]">{new Date(observation.createdAt).toLocaleDateString("pt-BR")} · {observation.authorName}</p>
            {observation.kind === "administrative" ? <div className="mt-2"><Badge variant="slate">Administrativa</Badge></div> : null}
          </Card>
        ))}</div>}
    </div>
  );
}

function EmptyInline({ text }: { text: string }) {
  return <div className="rounded-[7px] border border-dashed border-[#d9dce8] p-4 text-xs font-semibold text-[#858696]">{text}</div>;
}
