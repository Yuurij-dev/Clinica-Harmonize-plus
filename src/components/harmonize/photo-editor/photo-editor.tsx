"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Baby, Camera, Check, ChevronRight, CircleCheck, ClipboardPenLine, Dna, Droplet, FileJson, ImagePlus, Info, Loader2, ShieldAlert, Syringe, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { appendIncomingPhotos, idsToSkipAfterFailure, pollOutcomeForStatus, unseenPhotoIds } from "@/lib/evaluation-photo-sync-rules";
import { usePhotoSyncPoll } from "../use-photo-sync-poll";
import { evaluationFieldsFromAnamnesis, fillEmptyEvaluationFields } from "@/lib/anamnesis-rules";
import { assessmentFieldErrors, type RequiredAssessmentField } from "@/lib/evaluation-rules";
import { anamnesisKey, type AnamnesisOverview } from "../patient-clinical-data";
import { LoadingSkeleton } from "../shared";
import { IncomingPhotoStatus } from "../incoming-photo-status";
import { EditorToolbar, type EditorToolbarProps } from "./editor-toolbar";
import { defaultMarkColor, viewOnlyTools } from "./editor-toolbar-data";
import { FacialFooter } from "./facial-footer";
import { FacialCardActions, FacialExpandedBar, FacialTitle } from "./facial-header";
import type { FacialSidePanelProps } from "./facial-side-panel";
import { FacialWorkspace, type FacialWorkspaceProps } from "./facial-workspace";
import { renderExport } from "./photo-export";
import { EvaluationResult } from "./evaluation-result";
import { PhotoGallery } from "./photo-gallery";
import { EncounterBreadcrumb, type EncounterBreadcrumbActions } from "../encounter-breadcrumb";
import { useDraftAutosave } from "../use-draft-autosave";
import { ReadOnlyStageNotice } from "../readonly-stage-notice";
import { revealValidationTarget } from "../reveal-validation-target";
import { JourneyProgress } from "../journey-progress";
import type { AnnotationSnapshot, EditorTool, EvaluationPhoto, PhotoAnnotation } from "./types";
import { annotationLimitMessage, exceedsAnnotationLimit, pushHistory, restyleAnnotation, withAnnotationLabel } from "@/lib/photo-annotation-rules";
import { fitToArea, isTextEntryTarget, shortcutFromKey, stepZoom } from "@/lib/facial-editor-rules";
import { facialNotesMaxLength } from "@/lib/evaluation-rules";
import type { EvaluationStep } from "@/lib/evaluation-step-rules";
import type { Patient } from "@/types/clinic";

const EditorCanvas = dynamic(
  () => import("./editor-canvas").then((module) => module.EditorCanvas),
  { ssr: false },
);

type Notice = { tone: "success" | "info"; text: string } | null;
export type SavedEvaluation = { id: string; professional: string; createdAt: string; updatedAt: string; photoCount: number; status?: string };
type ConfirmAction = { type: "photo"; photoId: string; photoName: string } | { type: "clear" } | null;

export type ClinicalAssessment = {
  chiefComplaint: string;
  patientGoal: string;
  medicalHistory: string;
  allergies: string;
  pregnancyStatus: string;
  anticoagulantUse: string;
  autoimmuneDiseases: string;
  contraindications: string;
  previousProcedures: string;
  clinicalNotes: string;
  /** Observações da avaliação facial (até 500 caracteres); vão no mesmo PUT, mas não fazem parte do formulário clínico. */
  facialNotes: string;
};

/** A avaliação grava sozinha a cada 2 min (teto contado da primeira alteração não salva); sair, trocar de etapa, Salvar e Concluir gravam na hora. */
const evaluationAutosaveMs = 120_000;

const maxEvaluationPhotos = 20;
const photoLimitMessage = "A avaliação aceita até 20 fotos. Remova uma imagem para adicionar outra.";
const photoAngles: EvaluationPhoto["category"][] = ["Frontal", "Perfil direito", "Perfil esquerdo", "Sorriso", "Outra"];

const emptyAssessment: ClinicalAssessment = { chiefComplaint: "", patientGoal: "", medicalHistory: "", allergies: "", pregnancyStatus: "", anticoagulantUse: "", autoimmuneDiseases: "", contraindications: "", previousProcedures: "", clinicalNotes: "", facialNotes: "" };

