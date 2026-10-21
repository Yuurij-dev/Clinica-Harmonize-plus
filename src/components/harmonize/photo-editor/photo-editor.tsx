"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Baby, Camera, Check, ChevronRight, CircleCheck, ClipboardPenLine, Dna, Droplet, FileJson, ImagePlus, Info, Loader2, Maximize2, ShieldAlert, Syringe, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { LoadingSkeleton } from "../shared";
import { EditorToolbar } from "./editor-toolbar";
import { EvaluationResult } from "./evaluation-result";
import { PhotoGallery } from "./photo-gallery";
import { EncounterBreadcrumb, type EncounterBreadcrumbActions } from "../encounter-breadcrumb";
import { useDraftAutosave } from "../use-draft-autosave";
import { ReadOnlyStageNotice } from "../readonly-stage-notice";
import { revealValidationTarget } from "../reveal-validation-target";
import { JourneyProgress } from "../journey-progress";
import type { AnnotationSnapshot, EditorTool, EvaluationPhoto, PhotoAnnotation } from "./types";
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
};

const emptyAssessment: ClinicalAssessment = { chiefComplaint: "", patientGoal: "", medicalHistory: "", allergies: "", pregnancyStatus: "", anticoagulantUse: "", autoimmuneDiseases: "", contraindications: "", previousProcedures: "", clinicalNotes: "" };

