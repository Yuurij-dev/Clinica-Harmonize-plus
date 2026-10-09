"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { AlertTriangle, Camera, FileJson, ImagePlus, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { LoadingSkeleton } from "../shared";
import { EditorToolbar } from "./editor-toolbar";
import { EvaluationResult } from "./evaluation-result";
import { PhotoGallery } from "./photo-gallery";
import type { AnnotationSnapshot, EditorTool, EvaluationPhoto, PhotoAnnotation } from "./types";

const EditorCanvas = dynamic(
  () => import("./editor-canvas").then((module) => module.EditorCanvas),
  { ssr: false },
);

type Notice = { tone: "success" | "info"; text: string } | null;
export type SavedEvaluation = { id: string; professional: string; createdAt: string; updatedAt: string; photoCount: number };
type ConfirmAction = { type: "photo"; photoId: string; photoName: string } | { type: "clear" } | null;

export function PhotoEditor({ patientId, evaluationId, patientName, onSaved }: { patientId: string; evaluationId?: string; patientName: string; onSaved?: (evaluation: SavedEvaluation) => void }) {
  const [currentEvaluationId, setCurrentEvaluationId] = useState(evaluationId);
  const evaluationCacheKey = evaluationId ? `/api/patients/${patientId}/evaluation?evaluationId=${encodeURIComponent(evaluationId)}` : null;
  const cachedEvaluation = evaluationCacheKey ? readClientCache<{ evaluation?: { photos?: EvaluationPhoto[] } | null }>(evaluationCacheKey) : null;
  const [photos, setPhotos] = useState<EvaluationPhoto[]>(cachedEvaluation?.evaluation?.photos ?? []);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [tool, setTool] = useState<EditorTool>("select");
  const [color, setColor] = useState("#6c4cff");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [past, setPast] = useState<Record<string, AnnotationSnapshot[]>>({});
  const [future, setFuture] = useState<Record<string, AnnotationSnapshot[]>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [isLoading, setIsLoading] = useState(Boolean(evaluationCacheKey) && (!cachedEvaluation || Boolean(cachedEvaluation.evaluation?.photos?.length)));
  const [isSaving, setIsSaving] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [savedPreviews, setSavedPreviews] = useState<Array<{ photo: EvaluationPhoto; dataUrl: string }>>([]);
  const activePhoto = photos.find((photo) => photo.id === activePhotoId) ?? null;
  const fitScale = activePhoto
    ? Math.min(1, 980 / activePhoto.width, 540 / activePhoto.height)
    : 1;
  const displayScale = fitScale * zoom;
  const canUndo = Boolean(activePhotoId && past[activePhotoId]?.length);
  const canRedo = Boolean(activePhotoId && future[activePhotoId]?.length);

  useEffect(() => {
    if (!evaluationCacheKey) return;
    let active = true;
    getCachedJson<{ evaluation?: { photos?: EvaluationPhoto[] } | null }>(evaluationCacheKey)
      .then(async (data) => {
        if (!active) return;
        const restored = data.evaluation?.photos ?? [];
        setPhotos(restored);
        setActivePhotoId(restored[0]?.id ?? null);
        if (restored.length) {
          const previews = await Promise.all(restored.map(async (photo) => ({ photo, dataUrl: await renderExport(photo) })));
          if (!active) return;
          setSavedPreviews(previews);
          setShowResult(true);
        }
      })
      .catch(() => {
        if (active) showNotice("Não foi possível carregar as fotos salvas.", "info");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, [evaluationCacheKey]);

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

  async function uploadPhotos(files: FileList | null) {
    if (!files?.length) return;
    const selectedFiles = Array.from(files);
    const accepted = selectedFiles.filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type));
    if (accepted.length !== selectedFiles.length) showNotice("Envie apenas imagens JPG, PNG ou WEBP.", "info");
    const loaded = await Promise.all(accepted.map(readPhoto));
    if (!loaded.length) {
      showNotice("Escolha uma imagem JPG, PNG ou WEBP.", "info");
      return;
    }
    setPhotos((current) => [...current, ...loaded]);
    setActivePhotoId((current) => current ?? loaded[0].id);
    showNotice(`${loaded.length} foto${loaded.length > 1 ? "s" : ""} adicionada${loaded.length > 1 ? "s" : ""}.`);
  }

  function removePhoto(photoId: string) {
    const photo = photos.find((item) => item.id === photoId);
    if (!photo) return;
    setConfirmAction({ type: "photo", photoId, photoName: photo.name });
  }

  function executeRemovePhoto(photoId: string) {
    const remaining = photos.filter((item) => item.id !== photoId);
    setPhotos(remaining);
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

  function deleteSelected() {
    if (!activePhoto || !selectedId) return;
    commitAnnotations(
      activePhoto.annotations.filter((annotation) => annotation.id !== selectedId),
      activePhoto.annotations,
    );
    setSelectedId(null);
  }

  async function saveEvaluation() {
    if (!photos.length) {
      showNotice("Adicione pelo menos uma foto antes de salvar a avaliação.", "info");
      return;
    }
    setIsSaving(true);
    try {
      const response = await fetch(`/api/patients/${patientId}/evaluation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evaluationId: currentEvaluationId, photos }),
      });
      const data = await response.json().catch(() => ({})) as { evaluation?: SavedEvaluation };
      if (!response.ok || !data.evaluation) throw new Error("Não foi possível salvar a avaliação.");
      setCurrentEvaluationId(data.evaluation.id);
      invalidateClientCache(`/api/patients/${patientId}/evaluation`, `/api/patients/${patientId}/history`);
      const previews = await Promise.all(photos.map(async (photo) => ({ photo, dataUrl: await renderExport(photo) })));
      setSavedPreviews(previews);
      setShowResult(true);
      onSaved?.(data.evaluation);
      showNotice("Avaliação salva com as fotos originais e as marcações separadas.");
    } catch {
      showNotice("Não foi possível salvar as fotos da avaliação.", "info");
    } finally {
      setIsSaving(false);
    }
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
    <Card className="overflow-hidden border-[#e3e5f0] bg-white p-0 text-[#25263a] shadow-[0_12px_34px_rgba(38,39,58,0.06)]">
      <div className="flex flex-col gap-3 border-b border-[#ececf3] bg-white px-5 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-[#5147dc]" />
            <h3 className="text-sm font-bold">Fotos da avaliação</h3>
          </div>
          <p className="mt-1 text-[11px] text-[#858696]">Faça marcações sobre as fotos de {patientName} sem alterar os arquivos originais.</p>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[#858696]">
          <FileJson className="h-3.5 w-3.5 text-[#5147dc]" />
          Marcações editáveis salvas em JSON
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[auto_minmax(0,1fr)]">
        {isLoading ? <div className="grid min-h-[420px] gap-4 rounded-[8px] border border-[#dfe2ee] bg-[#f8f9fc] p-5 lg:col-span-2"><LoadingSkeleton className="h-7 w-52" /><LoadingSkeleton className="h-3 w-80" /><div className="grid min-h-[300px] place-items-center rounded-[7px] border border-[#e4e6ef] bg-white"><div className="w-full max-w-md space-y-3 px-8"><LoadingSkeleton className="h-56 w-full" /><LoadingSkeleton className="mx-auto h-3 w-40" /><LoadingSkeleton className="mx-auto h-2.5 w-56" /></div></div></div> : showResult ? <EvaluationResult onEdit={() => setShowResult(false)} previews={savedPreviews} /> : <>
          <EditorToolbar
          canRedo={canRedo}
          canUndo={canUndo}
          color={color}
          hasSelection={Boolean(selectedId)}
          onClear={clearAnnotations}
          onColorChange={setColor}
          onDeleteSelected={deleteSelected}
          onExport={exportImage}
          onRedo={redo}
          onSave={saveEvaluation}
          onToolChange={(nextTool) => {
            setTool(nextTool);
            if (nextTool !== "select") setSelectedId(null);
          }}
          onUndo={undo}
          onZoomIn={() => setZoom((value) => Math.min(2.25, value + 0.15))}
          onZoomOut={() => setZoom((value) => Math.max(0.55, value - 0.15))}
          onZoomReset={() => setZoom(1)}
          isSaving={isSaving}
          tool={tool}
          />

          <div className="min-w-0">
          {isLoading ? (
            <div className="min-h-[360px] space-y-4 rounded-[8px] border border-[#dfe2ee] bg-[#f8f9fc] p-5"><LoadingSkeleton className="h-5 w-40" /><LoadingSkeleton className="h-[300px] w-full" /></div>
          ) : activePhoto ? (
            <EditorCanvas
              color={color}
              onCommitAnnotations={commitAnnotations}
              onPreviewAnnotations={updatePhotoAnnotations}
              onSelect={setSelectedId}
              photo={activePhoto}
              scale={displayScale}
              selectedId={selectedId}
              tool={tool}
            />
          ) : (
            <label className="flex min-h-[360px] cursor-pointer flex-col items-center justify-center rounded-[8px] border border-dashed border-[#cfd3e4] bg-[#fbfbfe] px-5 text-center transition hover:border-[#5147dc] hover:bg-[#f8f7ff]">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-[#efedff] text-[#5147dc]"><ImagePlus className="h-5 w-5" /></span>
              <strong className="mt-4 text-sm">Adicione a primeira foto da avaliação</strong>
              <span className="mt-1 max-w-sm text-[11px] leading-5 text-[#858696]">JPG, PNG ou WEBP. A imagem original fica preservada e as marcações são armazenadas separadamente.</span>
              <span className="mt-4 inline-flex items-center rounded-[7px] bg-[#5147dc] px-4 py-2 text-xs font-bold text-white shadow-[0_8px_18px_rgba(81,71,220,0.28)] transition hover:bg-[#6357ef]">Escolher foto</span>
              <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => uploadPhotos(event.target.files)} />
            </label>
          )}

          <div className="mt-4 rounded-[8px] border border-[#e3e5f0] bg-white p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#5147dc]">Galeria da avaliação</p>
                <p className="mt-1 text-[11px] text-[#858696]">Cada foto possui seu próprio conjunto de marcações.</p>
              </div>
              {!photos.length ? <span className="text-[10px] text-[#9a9bab]">Nenhuma foto adicionada</span> : null}
            </div>
            <PhotoGallery activePhotoId={activePhotoId} onRemove={removePhoto} onSelect={(photoId) => { setActivePhotoId(photoId); setSelectedId(null); setZoom(1); }} onUpload={uploadPhotos} photos={photos} />
          </div>
          </div>
        </>}
      </div>

      {notice ? (
        <div className={cn("mx-4 mb-4 flex items-center gap-2 rounded-[7px] border px-3 py-2 text-[11px]", notice.tone === "success" ? "border-[#b9e8d8] bg-[#effbf6] text-[#16805d]" : "border-[#d7d9ee] bg-[#f7f6ff] text-[#5147dc]")}>
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
    </Card>
  );
}

async function readPhoto(file: File): Promise<EvaluationPhoto> {
  const originalUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const { width: originalWidth, height: originalHeight } = await getImageSize(originalUrl);
  const scale = Math.min(1, 1600 / originalWidth, 1600 / originalHeight);
  const width = Math.max(1, Math.round(originalWidth * scale));
  const height = Math.max(1, Math.round(originalHeight * scale));
  const imageUrl = scale < 1 || file.size > 500_000 ? await resizeImage(originalUrl, width, height) : originalUrl;
  return { id: `photo-${crypto.randomUUID()}`, name: file.name, imageUrl, width, height, annotations: [] };
}

function resizeImage(src: string, width: number, height: number) {
  return new Promise<string>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Não foi possível preparar a imagem."));
        return;
      }
      context.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.86));
    };
    image.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    image.src = src;
  });
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