// Contêiner único da avaliação: um registro, um estado, um autosave e um PUT. `step` só escolhe a visão (formulário clínico ou fotos + marcação);
// trocar de etapa não remonta nem refaz o fetch. Sem `encounter` (uso antigo) mostra o formulário (se há avaliação) e as fotos juntos.
export function PhotoEditor({ patientId, evaluationId, journeyId, patientName, onSaved, encounter, encounterLabel = "Novo atendimento", readOnly = false, step = "clinical", onStepChange }: { patientId: string; evaluationId?: string; journeyId?: string; patientName: string; onSaved?: (evaluation: SavedEvaluation) => void; encounter?: { patient: Patient; onContinue: (evaluationId: string) => void } & EncounterBreadcrumbActions; encounterLabel?: string; readOnly?: boolean; step?: EvaluationStep; onStepChange?: (step: EvaluationStep) => void }) {
  const [currentEvaluationId, setCurrentEvaluationId] = useState(evaluationId);
  const currentEvaluationIdRef = useRef(evaluationId);
  const evaluationCacheKey = evaluationId ? `/api/patients/${patientId}/evaluation?evaluationId=${encodeURIComponent(evaluationId)}` : null;
  const cachedEvaluation = evaluationCacheKey ? readClientCache<{ evaluation?: ({ photos?: EvaluationPhoto[]; status?: string; professional?: string } & Partial<ClinicalAssessment>) | null }>(evaluationCacheKey) : null;
  const [photos, setPhotos] = useState<EvaluationPhoto[]>(cachedEvaluation?.evaluation?.photos ?? []);
  const [assessment, setAssessment] = useState<ClinicalAssessment>({ ...emptyAssessment, ...cachedEvaluation?.evaluation });
  const [evaluationStatus, setEvaluationStatus] = useState<"Rascunho" | "Concluída">(cachedEvaluation?.evaluation?.status === "Concluída" ? "Concluída" : "Rascunho");
  const [professional, setProfessional] = useState(cachedEvaluation?.evaluation?.professional ?? "");
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [tool, setTool] = useState<EditorTool>("select");
  const [color, setColor] = useState(defaultMarkColor);
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  // Estado só de visualização da avaliação facial (não vai para o servidor nem para o armazenamento do navegador).
  const [showMarks, setShowMarks] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [recenterKey, setRecenterKey] = useState(0);
  const [labelFocusId, setLabelFocusId] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const facialRootRef = useRef<HTMLDivElement>(null);
  const labelEditRef = useRef<{ id: string; at: number } | null>(null);
  const [past, setPast] = useState<Record<string, AnnotationSnapshot[]>>({});
  const [future, setFuture] = useState<Record<string, AnnotationSnapshot[]>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [isLoading, setIsLoading] = useState(Boolean(evaluationCacheKey) && (!cachedEvaluation || Boolean(cachedEvaluation.evaluation?.photos?.length)));
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [editRevision, setEditRevision] = useState(0);
  const editRevisionRef = useRef(0);
  const [hydrated, setHydrated] = useState(!evaluationCacheKey);
  const [saveError, setSaveError] = useState("");
  const [photoUploadError, setPhotoUploadError] = useState("");
  const [receivingPhoto, setReceivingPhoto] = useState(false);
  const [assessmentErrors, setAssessmentErrors] = useState<Partial<Record<RequiredAssessmentField, string>>>({});
  const prefillDoneRef = useRef("");
  // Valores gravados de uma avaliação já concluída: campo que já era vazio nela não bloqueia salvar fotos/marcações.
  const concludedBaselineRef = useRef<ClinicalAssessment | null>(cachedEvaluation?.evaluation && cachedEvaluation.evaluation.status !== "Rascunho" ? { ...emptyAssessment, ...cachedEvaluation.evaluation } : null);
  const [assessmentValidationAttempt, setAssessmentValidationAttempt] = useState(0);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  // Fotos lidas (upload ou câmera) esperando a escolha do ângulo antes de entrar na avaliação; uma pergunta por foto.
  const [pendingPhotos, setPendingPhotos] = useState<EvaluationPhoto[] | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraHint, setCameraHint] = useState("");
  // Geração do pedido de câmera: fechar ou desmontar enquanto o getUserMedia está pendente invalida o pedido, e o stream que chegar tarde é parado.
  const cameraRequestRef = useRef(0);
  const openingCameraRef = useRef(false);
  // O conteúdo do modal (portal) monta depois do efeito: o stream é ligado quando o <video> aparece, não antes.
  const attachCameraVideo = (element: HTMLVideoElement | null) => {
    cameraVideoRef.current = element;
    if (element && cameraStream && element.srcObject !== cameraStream) element.srcObject = cameraStream;
  };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [savedPreviews, setSavedPreviews] = useState<Array<{ photo: EvaluationPhoto; dataUrl: string }>>([]);
  const isEncounterMode = Boolean(encounter);
  const showClinicalView = encounter ? step === "clinical" : Boolean(evaluationId);
  // A etapa facial do atendimento tem a tela nova (FacialWorkspace); sem `encounter` (uso antigo) continua o editor com a barra lateral.
  const facialMode = Boolean(encounter) && step === "facial";
  const showLegacyPhotos = !encounter;
  const activePhoto = photos.find((photo) => photo.id === activePhotoId) ?? null;
  // O canvas cabe na largura do contêiner (só a visualização escala; as anotações seguem em coordenadas da imagem).
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState<number | null>(null);
  const [canvasHeight, setCanvasHeight] = useState<number | null>(null);
  // Facial: a foto inteira cabe na área ampla (sem a medida ainda, uma escala segura para não montar um canvas gigante).
  const fitScale = !activePhoto
    ? 1
    : facialMode
      ? canvasWidth && canvasHeight ? fitToArea({ areaWidth: canvasWidth, areaHeight: canvasHeight, photoWidth: activePhoto.width, photoHeight: activePhoto.height }) : Math.min(1, 640 / activePhoto.width)
      : Math.min(1, 980 / activePhoto.width, 540 / activePhoto.height, canvasWidth ? Math.max(0.1, canvasWidth - 34) / activePhoto.width : Infinity);
  useEffect(() => {
    const element = canvasWrapRef.current;
    if (!element) return;
    const update = () => { setCanvasWidth(element.clientWidth); setCanvasHeight(element.clientHeight); };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => { observer.disconnect(); };
  }, [isLoading, loadError, activePhotoId, showLegacyPhotos, facialMode, expanded]);
  const displayScale = fitScale * zoom;
  const canUndo = Boolean(activePhotoId && past[activePhotoId]?.length);
  const canRedo = Boolean(activePhotoId && future[activePhotoId]?.length);
  const autosave = useDraftAutosave({ scope: `${patientId}:${journeyId ?? ""}`, revision: editRevision, enabled: isEncounterMode && !readOnly && hydrated && !loadError, delay: evaluationAutosaveMs, maxWait: evaluationAutosaveMs, save: async () => Boolean(await saveEvaluation(evaluationStatus, true)) });

  // Ao trocar de etapa a nova página abre no topo, com o foco no cabeçalho do atendimento.
  const previousStepRef = useRef(step);
  useEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    const header = document.getElementById("evaluation-header-card");
    header?.scrollIntoView({ block: "start" });
    header?.focus({ preventScroll: true });
  }, [step]);

  function markDirty() {
    editRevisionRef.current += 1;
    setEditRevision(editRevisionRef.current);
    setIsDirty(true);
  }

  useEffect(() => () => cameraStream?.getTracks().forEach((track) => track.stop()), [cameraStream]);
  useEffect(() => () => { cameraRequestRef.current += 1; }, []);

  useEffect(() => {
    if (!evaluationCacheKey) return;
    let active = true;
    getCachedJson<{ evaluation?: ({ photos?: EvaluationPhoto[]; status?: string; professional?: string } & Partial<ClinicalAssessment>) | null }>(evaluationCacheKey)
      .then(async (data) => {
        if (!active) return;
        const restored = data.evaluation?.photos ?? [];
        currentEvaluationIdRef.current = evaluationId;
        setAssessment({ ...emptyAssessment, ...data.evaluation });
        concludedBaselineRef.current = data.evaluation && data.evaluation.status !== "Rascunho" ? { ...emptyAssessment, ...data.evaluation } : null;
        setProfessional(data.evaluation?.professional ?? "");
        setEvaluationStatus(data.evaluation?.status === "Rascunho" ? "Rascunho" : "Concluída");
        setLoadError(false);
        setPhotos(restored);
        setActivePhotoId(restored[0]?.id ?? null);
        if (restored.length && !isEncounterMode) {
          const previews = await Promise.all(restored.map(async (photo) => ({ photo, dataUrl: await renderExport(photo) })));
          if (!active) return;
          setSavedPreviews(previews);
          setShowResult(true);
        }
      })
      .catch(() => {
        if (active) {
          setLoadError(true);
          showNotice("Não foi possível carregar os dados da avaliação.", "info");
        }
      })
      .finally(() => {
        if (active) { setIsLoading(false); setHydrated(true); }
      });
    return () => { active = false; };
  }, [evaluationCacheKey, evaluationId, isEncounterMode, loadAttempt]);

  // Pré-preenche os campos vazios com a anamnese do paciente, só numa avaliação nova ou em rascunho aberta pelo usuário.
  // Nunca sobrescreve o que já foi escrito e não toca em avaliação concluída.
  useEffect(() => {
    const prefillKey = `${patientId}:${evaluationId ?? ""}`;
    if (prefillDoneRef.current === prefillKey || !hydrated || loadError || readOnly || evaluationStatus !== "Rascunho" || !(encounter || evaluationId)) return;
    prefillDoneRef.current = prefillKey;
    let active = true;
    let finished = false;
    getCachedJson<AnamnesisOverview>(anamnesisKey(patientId))
      .then((overview) => {
        if (!active) return;
        finished = true;
        if (overview.restricted) return;
        const source = overview.current ?? overview.draft;
        if (source) setAssessment((current) => fillEmptyEvaluationFields(current, evaluationFieldsFromAnamnesis(source.content)));
      })
      .catch(() => { prefillDoneRef.current = ""; });
    // Se o efeito for refeito antes de a resposta chegar (ex.: Strict Mode), a próxima execução tenta de novo.
    return () => { active = false; if (!finished) prefillDoneRef.current = ""; };
  }, [hydrated, loadError, readOnly, evaluationStatus, encounter, evaluationId, patientId]);

  // Ids que o editor já teve (inclui os removidos aqui): só id nunca visto é "foto nova enviada pelo app".
  const seenPhotoIdsRef = useRef(new Set<string>());
  const photosRef = useRef(photos);
  // Outra avaliação: recomeça o conjunto só com o que está na tela (os ids de uma avaliação não valem para a outra).
  useEffect(() => { seenPhotoIdsRef.current = new Set(photosRef.current.map((photo) => photo.id)); }, [evaluationId]);
  useEffect(() => {
    photosRef.current = photos;
    for (const photo of photos) seenPhotoIdsRef.current.add(photo.id);
  }, [photos]);

  // Fotos da mesma avaliação enviadas pelo app: checa só os ids (select id, sem base64) a cada ~5 s com a aba visível (backoff em falha, para em 401/403/404)
  // e ao voltar o foco; busca apenas as novas e as ANEXA ao estado. Nunca substitui, reordena nem remove nada; o autosave (PUT) as preserva.
  const skippedPhotoIdsRef = useRef(new Set<string>()); // ids já tentados sem foto exibível (não religam o spinner a cada ciclo)
  const fetchFailuresRef = useRef(new Map<string, number>());
  useEffect(() => { skippedPhotoIdsRef.current = new Set(); fetchFailuresRef.current = new Map(); }, [evaluationId]);
  usePhotoSyncPoll(isEncounterMode && hydrated && !loadError && evaluationStatus === "Rascunho", async () => {
    const id = currentEvaluationIdRef.current;
    if (!id) return "ok";
    const base = `/api/patients/${patientId}/evaluation?evaluationId=${encodeURIComponent(id)}`;
    const head = await fetch(`${base}&photoIds=1`, { cache: "no-store" });
    const headOutcome = pollOutcomeForStatus(head.status);
    if (headOutcome !== "ok") return headOutcome;
    const headBody = await head.json() as { evaluation?: { status?: string; photoIds?: string[] } | null };
    if (headBody.evaluation === null) return "stop"; // avaliação não encontrada (200 com null): não adianta repetir
    const ids = headBody.evaluation?.photoIds ?? [];
    const fresh = unseenPhotoIds(new Set([...seenPhotoIdsRef.current, ...skippedPhotoIdsRef.current]), ids, photosRef.current.length);
    if (!fresh.length) return "ok";
    setReceivingPhoto(true);
    try {
      const full = await fetch(`${base}&only=${fresh.join(",")}`, { cache: "no-store" });
      const fullOutcome = pollOutcomeForStatus(full.status);
      if (fullOutcome !== "ok") { for (const failed of idsToSkipAfterFailure(fetchFailuresRef.current, fresh)) skippedPhotoIdsRef.current.add(failed); return fullOutcome; }
      const incoming = (await full.json() as { evaluation?: { photos?: EvaluationPhoto[] } | null }).evaluation?.photos ?? [];
      if (currentEvaluationIdRef.current !== id) return "ok";
      const got = new Set(incoming.map((photo) => photo.id));
      for (const missing of fresh) if (!got.has(missing)) skippedPhotoIdsRef.current.add(missing);
      if (!incoming.length) return "ok";
      setPhotos((current) => appendIncomingPhotos(current, incoming));
      // Marca como edição: o autosave regrava o estado atual e a foto não fica só aqui caso um PUT em andamento a tenha apagado.
      if (!readOnly) markDirty();
      setActivePhotoId((current) => current ?? incoming[0].id);
      invalidateClientCache(`/api/patients/${patientId}/evaluation`);
      showNotice(`${incoming.length} foto${incoming.length > 1 ? "s" : ""} recebida${incoming.length > 1 ? "s" : ""} do aplicativo.`);
      return "ok";
    } catch (error) {
      for (const failed of idsToSkipAfterFailure(fetchFailuresRef.current, fresh)) skippedPhotoIdsRef.current.add(failed);
      throw error;
    } finally { setReceivingPhoto(false); }
  });

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function showNotice(text: string, tone: NonNullable<Notice>["tone"] = "success") {
    setNotice({ text, tone });
  }

  function updatePhotoAnnotations(next: PhotoAnnotation[]) {
    if (!activePhotoId) return;
    setPhotos((current) => current.map((photo) => (
      photo.id === activePhotoId ? { ...photo, annotations: next } : photo
    )));
    markDirty();
  }

  function commitAnnotations(next: PhotoAnnotation[], previous: AnnotationSnapshot) {
    if (!activePhotoId) return false;
    // O PUT recusa mais de 1000 marcações por foto: avisa aqui em vez de falhar calado no autosave.
    if (exceedsAnnotationLimit(next, previous)) { showNotice(annotationLimitMessage, "info"); return false; }
    setPast((current) => ({
      ...current,
      [activePhotoId]: pushHistory(current[activePhotoId] ?? [], previous),
    }));
    setFuture((current) => ({ ...current, [activePhotoId]: [] }));
    updatePhotoAnnotations(next);
    return true;
  }

  // Seleciona uma marcação e leva a cor/espessura dela para a barra; trocar cor ou espessura com algo selecionado edita a marcação (como no app).
  function selectAnnotation(id: string | null) {
    setSelectedId(id);
    const target = id ? activePhoto?.annotations.find((annotation) => annotation.id === id) : undefined;
    if (!target) return;
    setColor(target.color);
    if (target.type !== "text" && target.type !== "point") setStrokeWidth(target.strokeWidth);
  }

  const styleEditRef = useRef<{ id: string; at: number } | null>(null);
  function restyleSelected(patch: { color?: string; strokeWidth?: number }) {
    if (!activePhoto || !selectedId) return;
    const target = activePhoto.annotations.find((annotation) => annotation.id === selectedId);
    if (!target) return;
    const restyled = restyleAnnotation(target, patch);
    if (restyled.color === target.color && restyled.strokeWidth === target.strokeWidth) return;
    const next = activePhoto.annotations.map((annotation) => annotation.id === selectedId ? restyled : annotation);
    const now = Date.now();
    const recent = styleEditRef.current;
    // Arrastar o controle de espessura gera vários eventos: um só passo no histórico.
    if (recent && recent.id === selectedId && now - recent.at < 800) updatePhotoAnnotations(next);
    else commitAnnotations(next, activePhoto.annotations);
    styleEditRef.current = { id: selectedId, at: now };
  }

  function undo() {
    if (!activePhoto) return;
    const history = past[activePhoto.id] ?? [];
    const previous = history.at(-1);
    if (!previous) return;
    setPast((current) => ({ ...current, [activePhoto.id]: history.slice(0, -1) }));
    setFuture((current) => ({
      ...current,
      [activePhoto.id]: pushHistory(current[activePhoto.id] ?? [], activePhoto.annotations),
    }));
    updatePhotoAnnotations(previous);
    setSelectedId(null);
  }

  function redo() {
    if (!activePhoto) return;
    const history = future[activePhoto.id] ?? [];
    const next = history.at(-1);
    if (!next) return;
    setFuture((current) => ({ ...current, [activePhoto.id]: history.slice(0, -1) }));
    setPast((current) => ({
      ...current,
      [activePhoto.id]: [...(current[activePhoto.id] ?? []), activePhoto.annotations],
    }));
    updatePhotoAnnotations(next);
    setSelectedId(null);
  }

  function showPhotoUploadError(message: string) {
    setPhotoUploadError(message);
    revealValidationTarget("evaluation-photo-card", "evaluation-photo-upload-error");
  }

  async function uploadPhotos(files: FileList | null) {
    if (readOnly) return;
    if (!files?.length) return;
    setPhotoUploadError("");
    const selectedFiles = Array.from(files);
    const accepted = selectedFiles.filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 6_000_000);
    if (accepted.length !== selectedFiles.length) showPhotoUploadError("Alguns arquivos foram ignorados. Use JPG, PNG ou WEBP de até 6 MB.");
    if (photos.length + accepted.length > maxEvaluationPhotos) { showPhotoUploadError(photoLimitMessage); return; }
    let loaded: EvaluationPhoto[];
    try {
      loaded = await Promise.all(accepted.map((file, index) => readPhoto(file, photos.length + index)));
    } catch (error) {
      showPhotoUploadError(error instanceof Error ? error.message : "Não foi possível ler uma das imagens.");
      return;
    }
    if (!loaded.length) {
      showPhotoUploadError("Escolha imagens JPG, PNG ou WEBP de até 6 MB.");
      return;
    }
    setPendingPhotos(loaded);
  }

  function confirmPendingPhotos() {
    if (!pendingPhotos?.length) return;
    // O limite vale também aqui: pode ter chegado foto do app com o modal aberto.
    if (photos.length + pendingPhotos.length > maxEvaluationPhotos) {
      setPendingPhotos(null);
      showPhotoUploadError(photoLimitMessage);
      return;
    }
    const added = pendingPhotos.map((photo, index) => ({ ...photo, sortOrder: photos.length + index }));
    setPhotos((current) => [...current, ...added]);
    selectPhoto(added[0].id); // a foto recém-anexada fica ativa
    markDirty();
    setPendingPhotos(null);
    showNotice(`${added.length} foto${added.length > 1 ? "s" : ""} adicionada${added.length > 1 ? "s" : ""}.`);
  }

  function removePhoto(photoId: string) {
    const photo = photos.find((item) => item.id === photoId);
    if (!photo) return;
    setConfirmAction({ type: "photo", photoId, photoName: photo.name });
  }

  function executeRemovePhoto(photoId: string) {
    const remaining = photos.filter((item) => item.id !== photoId).map((photo, sortOrder) => ({ ...photo, sortOrder }));
    setPhotos(remaining);
    markDirty();
    setPast((current) => omitKey(current, photoId));
    setFuture((current) => omitKey(current, photoId));
    if (activePhotoId === photoId) {
      setActivePhotoId(remaining[0]?.id ?? null);
      setSelectedId(null);
    }
  }

  function clearAnnotations() {
    if (!activePhoto) {
      showNotice("Adicione uma foto antes de limpar as marcações.", "info");
      return;
    }
    if (!activePhoto.annotations.length) {
      showNotice("Não há marcações para limpar.", "info");
      return;
    }
    setConfirmAction({ type: "clear" });
  }

  function executeClearAnnotations() {
    if (!activePhoto) return;
    commitAnnotations([], activePhoto.annotations);
    setSelectedId(null);
    showNotice("Marcações removidas. Você ainda pode desfazer essa ação.");
  }

  function confirmPendingAction() {
    if (!confirmAction) return;
    if (confirmAction.type === "photo") {
      executeRemovePhoto(confirmAction.photoId);
      showNotice("Foto removida da avaliação.");
    } else {
      executeClearAnnotations();
    }
    setConfirmAction(null);
  }

  function changePhotoCategory(photoId: string, category: EvaluationPhoto["category"]) {
    setPhotos((current) => current.map((photo) => photo.id === photoId ? { ...photo, category } : photo));
    markDirty();
  }

  function movePhoto(photoId: string, direction: -1 | 1) {
    const index = photos.findIndex((photo) => photo.id === photoId);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= photos.length) return;
    const reordered = [...photos];
    [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
    setPhotos(reordered.map((photo, sortOrder) => ({ ...photo, sortOrder })));
    markDirty();
  }

  async function replacePhoto(photoId: string, file?: File) {
    if (!file) return;
    setPhotoUploadError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 6_000_000) {
      showPhotoUploadError("Envie uma imagem JPG, PNG ou WEBP de até 6 MB.");
      return;
    }
    try {
      const previous = photos.find((photo) => photo.id === photoId);
      if (!previous) return;
      const replacement = await readPhoto(file, previous.sortOrder);
      const next = { ...replacement, id: previous.id, category: previous.category, annotations: [] };
      setPhotos((current) => current.map((photo) => photo.id === photoId ? next : photo));
      markDirty();
      showNotice("Foto substituída. As marcações anteriores foram removidas.", "info");
    } catch (error) {
      showPhotoUploadError(error instanceof Error ? error.message : "Não foi possível abrir a imagem selecionada.");
    }
  }

  async function openCamera() {
    if (cameraOpen || openingCameraRef.current) return; // dois cliques rápidos não abrem dois streams
    if (photos.length >= maxEvaluationPhotos) { showPhotoUploadError(photoLimitMessage); return; }
    setCameraError("");
    setCameraHint("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Este dispositivo ou navegador não permite capturar fotos pela câmera.");
      setCameraOpen(true);
      return;
    }
    openingCameraRef.current = true;
    const request = ++cameraRequestRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "user" } }, audio: false });
      if (request !== cameraRequestRef.current) { stream.getTracks().forEach((track) => track.stop()); return; } // fechou/desmontou no meio: stream órfão parado
      setCameraStream(stream);
      setCameraOpen(true);
    } catch {
      if (request !== cameraRequestRef.current) return;
      setCameraError("Não foi possível acessar a câmera. Verifique a permissão do navegador e tente novamente.");
      setCameraOpen(true);
    } finally {
      openingCameraRef.current = false;
    }
  }

  function closeCamera() {
    cameraRequestRef.current += 1;
    cameraStream?.getTracks().forEach((track) => track.stop());
    setCameraStream(null);
    setCameraOpen(false);
  }

  async function captureCameraPhoto() {
    // O limite é checado antes de tudo: foto do app pode ter chegado com a câmera aberta.
    if (photos.length >= maxEvaluationPhotos) { closeCamera(); showPhotoUploadError(photoLimitMessage); return; }
    const video = cameraVideoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) { setCameraHint("A câmera ainda não está pronta. Aguarde a imagem aparecer e tente de novo."); return; }
    setCameraHint("");
    if (video.videoWidth * video.videoHeight > 25_000_000) {
      // Para a câmera (LED apagado) e, sem stream, "Capturar" fica desabilitado.
      cameraStream?.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
      setCameraError("A resolução da câmera excede o limite seguro de 25 megapixels.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageUrl = canvas.toDataURL("image/jpeg", 0.9);
    const photo: EvaluationPhoto = { id: `photo-${crypto.randomUUID()}`, name: `captura-${new Date().toISOString()}.jpg`, imageUrl, width: canvas.width, height: canvas.height, category: "Frontal", sortOrder: photos.length, annotations: [] };
    closeCamera();
    setPendingPhotos([photo]);
  }

  function changeAssessment(field: keyof ClinicalAssessment, value: string) {
    setAssessment((current) => ({ ...current, [field]: value }));
    markDirty();
    setSaveError("");
    if (value.trim() && field in assessmentErrors) setAssessmentErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== field)));
  }

  // Todos os campos obrigatórios da avaliação; mostra os erros, rola e foca o primeiro inválido.
  function validateAssessment() {
    const errors = assessmentFieldErrors(assessment, concludedBaselineRef.current);
    const firstInvalid = Object.keys(errors)[0];
    if (!firstInvalid) return true;
    setAssessmentErrors(errors);
    setAssessmentValidationAttempt((current) => current + 1);
    // Concluindo pela etapa facial: os campos pendentes estão na clínica, então volta para lá (sem perder nada) e só então rola até o primeiro.
    if (step === "facial" && onStepChange) {
      onStepChange("clinical");
      showNotice("Complete a avaliação clínica para concluir e seguir ao orçamento.", "info");
      window.setTimeout(() => revealValidationTarget("evaluation-assessment-card", `assessment-field-${firstInvalid}`), 120);
    } else revealValidationTarget("evaluation-assessment-card", `assessment-field-${firstInvalid}`);
    return false;
  }

  function deleteAnnotation(id: string) {
    if (!activePhoto) return;
    commitAnnotations(activePhoto.annotations.filter((annotation) => annotation.id !== id), activePhoto.annotations);
    if (selectedId === id) setSelectedId(null);
  }

  function deleteSelected() {
    if (selectedId) deleteAnnotation(selectedId);
  }

  // Legenda da marcação: a digitação seguida vira um só passo no histórico (como a espessura).
  function labelAnnotation(id: string, value: string) {
    if (!activePhoto) return;
    const target = activePhoto.annotations.find((annotation) => annotation.id === id);
    if (!target) return;
    const labeled = withAnnotationLabel(target, value);
    if (labeled.label === target.label) return;
    const next = activePhoto.annotations.map((annotation) => annotation.id === id ? labeled : annotation);
    const now = Date.now();
    const recent = labelEditRef.current;
    if (recent && recent.id === id && now - recent.at < 2000) updatePhotoAnnotations(next);
    else commitAnnotations(next, activePhoto.annotations);
    labelEditRef.current = { id, at: now };
  }

  const clearLabelFocus = useCallback(() => setLabelFocusId(null), []);

  function changeTool(next: EditorTool) {
    if (!showMarks && !viewOnlyTools.includes(next)) return; // com as marcações ocultas só Selecionar e Mover
    setTool(next);
    if (next !== "select") setSelectedId(null);
  }

  function changeShowMarks(next: boolean) {
    setShowMarks(next);
    if (next) return;
    setSelectedId(null);
    if (!viewOnlyTools.includes(tool)) setTool("select");
  }

  function changeColor(next: string) {
    setColor(next);
    restyleSelected({ color: next });
  }

  function changeStrokeWidth(next: number) {
    setStrokeWidth(next);
    restyleSelected({ strokeWidth: next });
  }

  function zoomIn() { setZoom((value) => stepZoom(value, 1)); }
  function zoomOut() { setZoom((value) => stepZoom(value, -1)); }
  function zoomReset() { setZoom(1); setRecenterKey((value) => value + 1); }
  function toggleExpanded() { setExpanded((value) => !value); setZoom(1); setRecenterKey((value) => value + 1); }
  function selectPhoto(photoId: string) { setActivePhotoId(photoId); setSelectedId(null); setZoom(1); setRecenterKey((value) => value + 1); }
  // Área ampliada (overlay fixo sobre a viewport): o mesmo elemento muda de classe, então nada é remontado nem perde estado.
  const wasExpandedRef = useRef(false);
  useEffect(() => {
    if (!facialMode || !expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    wasExpandedRef.current = true;
    const frame = window.requestAnimationFrame(() => facialRootRef.current?.querySelector<HTMLElement>("[data-facial-collapse]")?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      if (wasExpandedRef.current) { wasExpandedRef.current = false; window.setTimeout(() => document.querySelector<HTMLElement>("[data-facial-expand]")?.focus(), 0); }
    };
  }, [facialMode, expanded]);
  function trapTab(event: React.KeyboardEvent<HTMLDivElement>) {
    const root = facialRootRef.current;
    if (event.key !== "Tab" || !root || !root.contains(event.target as Node)) return;
    const items = [...root.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((element) => !(element as HTMLButtonElement).disabled && element.tabIndex >= 0 && element.getClientRects().length > 0 && !element.closest("[inert]"));
    if (!items.length) return;
    const first = items[0]; const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function openFilePicker() { fileInputRef.current?.click(); }

  async function saveEvaluation(status: "Rascunho" | "Concluída" = encounter ? "Rascunho" : evaluationStatus, automatic = false) {
    if (!encounter && !photos.length) {
      showNotice("Adicione pelo menos uma foto antes de salvar a avaliação.", "info");
      revealValidationTarget("evaluation-photo-card", "evaluation-notice");
      return null;
    }
    if (status === "Concluída" && !automatic && !validateAssessment()) return null;
    setIsSaving(true);
    setSaveError("");
    const startedRevision = editRevisionRef.current;
    try {
      const response = await fetch(`/api/patients/${patientId}/evaluation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evaluationId: currentEvaluationIdRef.current, journeyId, photos, knownPhotoIds: [...seenPhotoIdsRef.current], assessment, status }),
      });
      const data = await response.json().catch(() => ({})) as { evaluation?: SavedEvaluation; message?: string };
      if (!response.ok || !data.evaluation) throw new Error(data.message ?? "Não foi possível salvar a avaliação.");
      setCurrentEvaluationId(data.evaluation.id);
      currentEvaluationIdRef.current = data.evaluation.id;
      setLastSavedAt(Date.now()); // só aqui, com o servidor já tendo confirmado
      setEvaluationStatus(status);
      setProfessional(data.evaluation.professional ?? professional);
      invalidateClientCache(`/api/patients/${patientId}/evaluation`, `/api/patients/${patientId}/history`, `/api/patients/${patientId}/journeys`, "/api/patients");
      if (startedRevision === editRevisionRef.current) setIsDirty(false);
      if (!automatic) {
        const previews = await Promise.all(photos.map(async (photo) => ({ photo, dataUrl: await renderExport(photo) })));
        setSavedPreviews(previews);
      }
      if (!encounter) setShowResult(true);
      if (!automatic) onSaved?.(data.evaluation);
      if (!automatic) showNotice(status === "Concluída" ? "Avaliação concluída." : "Rascunho salvo com as imagens originais e marcações separadas.");
      return data.evaluation.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível salvar a avaliação.";
      setSaveError(message);
      if (!automatic) showNotice(message, "info");
      if (!automatic) revealValidationTarget("evaluation-photo-card", "evaluation-save-error");
      return null;
    } finally {
      setIsSaving(false);
    }
  }

  // Clínica -> facial: nada além do rascunho é exigido; grava o que estiver pendente para a URL da etapa facial já hidratar esta avaliação.
  async function continueToFacial() {
    if (!await autosave.flush()) { showNotice("Não foi possível salvar as alterações. Tente novamente antes de continuar.", "info"); revealValidationTarget("evaluation-header-card"); return; }
    onStepChange?.("facial");
  }

  async function backToClinical() {
    if (!await autosave.flush()) { showNotice("Não foi possível salvar as alterações. Tente novamente antes de voltar.", "info"); revealValidationTarget("evaluation-header-card"); return; }
    onStepChange?.("clinical");
  }

  async function saveNow() {
    const ok = await autosave.flush();
    showNotice(ok ? "Avaliação salva." : "Não foi possível salvar. Tente novamente.", ok ? "success" : "info");
  }

  async function continueToQuote() {
    if (readOnly) { if (currentEvaluationIdRef.current) encounter?.onContinue(currentEvaluationIdRef.current); return; }
    if (!validateAssessment()) return;
    if (!await autosave.flush()) { revealValidationTarget("evaluation-header-card"); return; }
    const savedEvaluationId = await saveEvaluation("Concluída");
    if (savedEvaluationId) encounter?.onContinue(savedEvaluationId);
  }

  // Na avaliação facial o PNG segue as chaves de visibilidade da tela (marcações ocultas = só a foto; legendas desligadas = sem as pílulas).
  async function exportImage() {
    if (!activePhoto) return;
    const dataUrl = await renderExport(activePhoto, facialMode ? { marks: showMarks, labels: showLabels } : undefined);
    const link = document.createElement("a");
    link.download = `${activePhoto.name.replace(/\.[^.]+$/, "")}-avaliacao.png`;
    link.href = dataUrl;
    link.click();
    showNotice("Imagem exportada com as marcações.");
  }

  // Atalhos da avaliação facial (Ctrl/Cmd + Z, Y, Shift+Z, +, -, 0 e Esc): valem com o foco no editor ou na página, nunca em campo de texto ou diálogo.
  const shortcutRef = useRef({ undo, redo, zoomIn, zoomOut, zoomReset, toggleExpanded, expanded, marksHidden: !showMarks });
  useEffect(() => { shortcutRef.current = { undo, redo, zoomIn, zoomOut, zoomReset, toggleExpanded, expanded, marksHidden: !showMarks }; });
  useEffect(() => {
    if (!facialMode || readOnly) return;
    function onKeyDown(event: KeyboardEvent) {
      const root = facialRootRef.current;
      const target = event.target as HTMLElement | null;
      if (!root || !target || !(root.contains(target) || target === document.body || target === document.documentElement)) return;
      if (isTextEntryTarget(target)) return;
      const current = shortcutRef.current;
      if (event.key === "Escape" && current.expanded) { event.preventDefault(); current.toggleExpanded(); return; }
      const action = shortcutFromKey(event);
      if (!action) return;
      event.preventDefault(); // dentro do editor Ctrl +/-/0 é do zoom da foto, não da página
      if (action === "zoomIn") current.zoomIn();
      else if (action === "zoomOut") current.zoomOut();
      else if (action === "zoomReset") current.zoomReset();
      else if (current.marksHidden) return;
      else if (action === "undo") current.undo();
      else current.redo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [facialMode, readOnly]);

  const toolbarProps: EditorToolbarProps = {
    tool, color, strokeWidth, canUndo, canRedo, hasSelection: Boolean(selectedId), marksHidden: !showMarks, isSaving, readOnly,
    onToolChange: changeTool, onColorChange: changeColor, onStrokeWidthChange: changeStrokeWidth, onUndo: undo, onRedo: redo, onZoomIn: zoomIn, onZoomOut: zoomOut, onZoomReset: zoomReset,
    onDeleteSelected: deleteSelected, onClear: clearAnnotations, onSave: () => void saveNow(), onExport: exportImage,
  };
  const panelProps: FacialSidePanelProps = {
    readOnly, photos, activePhotoId, onSelectPhoto: selectPhoto, onAddPhotos: openFilePicker, onCapture: () => void openCamera(), onCategoryChange: changePhotoCategory, onMovePhoto: movePhoto, onReplacePhoto: replacePhoto, onRemovePhoto: removePhoto,
    annotations: activePhoto?.annotations ?? [], selectedId, onSelectAnnotation: selectAnnotation, onDeleteAnnotation: deleteAnnotation, onClearAllAnnotations: clearAnnotations, onLabelChange: labelAnnotation, labelFocusId, onLabelFocused: clearLabelFocus,
    notes: assessment.facialNotes, notesMax: facialNotesMaxLength, onNotesChange: (value) => changeAssessment("facialNotes", value),
    color, onColorChange: changeColor, strokeWidth, onStrokeWidthChange: changeStrokeWidth, showMarks, onShowMarks: changeShowMarks, showLabels, onShowLabels: setShowLabels,
  };
  const workspaceProps: FacialWorkspaceProps = {
    status: isLoading ? "loading" : loadError ? "error" : "ready",
    onRetryLoad: () => { setLoadError(false); setIsLoading(true); setHydrated(false); setLoadAttempt((value) => value + 1); },
    receivingPhoto, activePhoto, areaRef: canvasWrapRef, scale: displayScale, recenterKey, zoomPercent: Math.round(zoom * 100),
    tool, color, strokeWidth, selectedId, showMarks, showLabels, expanded, canUndo, canRedo, mobile: toolbarProps,
    onToolChange: changeTool, onUndo: undo, onRedo: redo, onZoomIn: zoomIn, onZoomOut: zoomOut, onToggleExpanded: toggleExpanded, onAddPhotos: openFilePicker, onCapture: () => void openCamera(), onExport: exportImage, onSave: () => void saveNow(), saveDisabled: !hydrated || loadError, saving: isSaving || autosave.state === "saving",
    onSelect: selectAnnotation, onCommitAnnotations: commitAnnotations, onPreviewAnnotations: updatePhotoAnnotations,
    onPointCreated: (id) => { setShowLabels(true); setLabelFocusId(id); },
    panel: panelProps, photoUploadError, saveError,
  };

  return (
    <div data-hide-fab className={cn("max-lg:pb-24", encounter && "space-y-4")}>
      {encounter ? <>
        <EncounterBreadcrumb patientName={patientName} journeyName={encounterLabel} stage={step === "facial" ? "Avaliação facial" : "Avaliação clínica"} onClients={() => void autosave.leave(encounter.onClients)} onPatient={() => void autosave.leave(encounter.onPatient)} onJourney={() => void autosave.leave(encounter.onJourney)} />
        {step === "facial" ? <FacialTitle /> : <button type="button" onClick={() => void autosave.leave(encounter.onJourney)} className="flex items-center gap-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-primary max-lg:min-h-11"><ArrowLeft className="h-4 w-4" />Voltar aos tratamentos</button>}
        <Card id="evaluation-header-card" tabIndex={-1} className="flex scroll-mt-24 flex-wrap items-center justify-between gap-4 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#efedff] text-sm font-black text-[#5147dc]">{patientName.split(" ").map((part) => part[0]).slice(0, 2).join("")}</div>
            <div className="min-w-0"><h2 className="truncate text-base font-bold">{patientName}</h2><p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground"><span>{encounter.patient.age ? `${encounter.patient.age} anos` : "Idade não informada"}</span><span>{encounter.patient.phone || "Telefone não informado"}</span></p><div className="mt-1.5 flex flex-wrap gap-2"><span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">{encounter.patient.status}</span><span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">Paciente desde {encounter.patient.createdAt ? new Date(encounter.patient.createdAt).toLocaleDateString("pt-BR") : "data indisponível"}</span></div></div>
          </div>
          {step === "facial" ? <FacialCardActions autosaveState={autosave.state} finishLabel={readOnly ? "Avançar para orçamento" : "Concluir e ir ao orçamento"} finishing={isSaving} hasRecord={Boolean(currentEvaluationId)} isSaving={isSaving} lastSavedAt={lastSavedAt} readOnly={readOnly} onBack={() => void backToClinical()} onFinish={() => void continueToQuote()} onRetry={() => void autosave.flush()} /> : <div className="flex flex-wrap items-center gap-2"><span role="status" className={cn("text-xs", autosave.state === "error" ? "text-destructive" : "text-muted-foreground")}>{readOnly ? "Somente leitura" : autosave.state === "saving" ? "Salvando..." : autosave.state === "pending" ? "Alterações pendentes" : autosave.state === "error" ? "Não foi possível salvar" : "Rascunho salvo"}</span>{autosave.state === "error" && !readOnly ? <Button size="sm" variant="outline" onClick={() => void autosave.flush()}>Tentar novamente</Button> : null}</div>}
        </Card>
        <JourneyProgress current={0} />
        {readOnly ? <ReadOnlyStageNotice /> : null}
      </> : null}
      <Card className={cn("overflow-hidden max-lg:overflow-clip border-[#e3e5f0] bg-white p-0 text-[#25263a] shadow-[0_12px_34px_rgba(38,39,58,0.06)]", encounter && "border-0 bg-transparent shadow-none")}>
        {!encounter ? <div className="flex flex-col gap-3 border-b border-[#ececf3] bg-white px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div><div className="flex items-center gap-2"><Camera className="h-4 w-4 text-[#5147dc]" /><h3 className="text-sm font-bold">{encounter ? "Avaliação clínica" : "Fotos da avaliação"}</h3></div><p className="mt-1 text-xs text-[#858696]">Registre as informações clínicas e as fotografias de {patientName}.</p></div>
          <div className="flex items-center gap-2 text-xs text-[#858696]"><FileJson className="h-3.5 w-3.5 text-[#5147dc]" />Marcações editáveis salvas separadamente</div>
        </div> : null}

        {facialMode ? <div ref={facialRootRef} role={expanded ? "dialog" : undefined} aria-modal={expanded ? true : undefined} aria-label={expanded ? "Área de trabalho ampliada da avaliação facial" : undefined} onKeyDown={expanded ? trapTab : undefined} className={cn("space-y-3", expanded && "fixed inset-0 z-[70] flex flex-col gap-3 space-y-0 overflow-auto bg-background p-3")}>
          {expanded ? <FacialExpandedBar autosaveState={autosave.state} hasRecord={Boolean(currentEvaluationId)} isSaving={isSaving} lastSavedAt={lastSavedAt} patientName={patientName} readOnly={readOnly} onCollapse={toggleExpanded} /> : null}
          <FacialWorkspace {...workspaceProps} />
          <input ref={fileInputRef} aria-hidden="true" className="sr-only" tabIndex={-1} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { void uploadPhotos(event.target.files); event.target.value = ""; }} />
          <FacialFooter autosaveState={autosave.state} hasRecord={Boolean(currentEvaluationId)} isSaving={isSaving} lastSavedAt={lastSavedAt} markings={activePhoto?.annotations.length ?? 0} readOnly={readOnly} onRetry={() => void autosave.flush()} />
        </div> : <div inert={readOnly} className={cn("grid gap-4 p-4", encounter && "grid-cols-1 p-0 lg:grid-cols-[minmax(0,1fr)_290px]")}>
          <div className="min-w-0">
            {showClinicalView ? (encounter && !hydrated ? <Card className="space-y-3 p-4"><LoadingSkeleton className="h-5 w-40" /><LoadingSkeleton className="h-16 w-full" /><LoadingSkeleton className="h-28 w-full" /></Card> : encounter && loadError ? <div className="grid min-h-[200px] place-items-center rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-center"><div><p className="text-sm font-semibold text-destructive">Não foi possível carregar esta avaliação.</p><Button className="mt-3" variant="outline" onClick={() => { setLoadError(false); setIsLoading(true); setHydrated(false); setLoadAttempt((value) => value + 1); }}>Tentar novamente</Button></div></div> : <AssessmentForm assessment={assessment} errors={assessmentErrors} validationAttempt={assessmentValidationAttempt} onChange={changeAssessment} />) : null}
            <IncomingPhotoStatus active={receivingPhoto} />
            {showLegacyPhotos ? <section id="evaluation-photo-card" tabIndex={-1} className={cn("mt-4 grid scroll-mt-24 grid-cols-[minmax(0,1fr)] gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(240px,0.5fr)]", saveError && "border-destructive")} aria-label="Registro fotográfico e marcação">
              {isLoading ? <div className="grid min-h-[420px] gap-4 rounded-[8px] border border-[#dfe2ee] bg-[#f8f9fc] p-5 2xl:col-span-2"><LoadingSkeleton className="h-7 w-52" /><LoadingSkeleton className="h-3 w-80" /><div className="grid min-h-[300px] place-items-center rounded-[7px] border border-[#e4e6ef] bg-white"><div className="w-full max-w-md space-y-3 px-8"><LoadingSkeleton className="h-56 w-full" /><LoadingSkeleton className="mx-auto h-3 w-40" /><LoadingSkeleton className="mx-auto h-2.5 w-56" /></div></div></div> : loadError ? <div className="grid min-h-[360px] place-items-center rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-center"><div><p className="text-sm font-semibold text-destructive">Não foi possível carregar esta avaliação.</p><Button className="mt-3" variant="outline" onClick={() => { setLoadError(false); setIsLoading(true); setLoadAttempt((value) => value + 1); }}>Tentar novamente</Button></div></div> : showResult ? <EvaluationResult onEdit={() => setShowResult(false)} previews={savedPreviews} /> : (<>
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[184px_minmax(0,1fr)]">
                  <EditorToolbar canRedo={canRedo} canUndo={canUndo} color={color} strokeWidth={strokeWidth} hasSelection={Boolean(selectedId)} onClear={clearAnnotations} onColorChange={changeColor} onStrokeWidthChange={changeStrokeWidth} onDeleteSelected={deleteSelected} onExport={exportImage} onRedo={redo} onSave={() => { if (encounter) void autosave.flush(); else void saveEvaluation(); }} onToolChange={changeTool} onUndo={undo} onZoomIn={zoomIn} onZoomOut={zoomOut} onZoomReset={zoomReset} isSaving={isSaving} readOnly={readOnly} tool={tool} />
                  <div ref={canvasWrapRef} className="min-w-0">
                  {activePhoto ? <EditorCanvas color={color} strokeWidth={strokeWidth} onCommitAnnotations={commitAnnotations} onPreviewAnnotations={updatePhotoAnnotations} onSelect={selectAnnotation} photo={activePhoto} scale={displayScale} selectedId={selectedId} tool={tool} /> : <label className="flex min-h-[360px] cursor-pointer flex-col items-center justify-center rounded-[8px] border border-dashed border-[#cfd3e4] bg-[#fbfbfe] px-5 text-center transition hover:border-[#5147dc] hover:bg-[#f8f7ff]"><span className="grid h-12 w-12 place-items-center rounded-full bg-[#efedff] text-[#5147dc]"><ImagePlus className="h-5 w-5" /></span><strong className="mt-4 text-sm">Adicione a primeira foto da avaliação</strong><span className="mt-1 max-w-sm text-xs leading-5 text-[#858696]">JPG, PNG ou WEBP. A imagem original fica preservada e as marcações são armazenadas separadamente.</span><span className="mt-4 inline-flex items-center rounded-[7px] bg-[#5147dc] px-4 py-2 text-xs font-bold text-white">Escolher foto</span><input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { void uploadPhotos(event.target.files); event.target.value = ""; }} /></label>}
                  {photoUploadError ? <p id="evaluation-photo-upload-error" tabIndex={-1} role="alert" className="mt-2 scroll-mt-24 text-xs font-medium text-destructive animate-[hp-shake_0.42s_ease-in-out]">{photoUploadError}</p> : null}
                  {saveError ? <p id="evaluation-save-error" tabIndex={-1} role="alert" className="mt-2 scroll-mt-24 text-xs text-destructive animate-[hp-shake_0.42s_ease-in-out]">{saveError}</p> : null}
                </div>
                </div>
                <aside className="space-y-3">
                  <div className="rounded-[8px] border border-[#e3e5f0] bg-white p-3">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div><p className="text-xs font-bold">Fotos anexadas ({photos.length})</p><p className="mt-1 text-xs text-muted-foreground">Clique para selecionar; use as setas para organizar.</p></div>
                      <button className="text-xs font-semibold text-primary hover:underline max-lg:min-h-11 max-lg:px-2" type="button" onClick={() => fileInputRef.current?.click()}>Adicionar fotos</button>
                    </div>
                    <PhotoGallery activePhotoId={activePhotoId} onCategoryChange={changePhotoCategory} onMove={movePhoto} onRemove={removePhoto} onReplace={replacePhoto} onSelect={(photoId) => { setActivePhotoId(photoId); setSelectedId(null); setZoom(1); }} onUpload={uploadPhotos} photos={photos} />
                  </div>
                  <div className="rounded-[8px] border border-[#e3e5f0] bg-white p-3"><h4 className="text-xs font-bold">Marcação / observações sobre a foto</h4>{activePhoto ? <div className="mt-2 space-y-1.5 text-xs text-muted-foreground"><p>Categoria: <strong className="text-foreground">{activePhoto.category}</strong></p><p>{activePhoto.annotations.length ? `${activePhoto.annotations.length} marcação(ões) editável(is) nesta imagem.` : "Nenhuma marcação feita nesta foto."}</p><p className="truncate" title={activePhoto.name}>Arquivo: {activePhoto.name}</p></div> : <p className="mt-2 text-xs text-muted-foreground">Selecione ou adicione uma foto para ver suas marcações.</p>}</div>
                  <div className="rounded-[8px] border border-[#e3e5f0] bg-white p-3">
                    <label htmlFor="facial-notes" className="text-xs font-bold">Observações da avaliação facial</label>
                    <textarea id="facial-notes" className="mt-2 w-full resize-y rounded-[5px] border border-[#dfe1ea] bg-white px-2.5 py-2 text-sm font-normal text-[#25263a] outline-none placeholder:text-[#8c8d9c] focus:border-[#5147dc] focus:ring-1 focus:ring-[#5147dc]/20" rows={4} maxLength={facialNotesMaxLength} placeholder="Adicione observações sobre esta avaliação..." value={assessment.facialNotes} onChange={(event) => changeAssessment("facialNotes", event.target.value)} />
                    <p className="mt-1 text-right text-xs text-muted-foreground">{assessment.facialNotes.length}/{facialNotesMaxLength}</p>
                  </div>
                </aside>
              </>)}
            </section> : null}
          </div>
          {encounter ? <aside className="space-y-3"><Card className="space-y-2 p-4"><h3 className="flex items-center gap-2 text-sm font-bold"><UserRound className="h-4 w-4 text-primary" />Resumo rápido do atendimento</h3>{[["Etapa atual", step === "facial" ? "Avaliação facial" : "Avaliação clínica"], ["Profissional", professional || "Não informado"], ["Data", new Date().toLocaleDateString("pt-BR")], ["Status", currentEvaluationId ? evaluationStatus : "Novo rascunho"], ["Fotos anexadas", String(photos.length)]].map(([label, value]) => <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2.5 py-2 text-xs" key={label}><span className="text-muted-foreground">{label}</span><span className="truncate font-semibold">{value}</span></div>)}</Card><Card className="space-y-2 p-4"><h3 className="flex items-center gap-2 text-sm font-bold"><CircleCheck className="h-4 w-4 text-primary" />Checklist da avaliação</h3>{[["Anamnese preenchida", Boolean(assessment.chiefComplaint.trim() && (assessment.allergies.trim() || assessment.pregnancyStatus || assessment.anticoagulantUse || assessment.autoimmuneDiseases || assessment.previousProcedures.trim()))], ["Fotos iniciais registradas", photos.length > 0], ["Marcação realizada", photos.some((photo) => photo.annotations.length > 0)], ["Observações clínicas salvas", Boolean(assessment.clinicalNotes.trim() && !isDirty)]].map(([label, done]) => <div className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-2 text-xs" key={String(label)}><span className={cn("grid h-4 w-4 place-items-center rounded border", done ? "border-primary bg-primary text-primary-foreground" : "border-input")}>{done ? <Check className="h-3 w-3" /> : null}</span>{label}</div>)}</Card></aside> : null}
        </div>}

      {encounter && step === "clinical" ? <div className="mt-4 flex justify-end max-lg:[&>button]:w-full"><Button className="max-lg:min-h-11" disabled={isSaving || !hydrated || loadError} onClick={() => void continueToFacial()}>{isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Continuar para avaliação facial<ChevronRight className="h-4 w-4" /></Button></div> : null}

      {notice ? (
        <div id="evaluation-notice" role="status" tabIndex={-1} className={cn("mx-4 mb-4 flex scroll-mt-24 items-center gap-2 rounded-[7px] border px-3 py-2 text-xs", facialMode && "fixed bottom-24 right-4 z-[80] mx-0 mb-0 max-w-sm shadow-lg lg:bottom-6", notice.tone === "success" ? "border-[#b9e8d8] bg-[#effbf6] text-[#16805d]" : "border-[#d7d9ee] bg-[#f7f6ff] text-[#5147dc]")}>
          <Info className="h-3.5 w-3.5 shrink-0" />
          {notice.text}
        </div>
      ) : null}

      <Modal
        open={Boolean(confirmAction)}
        onClose={() => setConfirmAction(null)}
        title={confirmAction?.type === "clear" ? "Limpar marcações" : "Excluir imagem"}
        description={confirmAction?.type === "clear" ? "A foto original continuará preservada." : `A foto "${confirmAction?.photoName ?? ""}" será removida da avaliação.`}
      >
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-3 rounded-[8px] border border-[#f1dfb7] bg-[#fffbf1] p-4 text-xs leading-5 text-[#7a5b16]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#c38b19]" />
            <p>{confirmAction?.type === "clear" ? "Todas as marcações desta foto serão removidas. Essa ação poderá ser desfeita pelo botão Desfazer." : "Essa ação remove a foto e as marcações associadas a ela desta avaliação."}</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirmAction(null)}>Cancelar</Button>
            <Button className="border-[#f2c8c3] text-[#b42318] hover:border-[#b42318] hover:bg-[#fff7f7] hover:text-[#b42318]" type="button" variant="secondary" onClick={confirmPendingAction}>
              {confirmAction?.type === "clear" ? "Limpar marcações" : "Excluir imagem"}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal open={Boolean(pendingPhotos)} onClose={() => setPendingPhotos(null)} title="Qual é o ângulo da foto?" description="Escolha o ângulo de cada foto antes de anexá-la à avaliação.">
        <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); confirmPendingPhotos(); }}>
          <ul className="grid gap-3">
            {pendingPhotos?.map((photo) => (
              <li className="flex items-center gap-3" key={photo.id}>
                {/* eslint-disable-next-line @next/next/no-img-element -- prévia local (data URL) da foto ainda não anexada */}
                <img alt="" className="h-14 w-14 shrink-0 rounded-md border border-border object-cover object-top" src={photo.imageUrl} />
                <div className="min-w-0 flex-1">
                  <label className="block truncate text-xs text-muted-foreground" htmlFor={`angle-${photo.id}`} title={photo.name}>{photo.name}</label>
                  <select className="mt-1 h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" id={`angle-${photo.id}`} value={photo.category} onChange={(event) => setPendingPhotos((current) => current?.map((item) => item.id === photo.id ? { ...item, category: event.target.value as EvaluationPhoto["category"] } : item) ?? null)}>
                    {photoAngles.map((angle) => <option key={angle}>{angle}</option>)}
                  </select>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setPendingPhotos(null)}>Cancelar</Button><Button type="submit">Adicionar {pendingPhotos && pendingPhotos.length > 1 ? "fotos" : "foto"}</Button></div>
        </form>
      </Modal>
      <Modal open={cameraOpen} onClose={closeCamera} title="Capturar foto" description="A imagem será vinculada a esta avaliação clínica."><div className="grid gap-4">{cameraError ? <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{cameraError}</p> : <video ref={attachCameraVideo} autoPlay muted playsInline className="max-h-[65vh] w-full rounded-md bg-black" />}{cameraHint ? <p role="alert" className="text-sm text-destructive">{cameraHint}</p> : null}<div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={closeCamera}>Cancelar</Button><Button type="button" disabled={!cameraStream} onClick={() => void captureCameraPhoto()}><Camera className="h-4 w-4" />Capturar</Button></div></div></Modal>
      </Card>
    </div>
  );
}

function AssessmentForm({ assessment, errors = {}, validationAttempt = 0, onChange }: { assessment: ClinicalAssessment; errors?: Partial<Record<RequiredAssessmentField, string>>; validationAttempt?: number; onChange: (field: keyof ClinicalAssessment, value: string) => void }) {
  const textareaClass = "w-full resize-y rounded-[5px] border border-[#dfe1ea] bg-white px-2.5 py-2 text-sm font-normal text-[#25263a] outline-none placeholder:text-[#8c8d9c] focus:border-[#5147dc] focus:ring-1 focus:ring-[#5147dc]/20";
  const controlClass = "h-8 w-full rounded-[5px] border border-[#dfe1ea] bg-white px-2 text-sm font-normal text-[#25263a] outline-none focus:border-[#5147dc] focus:ring-1 focus:ring-[#5147dc]/20";
  const invalidClass = "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]";
  const fieldProps = (field: RequiredAssessmentField) => ({ id: `assessment-field-${field}`, "aria-invalid": Boolean(errors[field]), "aria-describedby": errors[field] ? `assessment-error-${field}` : undefined });
  const fieldError = (field: RequiredAssessmentField) => errors[field] ? <span id={`assessment-error-${field}`} role="alert" className="text-xs font-medium text-[#b42318]">{errors[field]}</span> : null;
  const required = <span className="text-destructive"> *</span>;
  const anamnesisFields = [
    { key: "allergies" as const, label: "Alergias", icon: ShieldAlert },
    { key: "pregnancyStatus" as const, label: "Gestante", icon: Baby },
    { key: "anticoagulantUse" as const, label: "Uso de anticoagulante", icon: Droplet },
    { key: "autoimmuneDiseases" as const, label: "Doenças autoimunes", icon: Dna },
    { key: "previousProcedures" as const, label: "Procedimentos anteriores", icon: Syringe },
  ];
  const renderAnamnesisField = (field: typeof anamnesisFields[number]) => {
    const Icon = field.icon;
    return <label className="min-w-0 rounded-[5px] border border-[#e5e6ee] bg-white p-2" key={field.key}>
      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[#6f7082]"><Icon className="h-3.5 w-3.5 shrink-0 text-[#5147dc]" aria-hidden="true" />{field.label}{required}</span>
      <select key={`${field.key}-${validationAttempt}`} {...fieldProps(field.key)} className={cn(controlClass, errors[field.key] && invalidClass)} value={assessment[field.key]} onChange={(event) => onChange(field.key, event.target.value)}><option value="">Selecione</option><option value="Não">Não</option><option value="Sim">Sim</option>{assessment[field.key] && !["Não", "Sim"].includes(assessment[field.key]) ? <option value={assessment[field.key]}>{assessment[field.key]}</option> : null}</select>
      {fieldError(field.key)}
    </label>;
  };

  return <Card id="evaluation-assessment-card" tabIndex={-1} className={cn("scroll-mt-24 p-3 sm:p-4", Object.keys(errors).length > 0 && "border-destructive")}>
    <h3 className="flex items-center gap-2 text-sm font-bold"><ClipboardPenLine className="h-4 w-4 text-primary" />Avaliação clínica</h3>
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      <label className="grid min-w-0 gap-1 text-xs font-semibold"><span>Queixa principal{required}</span><textarea key={`chief-complaint-${validationAttempt}`} {...fieldProps("chiefComplaint")} className={cn(textareaClass, "min-h-[54px]", errors.chiefComplaint && invalidClass)} rows={2} maxLength={5000} placeholder="Descreva a queixa principal" value={assessment.chiefComplaint} onChange={(event) => onChange("chiefComplaint", event.target.value)} />{fieldError("chiefComplaint")}</label>
      <label className="grid min-w-0 gap-1 text-xs font-semibold"><span>Objetivo do paciente{required}</span><textarea key={`patient-goal-${validationAttempt}`} {...fieldProps("patientGoal")} className={cn("text-sm", textareaClass, "min-h-[54px]", errors.patientGoal && invalidClass)} rows={2} maxLength={5000} placeholder="Não informado" value={assessment.patientGoal} onChange={(event) => onChange("patientGoal", event.target.value)} />{fieldError("patientGoal")}</label>
      <section aria-labelledby="anamnesis-title" className="min-w-0">
        <h4 id="anamnesis-title" className="mb-2 text-xs font-bold">Anamnese rápida</h4>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">{anamnesisFields.slice(0, 3).map(renderAnamnesisField)}</div>
        <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">{anamnesisFields.slice(3).map(renderAnamnesisField)}</div>
      </section>
      <label className="grid min-w-0 content-start gap-1 text-xs font-semibold"><span>Observações clínicas{required}</span><textarea key={`clinical-notes-${validationAttempt}`} {...fieldProps("clinicalNotes")} className={cn("text-sm", textareaClass, "min-h-[116px]", errors.clinicalNotes && invalidClass)} rows={5} maxLength={5000} placeholder="Não informado" value={assessment.clinicalNotes} onChange={(event) => onChange("clinicalNotes", event.target.value)} />{fieldError("clinicalNotes")}</label>
    </div>
  </Card>;
}

async function readPhoto(file: File, sortOrder = 0): Promise<EvaluationPhoto> {
  if (file.size > 6_000_000) throw new Error("Cada imagem deve ter até 6 MB.");
  const originalUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const { width, height } = await getImageSize(originalUrl);
  if (width > 8000 || height > 8000 || width * height > 25_000_000) throw new Error("A resolução desta imagem excede o limite seguro de 25 megapixels.");
  const category: EvaluationPhoto["category"] = /frontal/i.test(file.name) ? "Frontal" : /perfil.?d|direito/i.test(file.name) ? "Perfil direito" : /perfil.?e|esquerdo/i.test(file.name) ? "Perfil esquerdo" : /sorriso/i.test(file.name) ? "Sorriso" : "Outra";
  return { id: `photo-${crypto.randomUUID()}`, name: file.name, imageUrl: originalUrl, width, height, category, sortOrder, annotations: [] };
}

function getImageSize(src: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = src;
  });
}

function omitKey<T>(record: Record<string, T>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}
