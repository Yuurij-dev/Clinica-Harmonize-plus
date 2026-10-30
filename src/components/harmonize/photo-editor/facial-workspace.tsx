"use client";

import dynamic from "next/dynamic";
import { Camera, ImagePlus } from "lucide-react";
import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { IncomingPhotoStatus } from "../incoming-photo-status";
import { LoadingSkeleton } from "../shared";
import { EditorMobileActions, EditorMobileBar } from "./editor-mobile-bar";
import type { EditorToolbarProps } from "./editor-toolbar";
import { FacialSidePanel, type FacialSidePanelProps } from "./facial-side-panel";
import { FacialToolbar } from "./facial-toolbar";
import type { AnnotationSnapshot, EditorTool, EvaluationPhoto, PhotoAnnotation } from "./types";

const EditorCanvas = dynamic(
  () => import("./editor-canvas").then((module) => module.EditorCanvas),
  { ssr: false },
);

export type FacialWorkspaceProps = {
  status: "loading" | "error" | "ready";
  onRetryLoad: () => void;
  receivingPhoto: boolean;
  activePhoto: EvaluationPhoto | null;
  /** Mede a área da foto (largura e altura) para ajustar a foto a ela. */
  areaRef: RefObject<HTMLDivElement | null>;
  scale: number;
  recenterKey: number;
  zoomPercent: number;
  tool: EditorTool;
  color: string;
  strokeWidth: number;
  selectedId: string | null;
  showMarks: boolean;
  showLabels: boolean;
  expanded: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Barra do celular e ações fixas (abaixo de lg): as mesmas chamadas da barra de desktop. */
  mobile: EditorToolbarProps;
  onToolChange: (tool: EditorTool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleExpanded: () => void;
  onAddPhotos: () => void;
  onCapture: () => void;
  onExport: () => void;
  onSave: () => void;
  saveDisabled: boolean;
  saving: boolean;
  onSelect: (id: string | null) => void;
  onCommitAnnotations: (annotations: PhotoAnnotation[], previous: AnnotationSnapshot) => boolean;
  onPreviewAnnotations: (annotations: PhotoAnnotation[]) => void;
  onPointCreated: (id: string) => void;
  panel: FacialSidePanelProps;
  photoUploadError: string;
  saveError: string;
};

/** Área de trabalho da avaliação facial: barra de ferramentas, foto (ampla, centralizada) e painel direito. */
export function FacialWorkspace({ areaRef, ...props }: FacialWorkspaceProps) {
  const { status, activePhoto, expanded } = props;
  const noPhoto = !activePhoto;
  // Avaliação só para consulta: trocar de foto, zoom, ajustar, expandir e exportar seguem livres; desenhar, selecionar e editar ficam desligados.
  const readOnly = Boolean(props.mobile.readOnly);
  const viewTool: EditorTool = readOnly ? "pan" : props.tool;
  return (
    <section aria-label="Avaliação facial: fotos e marcações" className="scroll-mt-24 space-y-3 outline-none" id="evaluation-photo-card" tabIndex={-1}>
      <IncomingPhotoStatus active={props.receivingPhoto} />
      <FacialToolbar canRedo={props.canRedo} canUndo={props.canUndo} expanded={expanded} marksHidden={!props.showMarks || readOnly} noPhoto={noPhoto} readOnly={readOnly} tool={viewTool} zoomPercent={props.zoomPercent} onAddPhotos={props.onAddPhotos} onExport={props.onExport} onSave={props.onSave} saveDisabled={props.saveDisabled} saving={props.saving} onRedo={props.onRedo} onToggleExpanded={props.onToggleExpanded} onToolChange={props.onToolChange} onUndo={props.onUndo} onZoomIn={props.onZoomIn} onZoomOut={props.onZoomOut} />
      <EditorMobileBar {...props.mobile} tool={viewTool} hasSelection={!readOnly && props.mobile.hasSelection} marksHidden={props.mobile.marksHidden || readOnly} />
      <EditorMobileActions isSaving={props.mobile.isSaving} readOnly={props.mobile.readOnly} onClear={props.mobile.onClear} onExport={props.mobile.onExport} onSave={props.mobile.onSave} />
      <div className={cn("grid grid-rows-[minmax(0,1fr)] gap-3", expanded ? "h-[calc(100dvh-15rem)] min-h-[18rem]" : "xl:h-[clamp(26rem,calc(100dvh-15rem),60rem)] xl:grid-cols-[minmax(0,1fr)_22rem]")}>
        <div className={cn("min-w-0", expanded ? "h-full" : "h-[62dvh] min-h-[22rem] xl:h-full xl:min-h-0")} ref={areaRef}>
          {status === "loading" ? (
            <div aria-busy="true" aria-label="Carregando a avaliação" className="grid h-full place-items-center rounded-xl bg-primary/[0.06] p-6">
              <div className="w-full max-w-sm space-y-3"><LoadingSkeleton className="h-64 w-full" /><LoadingSkeleton className="mx-auto h-3 w-40" /></div>
            </div>
          ) : status === "error" ? (
            <div className="grid h-full place-items-center rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center">
              <div><p className="text-sm font-semibold text-destructive">Não foi possível carregar esta avaliação.</p><Button className="mt-3" variant="outline" onClick={props.onRetryLoad}><span className="text-sm font-semibold">Tentar novamente</span></Button></div>
            </div>
          ) : activePhoto ? (
            <EditorCanvas
              color={props.color}
              fill
              photo={activePhoto}
              recenterKey={props.recenterKey}
              scale={props.scale}
              selectedId={readOnly ? null : props.selectedId}
              showLabels={props.showLabels}
              showMarks={props.showMarks}
              strokeWidth={props.strokeWidth}
              tool={viewTool}
              onCommitAnnotations={props.onCommitAnnotations}
              onPointCreated={props.onPointCreated}
              onPreviewAnnotations={props.onPreviewAnnotations}
              onSelect={props.onSelect}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-primary/30 bg-primary/[0.04] px-5 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary"><ImagePlus aria-hidden="true" className="h-6 w-6" /></span>
              <h2 className="mt-4 text-base font-semibold text-foreground">Adicione a primeira foto da avaliação</h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">JPG, PNG ou WEBP, até 6 MB cada. A foto original fica preservada e as marcações são salvas separadamente.</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button disabled={readOnly} onClick={props.onAddPhotos}><ImagePlus className="h-4 w-4" /><span className="text-sm font-semibold">Adicionar foto</span></Button>
                <Button disabled={readOnly} variant="outline" onClick={props.onCapture}><Camera className="h-4 w-4" /><span className="text-sm font-semibold">Capturar com a câmera</span></Button>
              </div>
            </div>
          )}
        </div>
        {expanded ? null : <FacialSidePanel {...props.panel} />}
      </div>
      {props.photoUploadError ? <p id="evaluation-photo-upload-error" tabIndex={-1} role="alert" className="scroll-mt-24 text-xs font-medium text-destructive animate-[hp-shake_0.42s_ease-in-out]">{props.photoUploadError}</p> : null}
      {props.saveError ? <p id="evaluation-save-error" tabIndex={-1} role="alert" className="scroll-mt-24 text-xs text-destructive animate-[hp-shake_0.42s_ease-in-out]">{props.saveError}</p> : null}
    </section>
  );
}
