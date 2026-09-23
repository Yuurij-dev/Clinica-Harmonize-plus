"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Camera, FileJson, ImagePlus, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { EditorToolbar } from "./editor-toolbar";
import { PhotoGallery } from "./photo-gallery";
import type { AnnotationSnapshot, EditorTool, EvaluationPhoto, PhotoAnnotation } from "./types";

const EditorCanvas = dynamic(
  () => import("./editor-canvas").then((module) => module.EditorCanvas),
  { ssr: false },
);

type StoredEvaluation = {
  photos: Array<Omit<EvaluationPhoto, "annotations">>;
  annotationsByPhotoId: Record<string, PhotoAnnotation[]>;
};

type Notice = { tone: "success" | "info"; text: string } | null;

export function PhotoEditor({ patientName }: { patientName: string }) {
  const storageKey = `harmonize:evaluation:${patientName}`;
  const [photos, setPhotos] = useState<EvaluationPhoto[]>([]);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [tool, setTool] = useState<EditorTool>("select");
  const [color, setColor] = useState("#6c4cff");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [past, setPast] = useState<Record<string, AnnotationSnapshot[]>>({});
  const [future, setFuture] = useState<Record<string, AnnotationSnapshot[]>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const activePhoto = photos.find((photo) => photo.id === activePhotoId) ?? null;
  const fitScale = activePhoto
    ? Math.min(1, 980 / activePhoto.width, 540 / activePhoto.height)
    : 1;
  const displayScale = fitScale * zoom;
  const canUndo = Boolean(activePhotoId && past[activePhotoId]?.length);
  const canRedo = Boolean(activePhotoId && future[activePhotoId]?.length);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(storageKey);
        if (!stored) return;
        const parsed = JSON.parse(stored) as StoredEvaluation;
        const restored = parsed.photos.map((photo) => ({
          ...photo,
          annotations: parsed.annotationsByPhotoId?.[photo.id] ?? [],
        }));
        setPhotos(restored);
        setActivePhotoId(restored[0]?.id ?? null);
      } catch {
        // Ignore invalid mock data and keep the empty editor available.
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [storageKey]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const storedEvaluation = useMemo<StoredEvaluation>(() => ({
    photos: photos.map((photo) => Object.fromEntries(
      Object.entries(photo).filter(([key]) => key !== "annotations"),
    ) as Omit<EvaluationPhoto, "annotations">),
    annotationsByPhotoId: Object.fromEntries(photos.map((photo) => [photo.id, photo.annotations])),
  }), [photos]);

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
    const accepted = Array.from(files).filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type));
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
    if (!photo || !window.confirm(`Remover a foto "${photo.name}" da avaliação?`)) return;
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
    if (!activePhoto || !activePhoto.annotations.length) return;
    if (!window.confirm("Limpar todas as marcações desta foto? A foto original continuará preservada.")) return;
    commitAnnotations([], activePhoto.annotations);
    setSelectedId(null);
    showNotice("Marcações removidas. Você ainda pode desfazer essa ação.");
  }

  function deleteSelected() {
    if (!activePhoto || !selectedId) return;
    commitAnnotations(
      activePhoto.annotations.filter((annotation) => annotation.id !== selectedId),
      activePhoto.annotations,
    );
    setSelectedId(null);
  }

  function saveEvaluation() {
    window.localStorage.setItem(storageKey, JSON.stringify(storedEvaluation));
    showNotice("Avaliação salva com as fotos originais e as marcações separadas.");
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
    <Card className="overflow-hidden border-[#102b52] bg-[#06152c] p-0 text-white shadow-[0_18px_45px_rgba(5,18,43,0.16)]">
      <div className="flex flex-col gap-3 border-b border-[#12315d] px-5 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-[#8b78ff]" />
            <h3 className="text-sm font-bold">Fotos da avaliação</h3>
          </div>
          <p className="mt-1 text-[11px] text-[#93a8ca]">Faça marcações sobre as fotos de {patientName} sem alterar os arquivos originais.</p>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[#93a8ca]">
          <FileJson className="h-3.5 w-3.5 text-[#8b78ff]" />
          Marcações editáveis salvas em JSON
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[auto_minmax(0,1fr)]">
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
          tool={tool}
        />

        <div className="min-w-0">
          {activePhoto ? (
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
            <label className="flex min-h-[360px] cursor-pointer flex-col items-center justify-center rounded-[8px] border border-dashed border-[#31547e] bg-[#101724] px-5 text-center transition hover:border-[#6c4cff] hover:bg-[#0d1c36]">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-[#1b2b57] text-[#9d8eff]"><ImagePlus className="h-5 w-5" /></span>
              <strong className="mt-4 text-sm">Adicione a primeira foto da avaliação</strong>
              <span className="mt-1 max-w-sm text-[11px] leading-5 text-[#93a8ca]">JPG, PNG ou WEBP. A imagem original fica preservada e as marcações são armazenadas separadamente.</span>
              <span className="mt-4 inline-flex items-center rounded-[7px] bg-[#5147dc] px-4 py-2 text-xs font-bold text-white shadow-[0_8px_18px_rgba(81,71,220,0.28)] transition hover:bg-[#6357ef]">Escolher foto</span>
              <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => uploadPhotos(event.target.files)} />
            </label>
          )}

          <div className="mt-4 rounded-[8px] border border-[#12315d] bg-[#071338] p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#8b9ec1]">Galeria da avaliação</p>
                <p className="mt-1 text-[11px] text-[#93a8ca]">Cada foto possui seu próprio conjunto de marcações.</p>
              </div>
              {!photos.length ? <span className="text-[10px] text-[#6f86ad]">Nenhuma foto adicionada</span> : null}
            </div>
            <PhotoGallery activePhotoId={activePhotoId} onRemove={removePhoto} onSelect={(photoId) => { setActivePhotoId(photoId); setSelectedId(null); setZoom(1); }} onUpload={uploadPhotos} photos={photos} />
          </div>
        </div>
      </div>

      {notice ? (
        <div className={cn("mx-4 mb-4 flex items-center gap-2 rounded-[7px] border px-3 py-2 text-[11px]", notice.tone === "success" ? "border-[#245f55] bg-[#0c2e2b] text-[#b7f5e4]" : "border-[#34527c] bg-[#0d2345] text-[#d2ddff]")}>
          <Info className="h-3.5 w-3.5 shrink-0" />
          {notice.text}
        </div>
      ) : null}
    </Card>
  );
}

async function readPhoto(file: File): Promise<EvaluationPhoto> {
  const imageUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const { width, height } = await getImageSize(imageUrl);
  return { id: `photo-${crypto.randomUUID()}`, name: file.name, imageUrl, width, height, annotations: [] };
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
