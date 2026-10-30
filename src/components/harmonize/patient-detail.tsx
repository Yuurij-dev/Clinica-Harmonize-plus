"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarPlus,
  CalendarDays,
  Camera,
  Clock3,
  ClipboardList,
  CreditCard,
  FolderOpen,
  ChevronRight,
  FileText,
  Loader2,
  LayoutDashboard,
  PencilLine,
  Plus,
  Phone,
  Syringe,
  UserRound,
  X,
} from "lucide-react";
import type { CustomerJourneyStage, JourneyStageId, Patient } from "@/types/clinic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SlidingIndicator } from "@/components/ui/sliding-indicator";
import { ScrollFade } from "@/components/ui/scroll-fade";
import { AnimatedPage } from "./animated-page";
import { MaskedInput } from "@/components/ui/masked-input";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { MaterialCheckModal } from "./material-check-modal";
import type { MaterialUsed } from "./materials-used";
import { PatientExpenses } from "./patient-expenses";
import { PatientFinance } from "./patient-finance";
import { CustomerJourney } from "./customer-journey";
import { PhotoEditor } from "./photo-editor/photo-editor";
import { EmptyState, LoadingSkeleton } from "./shared";
import { CLIENT_CACHE_INVALIDATED_EVENT, getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { observationKindsFor, type ObservationKind } from "@/lib/permissions";
import { useCan, useCurrentRole } from "./current-user";
import { appointmentSlotError, appointmentWithinStartWindow, canRequestAppointmentStart, clinicNow, latestAppointmentStart, matchesProcedureAppointment } from "@/lib/clinic-time";
import { mergePatientAppointments } from "@/lib/patient-appointments";
import { FormField, fieldClassName } from "@/components/ui/modal";
import { formatCpf, formatInteger, formatPhone } from "@/lib/input-masks";
import { isMaskedCpf } from "@/lib/patient-cpf-mask";
import { PatientOverview, PatientTreatments, type PatientJourneySummary } from "./patient-profile-views";
import { ClinicTimePicker } from "./clinic-time-picker";
import { clinicDateKey, type EncounterItem } from "@/lib/clinical-record-rules";
import type { AnamnesisRequest } from "@/lib/anamnesis-rules";
import { guardDraftNavigation } from "./use-draft-autosave";
import { evaluationStepFromParams, paramsWithEvaluationStep, type EvaluationStep } from "@/lib/evaluation-step-rules";
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

// A etapa facial da avaliação tem URL própria (`?journey=<id>&step=facial`); só troca a query, sem refazer a rota do Next.
function writeStepToUrl(step: EvaluationStep, mode: "push" | "replace") {
  const params = paramsWithEvaluationStep(new URLSearchParams(window.location.search), step);
  const url = `${window.location.pathname}?${params.toString()}`;
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

// Voltar/Avançar recusado (rascunho sem gravar e a pessoa quis ficar): reescreve a URL do editor sem depender da direção do histórico.
function restoreEditorUrl(route: { journeyId: string | null; patientKey: string; step: EvaluationStep }) {
  if (!route.journeyId) return;
  const params = new URLSearchParams(window.location.search);
  params.set("patient", route.patientKey);
  params.set("journey", route.journeyId);
  const url = `${window.location.pathname}?${paramsWithEvaluationStep(params, route.step).toString()}`;
  if (url !== `${window.location.pathname}${window.location.search}`) window.history.pushState(null, "", url);
}

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
  const [encounterStep, setEncounterStep] = useState<EvaluationStep>(() => typeof window === "undefined" ? "clinical" : evaluationStepFromParams(new URLSearchParams(window.location.search)));
  // O popstate precisa saber se o editor da avaliação está aberto e de qual tratamento, sem refazer o efeito a cada render.
  const editorRouteRef = useRef<{ journeyId: string | null; editing: boolean; patientKey: string; step: EvaluationStep }>({ journeyId: null, editing: false, patientKey: "", step: "clinical" });
  useEffect(() => { editorRouteRef.current = { journeyId: selectedJourneyId, editing: encounterMode, patientKey: currentPatient.id ?? currentPatient.name, step: encounterStep }; });
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
      const nextJourney = params.get("journey");
      const route = editorRouteRef.current;
      // Voltar/avançar entre as etapas da avaliação do mesmo tratamento só troca a visão: o editor segue montado, sem recarregar nem perder edições.
      if (nextJourney && route.editing && nextJourney === route.journeyId) { setEncounterStep(evaluationStepFromParams(params)); return; }
      const apply = () => {
        setSelectedJourneyId(nextJourney);
        setJourneyWorkflowLoading(params.has("journey"));
        setJourneyWorkflowError("");
        setEncounterMode(false);
        setEncounterQuoteMode(false);
        setEncounterProcedureMode(false);
        setEncounterPostProcedureMode(false);
        setEncounterPostProcedureInitialView("post");
        setEncounterStep(evaluationStepFromParams(params));
        // Mesmo tratamento (ex.: voltou de outra etapa do fluxo): o efeito da jornada não rodaria sozinho, então pede de novo a etapa certa.
        if (nextJourney && nextJourney === route.journeyId) setJourneyWorkflowRetry((value) => value + 1);
        if (nextJourney) setActiveTab("Tratamentos");
      };
      // Saindo do editor por Voltar/Avançar do navegador: grava o rascunho pendente antes de desmontar. Se não der e a pessoa quiser ficar, a URL volta ao
      // endereço do editor, montado de novo (paciente + tratamento + etapa), com pushState: não depende da direção nem de haver entrada à frente.
      if (route.editing) { void guardDraftNavigation().then((ok) => { if (ok) apply(); else restoreEditorUrl(route); }); return; }
      apply();
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
    // Abrir ou sair de um tratamento sempre começa na etapa clínica: nunca herda o `step` da URL anterior.
    params.delete("step");
    setEncounterStep("clinical");
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
    if (tab === "Arquivos e fotos") { openPhotos({}); return; }
    if (tab === "Agendamentos" || tab === "Atendimentos" || tab === "Histórico") { primeAppointmentsHistory(); setRecordTab("Agendamentos"); return; }
    const [area, preset] = tab.split(":");
    if (area === "Documentos clínicos") setDocumentsPreset((current) => ({ category: isDocumentCategory(preset) ? preset : null, nonce: current.nonce + 1 }));
    setRecordTab(area);
  }

  function openPhotos(filters: Partial<PhotoFilters>) {
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

  function changeEncounterStep(step: EvaluationStep) {
    if (step === encounterStep) return;
    setEncounterStep(step);
    writeStepToUrl(step, "push");
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
        // Reabrir a URL da etapa facial só vale quando a jornada ainda está na avaliação; nas demais etapas o `step` sobrando é removido.
        if ((journey.hasEvaluation && evaluation && evaluation.status !== "Rascunho") && new URLSearchParams(window.location.search).has("step")) {
          setEncounterStep("clinical");
          writeStepToUrl("clinical", "replace");
        }
        setSelectedJourneyLabel(journey.name);
        setEncounterLabel(journey.name);
        setEncounterEvaluationId(evaluation?.id);
        // Com sessão concluída, o orçamento de referência é o da própria sessão (volta do pós ao orçamento/procedimento).
        setEncounterQuoteId(journey.latestCompletedQuoteId ?? approvedQuote?.id ?? undefined);
        setEncounterPostProcedureSessionId(journey.latestCompletedSessionId ?? undefined);
        setJourneyPastProcedure(journey.hasProcedure || Boolean(journey.latestCompletedSessionId));

        if (!journey.hasEvaluation || !evaluation || evaluation.status === "Rascunho") {
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
  }, [journeyPage, selectedJourneyId, currentPatient.id, journeyWorkflowRetry]);

  useEffect(() => {
    if (!currentHistoryKey || !historyTab || !shouldLoadPatientHistory(historyTab)) return;
    let cancelled = false;
    getCachedJson<PatientHistoryResponse>(currentHistoryKey)
      .then((data) => {
        if (cancelled) return;
        const mapped = mapPatientHistory(data);
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
    return <div className="mx-auto max-w-[1400px]"><PhotoEditor patientId={currentPatient.id} evaluationId={encounterEvaluationId} journeyId={selectedJourneyId ?? undefined} patientName={currentPatient.name} encounterLabel={encounterLabel} readOnly={journeyPastProcedure} step={encounterStep} onStepChange={changeEncounterStep} encounter={{ patient: currentPatient, onContinue: (savedEvaluationId) => { setEncounterEvaluationId(savedEvaluationId); setEncounterMode(false); setEncounterQuoteMode(true); setEncounterStep("clinical"); writeStepToUrl("clinical", "replace"); }, onClients: onBack, onPatient: returnToPatientProfile, onJourney: () => openJourney(null) }} onSaved={() => { setHistory(undefined); setHistoryLoading(true); setHistoryRefreshKey((current) => current + 1); }} /></div>;
  }

  if (encounterQuoteMode && currentPatient.id) {
    return <div data-hide-fab className="mx-auto max-w-[1400px]"><PatientExpenses key={`${currentPatient.id}-${selectedJourneyId ?? "none"}-${encounterEvaluationId ?? "none"}`} patientId={currentPatient.id} patient={currentPatient} journeyId={selectedJourneyId ?? undefined} evaluationId={encounterEvaluationId} quoteId={encounterQuoteFocusId} journeyLabel={encounterLabel} breadcrumb={{ onClients: onBack, onPatient: returnToPatientProfile, onJourney: () => openJourney(null) }} mode="encounter" readOnly={journeyPastProcedure} onReturnToEvaluation={() => { setEncounterQuoteMode(false); setEncounterMode(true); changeEncounterStep("facial"); }} onAdvance={(quoteId) => { setEncounterQuoteId(quoteId); setEncounterQuoteMode(false); setEncounterProcedureMode(true); }} /></div>;
  }

  if (encounterProcedureMode && currentPatient.id && encounterQuoteId) {
    return <div data-hide-fab className="mx-auto max-w-[1400px]"><PatientExpenses key={`${currentPatient.id}-${selectedJourneyId ?? "none"}-${encounterQuoteId}`} patientId={currentPatient.id} patient={currentPatient} journeyId={selectedJourneyId ?? undefined} quoteId={encounterQuoteId} breadcrumb={{ onClients: onBack, onPatient: returnToPatientProfile, onJourney: () => openJourney(null) }} mode="procedure" onReturnToQuote={() => { setEncounterProcedureMode(false); setEncounterQuoteFocusId(encounterQuoteId); setEncounterQuoteMode(true); }} onCompleted={(sessionId) => { setJourneyPastProcedure(true); setEncounterProcedureMode(false); setEncounterPostProcedureInitialView("post"); setEncounterPostProcedureSessionId(sessionId); setEncounterPostProcedureMode(true); setActiveTab("Tratamentos"); setHistory(undefined); setHistoryLoading(true); setHistoryRefreshKey((value) => value + 1); setPinnedRefreshKey((value) => value + 1); }} /></div>;
  }

  if (encounterPostProcedureMode && currentPatient.id && selectedJourneyId && encounterPostProcedureSessionId) {
    return <div data-hide-fab className="mx-auto max-w-[1400px]"><PatientExpenses key={`${currentPatient.id}-${selectedJourneyId}-${encounterPostProcedureSessionId}`} patientId={currentPatient.id} patient={currentPatient} journeyId={selectedJourneyId} sessionId={encounterPostProcedureSessionId} initialView={encounterPostProcedureInitialView} breadcrumb={{ onClients: onBack, onPatient: returnToPatientProfile, onJourney: () => openJourney(null) }} mode="post-procedure" onReturnToQuote={encounterQuoteId ? () => { setEncounterPostProcedureMode(false); setEncounterQuoteFocusId(encounterQuoteId); setEncounterQuoteMode(true); } : undefined} onReturnToProcedure={encounterQuoteId ? () => { setEncounterPostProcedureMode(false); setEncounterProcedureMode(true); } : undefined} onFinish={() => { setEncounterPostProcedureMode(false); setEncounterPostProcedureSessionId(undefined); setEncounterPostProcedureInitialView("post"); setHistory(undefined); setHistoryLoading(true); setHistoryRefreshKey((value) => value + 1); setPinnedRefreshKey((value) => value + 1); openJourney(null); }} /></div>;
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
          <button className="rounded-sm transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 max-lg:min-h-11 max-lg:px-1" type="button" onClick={() => guarded(onBack)}>Clientes</button>
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
          <span aria-current="page" className="font-semibold text-foreground">{currentPatient.name}</span>
        </nav>
        <button type="button" onClick={() => guarded(onBack)} className="flex items-center gap-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-primary max-lg:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"><ArrowLeft className="h-4 w-4" />Voltar para clientes</button>
        </>
      )}

      <Card className={cn("grid overflow-hidden p-0", pinnedJourney && "lg:grid-cols-[350px_minmax(0,1fr)]")}>
        <div className={cn("flex min-w-0 flex-wrap items-center justify-between gap-4 p-4", pinnedJourney && "border-b border-[#ececf2] lg:border-b-0 lg:border-r")}>
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
          <div className="flex w-full flex-wrap items-center gap-2 max-lg:[&>button]:flex-auto lg:w-auto">
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
        <div className="relative flex lg:min-w-max lg:px-2" role="tablist" aria-label="Áreas do prontuário">
          {tabs.map(({ label, icon: Icon }) => (
            <button
              className={cn(
                "flex items-center gap-2 border-b-2 border-transparent px-5 py-3 text-sm font-semibold transition-colors max-lg:min-h-14 max-lg:min-w-0 max-lg:flex-1 max-lg:flex-col max-lg:justify-center max-lg:gap-1 max-lg:whitespace-nowrap max-lg:px-0 max-lg:py-2",
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
              <span className="max-lg:text-xs max-lg:font-medium">{label}</span>
            </button>
          ))}
          <SlidingIndicator />
        </div>
      </Card> : null}

      <AnimatedPage routeKey={activeTab}>
      {activeTab === "Visão geral" ? <PatientOverview patient={currentPatient} onOpen={(area, tab) => { if (tab === "Dados") { setEditPatientOpen(true); return; } selectTab(area); if (tab) selectRecordTab(tab); }} onOpenJourney={(journeyId) => openJourney(journeyId)} onNewAppointment={openNewAppointment} onOpenFollowUp={(journey, sessionId) => { openJourney(journey.id); setEncounterPostProcedureSessionId(sessionId); setEncounterPostProcedureInitialView("return"); setEncounterPostProcedureMode(true); }} /> : null}
      {activeTab === "Tratamentos" ? <PatientTreatments patient={currentPatient} onBeforeNewTreatment={(proceed) => startGate.requestStart(proceed, { skipLabel: initialEvaluationLabel })} newTreatmentRequest={treatmentRequest} onNewTreatmentRequestHandled={() => setTreatmentRequest(0)} selectedJourneyId={selectedJourneyId} onSelect={openJourney} onJourneyLabelChange={setSelectedJourneyLabel} onBack={() => openJourney(null)} onOpenClinical={(tab) => { if (tab === "Financeiro") selectTab(tab); else if (tab === "Fotos" || tab === "Arquivos e fotos") openPhotos({ journeyId: selectedJourneyId ?? "" }); else { selectTab("Prontuário"); selectRecordTab(tab); } }} onOpenEvaluation={openJourneyEvaluation} onNewSession={(journey) => openAppointmentDialog({ name: journey.name, professional: journey.professional, kind: "procedure", journeyId: journey.id })} onScheduleReturn={(journey) => openAppointmentDialog({ name: journey.name, professional: journey.professional, kind: "return", journeyId: journey.id })} onOpenFollowUp={(journey, sessionId) => { openJourney(journey.id); setEncounterPostProcedureInitialView("post"); setEncounterPostProcedureSessionId(sessionId); setEncounterPostProcedureMode(true); }} /> : null}
      {activeTab === "Prontuário" ? <div className="space-y-4">
        <ScrollFade className="flex snap-x gap-1 border-b border-border" role="tablist" aria-label="Seções do prontuário">{visibleRecordTabs.map(({ label, icon: Icon }) => <button className={cn("flex shrink-0 snap-start items-center gap-2 border-b-2 border-transparent px-4 py-2.5 text-sm font-semibold transition-colors max-lg:min-h-11", recordTab === label ? "text-primary" : "text-muted-foreground hover:text-foreground")} type="button" key={label} role="tab" aria-selected={recordTab === label} onClick={() => void changeRecordTab(label)}><Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{label}</button>)}<SlidingIndicator /></ScrollFade>
        <AnimatedPage routeKey={recordTab} skipInitial className="space-y-4">
        {recordTab === "Resumo clínico" ? <PatientClinicalSummary patientId={currentPatient.id ?? ""} onStart={() => requestPrimaryStart()} onOpenEncounter={openEncounter} onGoToAppointments={() => selectRecordTab("Agendamentos")} onGoToAnamnesis={() => openAnamnesis("view")} onGoToDocuments={() => setRecordTab("Documentos clínicos")} onGoToTreatments={() => selectTab("Tratamentos")} onReschedule={(next) => openAppointmentDialog({ name: next?.procedure ?? "", professional: next?.professional ?? "", kind: "return", journeyId: next?.journeyId ?? selectedJourneyId ?? undefined })} observations={<ObservationsTab patientId={currentPatient.id ?? ""} />} /> : null}
        {recordTab === "Agendamentos" && currentPatient.id ? <AppointmentsTab requestStart={startGate.requestStart} patientId={currentPatient.id} history={history} loading={historyLoading} error={historyError} onRetry={retryAppointmentsHistory} journeyNames={Object.fromEntries((journeysResource.data?.journeys ?? []).map((journey) => [journey.id, journey.name]))} onNew={openNewAppointment} onOpenJourney={(journeyId) => openJourney(journeyId)} returnAppointmentTarget={returnAppointmentTarget} onReturnAppointmentClose={() => setReturnAppointmentTarget(null)} /> : null}
        {recordTab === "Anamnese" ? currentPatient.id ? <PatientAnamnesis patientId={currentPatient.id} patientName={currentPatient.name} request={anamnesisRequest} onRequestHandled={() => setAnamnesisRequest(null)} /> : <EmptyState title="Cliente ainda não foi salvo" description="Salve o cliente antes de preencher a anamnese." /> : null}
        {recordTab === "Documentos clínicos" && currentPatient.id ? <PatientClinicalDocuments key={`documents-${documentsPreset.nonce}`} patientId={currentPatient.id} initialCategory={documentsPreset.category} onOpenAnamnesis={() => openAnamnesis("view")} onOpenEvaluation={(evaluationId) => setSummaryEvaluationId(evaluationId)} /> : null}
        {recordTab === "Fotos" && currentPatient.id ? <PatientClinicalPhotos key={`photos-${photosPreset.nonce}`} patientId={currentPatient.id} initialFilters={photosPreset.filters} /> : null}
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
  const cpfMasked = isMaskedCpf(patient.cpf);

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
      // CPF mascarado (recepção): campo vazio = manter o atual, então não enviamos o CPF.
      const keepCpf = cpfMasked && !cpf;
      const response = await fetch(`/api/patients/${patient.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, ...(keepCpf ? {} : { cpf }), phone, age }) });
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
        <FormField label="CPF"><MaskedInput className={cn(fieldClassName, invalidFields.has("cpf") && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} formatter={formatCpf} name="cpf" inputMode="numeric" maxLength={14} placeholder={cpfMasked ? `${patient.cpf} (em branco mantém)` : "000.000.000-00"} defaultValue={cpfMasked ? "" : patient.cpf ?? ""} /></FormField>
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

function AppointmentsTab({ requestStart, patientId, history, loading, error, onRetry, journeyNames, onNew, onOpenJourney, returnAppointmentTarget, onReturnAppointmentClose }: { requestStart?: (proceed: () => void) => void; patientId: string; history?: PatientHistoryRecord; loading: boolean; error: boolean; onRetry: () => void; journeyNames: Record<string, string>; onNew: () => void; onOpenJourney: (journeyId: string) => void; returnAppointmentTarget: ReturnAppointmentTarget | null; onReturnAppointmentClose: () => void }) {
  const canRun = useCan("appointment:run");
  const [returnDate, setReturnDate] = useState(() => clinicDateAfterDays(0));
  const [returnTime, setReturnTime] = useState("09:00");
  const [clinicHours, setClinicHours] = useState<{ openingTime: string; closingTime: string; allowAppointmentsOutsideHours: boolean } | null>(() => readClientCache<{ openingTime: string; closingTime: string; allowAppointmentsOutsideHours: boolean }>("/api/appointments/options") ?? null);
  const [returnReason, setReturnReason] = useState(() => returnAppointmentTarget ? returnAppointmentTarget.kind === "procedure" ? returnAppointmentTarget.name : `Retorno - ${returnAppointmentTarget.name}` : "");
  const [returnNotes, setReturnNotes] = useState("");
  const [returnSaving, setReturnSaving] = useState(false);
  const [returnError, setReturnError] = useState("");
  const [invalidReturnFields, setInvalidReturnFields] = useState<Set<string>>(new Set());
  const [editingAppointment, setEditingAppointment] = useState<PatientAppointmentRecord | null>(null);
  const [professionals, setProfessionals] = useState<Array<{ id: string; name: string }>>(() => readClientCache<{ professionals: Array<{ id: string; name: string }> }>("/api/team/professionals")?.professionals ?? []);
  const [professionalChoice, setProfessionalChoice] = useState<{ source: object; name: string } | null>(null);
  const professionalSource = editingAppointment ?? returnAppointmentTarget;
  const returnProfessional = professionalChoice && professionalChoice.source === professionalSource ? professionalChoice.name : professionalSource?.professional ?? "";

  useEffect(() => {
    if (!returnAppointmentTarget && !editingAppointment) return;
    let active = true;
    getCachedJson<{ openingTime: string; closingTime: string; allowAppointmentsOutsideHours: boolean }>("/api/appointments/options")
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
    const slotError = appointmentSlotError(returnDate, returnTime, clinicHours.openingTime, clinicHours.closingTime, clinicNow(), 60, clinicHours.allowAppointmentsOutsideHours);
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
          <div className="sm:col-span-2"><FormField label="Profissional"><select className={fieldClassName} value={returnProfessional} onChange={(event) => { if (professionalSource) setProfessionalChoice({ source: professionalSource, name: event.target.value }); }} required>
            {!returnProfessional ? <option value="" disabled>Selecione o profissional</option> : null}
            {returnProfessional && !professionals.some((professional) => professional.name === returnProfessional) ? <option value={returnProfessional}>{returnProfessional}</option> : null}
            {professionals.map((professional) => <option key={professional.id} value={professional.name}>{professional.name}</option>)}
          </select></FormField></div>
          <FormField label="Data"><input className={cn(fieldClassName, invalidReturnFields.has("date") && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} type="date" value={returnDate} required onChange={(event) => { setReturnDate(event.target.value); setInvalidReturnFields((current) => { const next = new Set(current); next.delete("date"); return next; }); setReturnError(""); }} /></FormField>
          <FormField label="Horário">{clinicHours ? <ClinicTimePicker openingTime={clinicHours.openingTime} closingTime={clinicHours.closingTime} latestTime={clinicHours.allowAppointmentsOutsideHours ? undefined : latestAppointmentStart(clinicHours.closingTime)} allowOutsideHours={clinicHours.allowAppointmentsOutsideHours} value={returnTime} invalid={invalidReturnFields.has("time")} className={fieldClassName} onChange={(value) => { setReturnTime(value); setInvalidReturnFields((current) => { const next = new Set(current); next.delete("time"); return next; }); setReturnError(""); }} /> : <button type="button" disabled className={cn(fieldClassName, "text-left opacity-60")}>Carregando horários...</button>}</FormField>
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