export function PhotoEditor({ patientId, evaluationId, journeyId, patientName, onSaved, encounter, encounterLabel = "Novo atendimento", readOnly = false }: { patientId: string; evaluationId?: string; journeyId?: string; patientName: string; onSaved?: (evaluation: SavedEvaluation) => void; encounter?: { patient: Patient; onContinue: (evaluationId: string) => void } & EncounterBreadcrumbActions; encounterLabel?: string; readOnly?: boolean }) {
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
  const [color, setColor] = useState("#6c4cff");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
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
  const [assessmentError, setAssessmentError] = useState("");
  const [assessmentValidationAttempt, setAssessmentValidationAttempt] = useState(0);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<EvaluationPhoto | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [savedPreviews, setSavedPreviews] = useState<Array<{ photo: EvaluationPhoto; dataUrl: string }>>([]);
  const isEncounterMode = Boolean(encounter);
  const activePhoto = photos.find((photo) => photo.id === activePhotoId) ?? null;
  const fitScale = activePhoto
    ? Math.min(1, 980 / activePhoto.width, 540 / activePhoto.height)
    : 1;
  const displayScale = fitScale * zoom;
  const canUndo = Boolean(activePhotoId && past[activePhotoId]?.length);
  const canRedo = Boolean(activePhotoId && future[activePhotoId]?.length);
  const autosave = useDraftAutosave({ scope: `${patientId}:${journeyId ?? ""}`, revision: editRevision, enabled: isEncounterMode && !readOnly && hydrated && !loadError, save: async () => Boolean(await saveEvaluation("Rascunho", true)) });

  function markDirty() {
    editRevisionRef.current += 1;
    setEditRevision(editRevisionRef.current);
    setIsDirty(true);
  }

  useEffect(() => {
    if (cameraVideoRef.current && cameraStream) cameraVideoRef.current.srcObject = cameraStream;
  }, [cameraStream, cameraOpen]);

  useEffect(() => () => cameraStream?.getTracks().forEach((track) => track.stop()), [cameraStream]);

  useEffect(() => {
    if (!evaluationCacheKey) return;
    let active = true;
    getCachedJson<{ evaluation?: ({ photos?: EvaluationPhoto[]; status?: string; professional?: string } & Partial<ClinicalAssessment>) | null }>(evaluationCacheKey)
      .then(async (data) => {
        if (!active) return;
        const restored = data.evaluation?.photos ?? [];
        currentEvaluationIdRef.current = evaluationId;
        setAssessment({ ...emptyAssessment, ...data.evaluation });
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
    if (!activePhotoId) return;
    setPast((current) => ({
      ...current,
      [activePhotoId]: [...(current[activePhotoId] ?? []), previous],
    }));
    setFuture((current) => ({ ...current, [activePhotoId]: [] }));
    updatePhotoAnnotations(next);
  }

  function undo() {
    if (!activePhoto) return;
    const history = past[activePhoto.id] ?? [];
    const previous = history.at(-1);
    if (!previous) return;
    setPast((current) => ({ ...current, [activePhoto.id]: history.slice(0, -1) }));
    setFuture((current) => ({
      ...current,
      [activePhoto.id]: [...(current[activePhoto.id] ?? []), activePhoto.annotations],
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
    if (!files?.length) return;
    setPhotoUploadError("");
    const selectedFiles = Array.from(files);
    const accepted = selectedFiles.filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 6_000_000);
    if (accepted.length !== selectedFiles.length) showPhotoUploadError("Alguns arquivos foram ignorados. Use JPG, PNG ou WEBP de até 6 MB.");
    if (photos.length + accepted.length > 20) { showPhotoUploadError("A avaliação aceita até 20 fotos. Remova uma imagem ou selecione menos arquivos."); return; }
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
    setPhotos((current) => [...current, ...loaded]);
    setActivePhotoId((current) => current ?? loaded[0].id);
    markDirty();
    showNotice(`${loaded.length} foto${loaded.length > 1 ? "s" : ""} adicionada${loaded.length > 1 ? "s" : ""}.`);
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
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Este dispositivo ou navegador não permite capturar fotos pela câmera.");
      setCameraOpen(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "user" } }, audio: false });
      setCameraStream(stream);
      setCameraOpen(true);
    } catch {
      setCameraError("Não foi possível acessar a câmera. Verifique a permissão do navegador e tente novamente.");
      setCameraOpen(true);
    }
  }

  function closeCamera() {
    cameraStream?.getTracks().forEach((track) => track.stop());
    setCameraStream(null);
    setCameraOpen(false);
  }

  async function captureCameraPhoto() {
    const video = cameraVideoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    if (video.videoWidth * video.videoHeight > 25_000_000) {
      setCameraError("A resolução da câmera excede o limite seguro de 25 megapixels.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageUrl = canvas.toDataURL("image/jpeg", 0.9);
    const photo: EvaluationPhoto = { id: `photo-${crypto.randomUUID()}`, name: `captura-${new Date().toISOString()}.jpg`, imageUrl, width: canvas.width, height: canvas.height, category: "Frontal", sortOrder: photos.length, annotations: [] };
    setPhotos((current) => [...current, photo]);
    setActivePhotoId(photo.id);
    markDirty();
    closeCamera();
    showNotice("Foto capturada e adicionada à avaliação.");
  }

  function changeAssessment(field: keyof ClinicalAssessment, value: string) {
    setAssessment((current) => ({ ...current, [field]: value }));
    markDirty();
    setSaveError("");
    if (field === "chiefComplaint" && value.trim()) setAssessmentError("");
  }

  function deleteSelected() {
    if (!activePhoto || !selectedId) return;
    commitAnnotations(
      activePhoto.annotations.filter((annotation) => annotation.id !== selectedId),
      activePhoto.annotations,
    );
    setSelectedId(null);
  }

  async function saveEvaluation(status: "Rascunho" | "Concluída" = encounter ? "Rascunho" : evaluationStatus, automatic = false) {
    if (!encounter && !photos.length) {
      showNotice("Adicione pelo menos uma foto antes de salvar a avaliação.", "info");
      revealValidationTarget("evaluation-photo-card", "evaluation-notice");
      return null;
    }
    setIsSaving(true);
    setSaveError("");
    const startedRevision = editRevisionRef.current;
    try {
      const response = await fetch(`/api/patients/${patientId}/evaluation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evaluationId: currentEvaluationIdRef.current, journeyId, photos, assessment, status }),
      });
      const data = await response.json().catch(() => ({})) as { evaluation?: SavedEvaluation; message?: string };
      if (!response.ok || !data.evaluation) throw new Error(data.message ?? "Não foi possível salvar a avaliação.");
      setCurrentEvaluationId(data.evaluation.id);
      currentEvaluationIdRef.current = data.evaluation.id;
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

  async function continueToQuote() {
    if (readOnly) { if (currentEvaluationIdRef.current) encounter?.onContinue(currentEvaluationIdRef.current); return; }
    if (!assessment.chiefComplaint.trim()) {
      setAssessmentError("Informe a queixa principal para avançar.");
      setAssessmentValidationAttempt((current) => current + 1);
      revealValidationTarget("evaluation-assessment-card");
      return;
    }
    if (!await autosave.flush()) { revealValidationTarget("evaluation-header-card"); return; }
    const savedEvaluationId = await saveEvaluation("Concluída");
    if (savedEvaluationId) encounter?.onContinue(savedEvaluationId);
  }

  async function exportImage() {
    if (!activePhoto) return;
    const dataUrl = await renderExport(activePhoto);
    const link = document.createElement("a");
    link.download = `${activePhoto.name.replace(/\.[^.]+$/, "")}-avaliacao.png`;
    link.href = dataUrl;
    link.click();
    showNotice("Imagem exportada com as marcações.");
  }

  return (
    <div className={encounter ? "space-y-4" : undefined}>
      {encounter ? <>
        <EncounterBreadcrumb patientName={patientName} journeyName={encounterLabel} stage="Avaliação" onClients={() => void autosave.leave(encounter.onClients)} onPatient={() => void autosave.leave(encounter.onPatient)} onJourney={() => void autosave.leave(encounter.onJourney)} />
        <button type="button" onClick={() => void autosave.leave(encounter.onJourney)} className="flex items-center gap-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-primary"><ArrowLeft className="h-4 w-4" />Voltar aos tratamentos</button>
        <Card id="evaluation-header-card" tabIndex={-1} className="flex scroll-mt-24 flex-wrap items-center justify-between gap-4 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#efedff] text-sm font-black text-[#5147dc]">{patientName.split(" ").map((part) => part[0]).slice(0, 2).join("")}</div>
            <div className="min-w-0"><h2 className="truncate text-base font-bold">{patientName}</h2><p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground"><span>{encounter.patient.age ? `${encounter.patient.age} anos` : "Idade não informada"}</span><span>{encounter.patient.phone || "Telefone não informado"}</span></p><div className="mt-1.5 flex flex-wrap gap-2"><span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">{encounter.patient.status}</span><span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">Paciente desde {encounter.patient.createdAt ? new Date(encounter.patient.createdAt).toLocaleDateString("pt-BR") : "data indisponível"}</span></div></div>
          </div>
          <div className="flex flex-wrap items-center gap-2"><span role="status" className={cn("text-xs", autosave.state === "error" ? "text-destructive" : "text-muted-foreground")}>{readOnly ? "Somente leitura" : autosave.state === "saving" ? "Salvando..." : autosave.state === "pending" ? "Alterações pendentes" : autosave.state === "error" ? "Não foi possível salvar" : "Rascunho salvo"}</span>{autosave.state === "error" && !readOnly ? <Button size="sm" variant="outline" onClick={() => void autosave.flush()}>Tentar novamente</Button> : null}<Button disabled={isSaving} onClick={() => void continueToQuote()}>{isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Avançar para orçamento<ChevronRight className="h-4 w-4" /></Button></div>
        </Card>
        <JourneyProgress current={0} />
        {readOnly ? <ReadOnlyStageNotice /> : null}
      </> : null}
      <Card className={cn("overflow-hidden border-[#e3e5f0] bg-white p-0 text-[#25263a] shadow-[0_12px_34px_rgba(38,39,58,0.06)]", encounter && "border-0 bg-transparent shadow-none")}>
        {!encounter ? <div className="flex flex-col gap-3 border-b border-[#ececf3] bg-white px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div><div className="flex items-center gap-2"><Camera className="h-4 w-4 text-[#5147dc]" /><h3 className="text-sm font-bold">{encounter ? "Avaliação clínica" : "Fotos da avaliação"}</h3></div><p className="mt-1 text-xs text-[#858696]">Registre as informações clínicas e as fotografias de {patientName}.</p></div>
          <div className="flex items-center gap-2 text-xs text-[#858696]"><FileJson className="h-3.5 w-3.5 text-[#5147dc]" />Marcações editáveis salvas separadamente</div>
        </div> : null}

        <div inert={readOnly} className={cn("grid gap-4 p-4", encounter && "grid-cols-1 p-0 lg:grid-cols-[minmax(0,1fr)_290px]")}>
          <div className="min-w-0">
            {encounter || evaluationId ? <AssessmentForm assessment={assessment} error={assessmentError} validationAttempt={assessmentValidationAttempt} onChange={changeAssessment} /> : null}
            <section id="evaluation-photo-card" tabIndex={-1} className={cn("mt-4 grid scroll-mt-24 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.8fr)]", encounter && "rounded-md border border-[#e3e5f0] bg-white p-3 sm:p-4", saveError && "border-destructive")} aria-label="Registro fotográfico e marcação">
              {encounter ? <div className="flex items-center gap-2 lg:col-span-2"><Camera className="h-4 w-4 text-primary" /><h3 className="text-sm font-bold">Registro fotográfico e marcação</h3></div> : null}
              {isLoading ? <div className="grid min-h-[420px] gap-4 rounded-[8px] border border-[#dfe2ee] bg-[#f8f9fc] p-5 lg:col-span-2"><LoadingSkeleton className="h-7 w-52" /><LoadingSkeleton className="h-3 w-80" /><div className="grid min-h-[300px] place-items-center rounded-[7px] border border-[#e4e6ef] bg-white"><div className="w-full max-w-md space-y-3 px-8"><LoadingSkeleton className="h-56 w-full" /><LoadingSkeleton className="mx-auto h-3 w-40" /><LoadingSkeleton className="mx-auto h-2.5 w-56" /></div></div></div> : loadError ? <div className="grid min-h-[360px] place-items-center rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-center"><div><p className="text-sm font-semibold text-destructive">Não foi possível carregar esta avaliação.</p><Button className="mt-3" variant="outline" onClick={() => { setLoadError(false); setIsLoading(true); setLoadAttempt((value) => value + 1); }}>Tentar novamente</Button></div></div> : showResult ? <EvaluationResult onEdit={() => setShowResult(false)} previews={savedPreviews} /> : (<>
                <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(150px,0.45fr)_minmax(0,1fr)]">
                  <EditorToolbar canRedo={canRedo} canUndo={canUndo} color={color} strokeWidth={strokeWidth} hasSelection={Boolean(selectedId)} onClear={clearAnnotations} onColorChange={setColor} onStrokeWidthChange={setStrokeWidth} onDeleteSelected={deleteSelected} onExport={exportImage} onRedo={redo} onSave={() => { if (encounter) void autosave.flush(); else void saveEvaluation(); }} onToolChange={(nextTool) => { setTool(nextTool); if (nextTool !== "select") setSelectedId(null); }} onUndo={undo} onZoomIn={() => setZoom((value) => Math.min(2.25, value + 0.15))} onZoomOut={() => setZoom((value) => Math.max(0.55, value - 0.15))} onZoomReset={() => setZoom(1)} isSaving={isSaving} tool={tool} />
                  <div className="min-w-0">
                  {encounter ? <div className="mb-3 flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" onClick={() => void openCamera()}><Camera className="h-4 w-4" />Capturar foto</Button><Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}><ImagePlus className="h-4 w-4" />Upload de fotos</Button><input ref={fileInputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { void uploadPhotos(event.target.files); event.target.value = ""; }} />{activePhoto ? <Button size="sm" variant="outline" onClick={() => setPreviewPhoto(activePhoto)}><Maximize2 className="h-4 w-4" />Ampliar foto</Button> : null}</div> : null}
                  {activePhoto ? <EditorCanvas color={color} strokeWidth={strokeWidth} onCommitAnnotations={commitAnnotations} onPreviewAnnotations={updatePhotoAnnotations} onSelect={setSelectedId} photo={activePhoto} scale={displayScale} selectedId={selectedId} tool={tool} /> : <label className="flex min-h-[360px] cursor-pointer flex-col items-center justify-center rounded-[8px] border border-dashed border-[#cfd3e4] bg-[#fbfbfe] px-5 text-center transition hover:border-[#5147dc] hover:bg-[#f8f7ff]"><span className="grid h-12 w-12 place-items-center rounded-full bg-[#efedff] text-[#5147dc]"><ImagePlus className="h-5 w-5" /></span><strong className="mt-4 text-sm">Adicione a primeira foto da avaliação</strong><span className="mt-1 max-w-sm text-xs leading-5 text-[#858696]">JPG, PNG ou WEBP. A imagem original fica preservada e as marcações são armazenadas separadamente.</span><span className="mt-4 inline-flex items-center rounded-[7px] bg-[#5147dc] px-4 py-2 text-xs font-bold text-white">Escolher foto</span><input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { void uploadPhotos(event.target.files); event.target.value = ""; }} /></label>}
                  {photoUploadError ? <p id="evaluation-photo-upload-error" tabIndex={-1} role="alert" className="mt-2 scroll-mt-24 text-xs font-medium text-destructive animate-[hp-shake_0.42s_ease-in-out]">{photoUploadError}</p> : null}
                  {saveError ? <p id="evaluation-save-error" tabIndex={-1} role="alert" className="mt-2 scroll-mt-24 text-xs text-destructive animate-[hp-shake_0.42s_ease-in-out]">{saveError}</p> : null}
                </div>
                </div>
                <aside className="space-y-3">
                  <div className="rounded-[8px] border border-[#e3e5f0] bg-white p-3">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div><p className="text-xs font-bold">Fotos anexadas ({photos.length})</p><p className="mt-1 text-xs text-muted-foreground">Clique para selecionar; use as setas para organizar.</p></div>
                      <button className="text-xs font-semibold text-primary hover:underline" type="button" onClick={() => fileInputRef.current?.click()}>Adicionar fotos</button>
                    </div>
                    <PhotoGallery activePhotoId={activePhotoId} onCategoryChange={changePhotoCategory} onMove={movePhoto} onRemove={removePhoto} onReplace={replacePhoto} onSelect={(photoId) => { setActivePhotoId(photoId); setSelectedId(null); setZoom(1); }} onUpload={uploadPhotos} photos={photos} />
                  </div>
                  <div className="rounded-[8px] border border-[#e3e5f0] bg-white p-3"><h4 className="text-xs font-bold">Marcação / observações sobre a foto</h4>{activePhoto ? <div className="mt-2 space-y-1.5 text-xs text-muted-foreground"><p>Categoria: <strong className="text-foreground">{activePhoto.category}</strong></p><p>{activePhoto.annotations.length ? `${activePhoto.annotations.length} marcação(ões) editável(is) nesta imagem.` : "Nenhuma marcação feita nesta foto."}</p><p className="truncate" title={activePhoto.name}>Arquivo: {activePhoto.name}</p></div> : <p className="mt-2 text-xs text-muted-foreground">Selecione ou adicione uma foto para ver suas marcações.</p>}</div>
                </aside>
              </>)}
            </section>
          </div>
          {encounter ? <aside className="space-y-3"><Card className="space-y-2 p-4"><h3 className="flex items-center gap-2 text-sm font-bold"><UserRound className="h-4 w-4 text-primary" />Resumo rápido do atendimento</h3>{[["Etapa atual", "Avaliação"], ["Profissional", professional || "Não informado"], ["Data", new Date().toLocaleDateString("pt-BR")], ["Status", currentEvaluationId ? evaluationStatus : "Novo rascunho"], ["Fotos anexadas", String(photos.length)]].map(([label, value]) => <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2.5 py-2 text-xs" key={label}><span className="text-muted-foreground">{label}</span><span className="truncate font-semibold">{value}</span></div>)}</Card><Card className="space-y-2 p-4"><h3 className="flex items-center gap-2 text-sm font-bold"><CircleCheck className="h-4 w-4 text-primary" />Checklist da avaliação</h3>{[["Anamnese preenchida", Boolean(assessment.chiefComplaint.trim() && (assessment.allergies.trim() || assessment.pregnancyStatus || assessment.anticoagulantUse || assessment.autoimmuneDiseases || assessment.previousProcedures.trim()))], ["Fotos iniciais registradas", photos.length > 0], ["Marcação realizada", photos.some((photo) => photo.annotations.length > 0)], ["Observações clínicas salvas", Boolean(assessment.clinicalNotes.trim() && !isDirty)]].map(([label, done]) => <div className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-2 text-xs" key={String(label)}><span className={cn("grid h-4 w-4 place-items-center rounded border", done ? "border-primary bg-primary text-primary-foreground" : "border-input")}>{done ? <Check className="h-3 w-3" /> : null}</span>{label}</div>)}</Card></aside> : null}
        </div>

      {notice ? (
        <div id="evaluation-notice" tabIndex={-1} className={cn("mx-4 mb-4 flex scroll-mt-24 items-center gap-2 rounded-[7px] border px-3 py-2 text-xs", notice.tone === "success" ? "border-[#b9e8d8] bg-[#effbf6] text-[#16805d]" : "border-[#d7d9ee] bg-[#f7f6ff] text-[#5147dc]")}>
          <Info className="h-3.5 w-3.5 shrink-0" />
          {notice.text}
        </div>
      ) : null}

      <Modal
        open={Boolean(confirmAction)}
        onClose={() => setConfirmAction(null)}
        title={confirmAction?.type === "clear" ? "Limpar marcações" : "Remover foto"}
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
              {confirmAction?.type === "clear" ? "Limpar marcações" : "Remover foto"}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal open={cameraOpen} onClose={closeCamera} title="Capturar foto" description="A imagem será vinculada a esta avaliação clínica."><div className="grid gap-4">{cameraError ? <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{cameraError}</p> : <video ref={cameraVideoRef} autoPlay playsInline className="max-h-[65vh] w-full rounded-md bg-black" />}<div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={closeCamera}>Cancelar</Button><Button type="button" disabled={!cameraStream} onClick={() => void captureCameraPhoto()}><Camera className="h-4 w-4" />Capturar</Button></div></div></Modal>
      <Modal open={Boolean(previewPhoto)} onClose={() => setPreviewPhoto(null)} title={previewPhoto?.category ?? "Pré-visualização"} description={previewPhoto?.name ?? ""}>{previewPhoto ? <Image className="mx-auto max-h-[75vh] max-w-full object-contain" src={previewPhoto.imageUrl} alt={`Foto ${previewPhoto.category} de ${patientName}`} width={previewPhoto.width} height={previewPhoto.height} unoptimized /> : null}</Modal>
      </Card>
    </div>
  );
}

function AssessmentForm({ assessment, error, validationAttempt, onChange }: { assessment: ClinicalAssessment; error?: string; validationAttempt?: number; onChange: (field: keyof ClinicalAssessment, value: string) => void }) {
  const textareaClass = "w-full resize-y rounded-[5px] border border-[#dfe1ea] bg-white px-2.5 py-2 text-sm font-normal text-[#25263a] outline-none placeholder:text-[#8c8d9c] focus:border-[#5147dc] focus:ring-1 focus:ring-[#5147dc]/20";
  const controlClass = "h-8 w-full rounded-[5px] border border-[#dfe1ea] bg-white px-2 text-sm font-normal text-[#25263a] outline-none focus:border-[#5147dc] focus:ring-1 focus:ring-[#5147dc]/20";
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
      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[#6f7082]"><Icon className="h-3.5 w-3.5 shrink-0 text-[#5147dc]" aria-hidden="true" />{field.label}</span>
      <select className={controlClass} value={assessment[field.key]} onChange={(event) => onChange(field.key, event.target.value)}><option value="">Não informado</option><option value="Não">Não</option><option value="Sim">Sim</option>{assessment[field.key] && !["Não", "Sim"].includes(assessment[field.key]) ? <option value={assessment[field.key]}>{assessment[field.key]}</option> : null}</select>
    </label>;
  };

  return <Card id="evaluation-assessment-card" tabIndex={-1} className={cn("scroll-mt-24 p-3 sm:p-4", error && "border-destructive")}>
    <h3 className="flex items-center gap-2 text-sm font-bold"><ClipboardPenLine className="h-4 w-4 text-primary" />Avaliação clínica</h3>
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      <label className="grid min-w-0 gap-1 text-xs font-semibold"><span>Queixa principal <span className="text-destructive">*</span></span><textarea key={`chief-complaint-${validationAttempt ?? 0}`} aria-invalid={Boolean(error)} aria-describedby={error ? "chief-complaint-error" : undefined} className={cn(textareaClass, "min-h-[54px]", error && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} rows={2} maxLength={5000} placeholder="Descreva a queixa principal" value={assessment.chiefComplaint} onChange={(event) => onChange("chiefComplaint", event.target.value)} />{error ? <span id="chief-complaint-error" role="alert" className="text-xs font-medium text-[#b42318]">{error}</span> : null}</label>
      <label className="grid min-w-0 gap-1 text-xs font-semibold"><span>Objetivo do paciente</span><textarea className={`text-sm ${textareaClass} min-h-[54px]`} rows={2} maxLength={5000} placeholder="Não informado" value={assessment.patientGoal} onChange={(event) => onChange("patientGoal", event.target.value)} /></label>
      <section aria-labelledby="anamnesis-title" className="min-w-0">
        <h4 id="anamnesis-title" className="mb-2 text-xs font-bold">Anamnese rápida</h4>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">{anamnesisFields.slice(0, 3).map(renderAnamnesisField)}</div>
        <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">{anamnesisFields.slice(3).map(renderAnamnesisField)}</div>
      </section>
      <label className="grid min-w-0 content-start gap-1 text-xs font-semibold">Observações clínicas<textarea className={`text-sm ${textareaClass} min-h-[116px]`} rows={5} maxLength={5000} placeholder="Não informado" value={assessment.clinicalNotes} onChange={(event) => onChange("clinicalNotes", event.target.value)} /></label>
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

async function renderExport(photo: EvaluationPhoto) {
  const canvas = document.createElement("canvas");
  canvas.width = photo.width;
  canvas.height = photo.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível preparar a exportação.");
  const image = await getImageElement(photo.imageUrl);
  context.drawImage(image, 0, 0, photo.width, photo.height);
  photo.annotations.forEach((annotation) => drawAnnotation(context, annotation));
  return canvas.toDataURL("image/png");
}

function getImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function drawAnnotation(context: CanvasRenderingContext2D, annotation: PhotoAnnotation) {
  context.save();
  context.strokeStyle = annotation.color;
  context.fillStyle = annotation.color;
  context.lineWidth = annotation.strokeWidth;
  context.lineCap = "round";
  context.lineJoin = "round";

  if (annotation.type === "text") {
    context.font = `${annotation.fontSize}px Inter, Arial, sans-serif`;
    context.fillText(annotation.text, annotation.x, annotation.y);
    context.restore();
    return;
  }

  if (annotation.type === "point") {
    context.beginPath();
    context.arc(annotation.x, annotation.y, annotation.radius, 0, Math.PI * 2);
    context.fill();
    context.lineWidth = Math.max(1, annotation.strokeWidth);
    context.strokeStyle = "#ffffff";
    context.stroke();
    context.restore();
    return;
  }

  if (annotation.type === "ellipse") {
    context.beginPath();
    context.ellipse(annotation.x + annotation.width / 2, annotation.y + annotation.height / 2, Math.abs(annotation.width / 2), Math.abs(annotation.height / 2), 0, 0, Math.PI * 2);
    context.stroke();
    context.restore();
    return;
  }

  if (annotation.points.length < 4) {
    context.restore();
    return;
  }
  context.beginPath();
  context.moveTo(annotation.points[0], annotation.points[1]);
  for (let index = 2; index < annotation.points.length; index += 2) context.lineTo(annotation.points[index], annotation.points[index + 1]);
  context.stroke();

  if (annotation.type === "arrow") {
    const end = annotation.points.length - 2;
    const beforeEnd = Math.max(0, end - 2);
    const angle = Math.atan2(annotation.points[end + 1] - annotation.points[beforeEnd + 1], annotation.points[end] - annotation.points[beforeEnd]);
    const size = 14;
    context.beginPath();
    context.moveTo(annotation.points[end], annotation.points[end + 1]);
    context.lineTo(annotation.points[end] - size * Math.cos(angle - Math.PI / 6), annotation.points[end + 1] - size * Math.sin(angle - Math.PI / 6));
    context.lineTo(annotation.points[end] - size * Math.cos(angle + Math.PI / 6), annotation.points[end + 1] - size * Math.sin(angle + Math.PI / 6));
    context.closePath();
    context.fill();
  }
  context.restore();
}

function omitKey<T>(record: Record<string, T>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}
