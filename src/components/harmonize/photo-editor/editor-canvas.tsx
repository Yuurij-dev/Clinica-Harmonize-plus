"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import Atrament from "atrament";
import type { AnnotationSnapshot, EditorTool, EvaluationPhoto, PhotoAnnotation } from "./types";
import { AnnotationLabel, AnnotationNode, SelectionOverlay } from "./annotation-svg";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import {
  annotationFromShape, annotationToReplay, clamp, eraseAnnotations, eraserSize, finishCreate, inkSmoothing, isInkAnnotation, isShapeKind, replaySmoothing,
  resizeShape, sameAnnotationList, shapeFromAnnotation, strokeToAnnotation, translateAnnotation, type Handle, type Point, type Shape,
} from "@/lib/photo-annotation-rules";

// Editor de marcação no estilo do app: traço livre e borracha no canvas do Atrament, formas/ponto/texto em SVG.
// Cada traço é gravado com seus pontos (espaço da imagem) e reproduzido no canvas; a foto original nunca é alterada.

const defaultStrokeWidth = 3;
const doubleTapMs = 350;
const dragSlopPx = 3;
type TextDialog = { mode: "create"; x: number; y: number } | { mode: "edit"; annotationId: string } | null;

type Gesture =
  | { type: "create"; pointerId: number; shape: Shape }
  | { type: "move" | "resize"; pointerId: number; start: Point; original: PhotoAnnotation; handle?: Handle; before: AnnotationSnapshot; changed: boolean; latest: PhotoAnnotation | null };

type EraseGesture = { before: AnnotationSnapshot; working: AnnotationSnapshot; last: Point | null };

export function EditorCanvas({
  photo,
  tool,
  color,
  strokeWidth,
  scale,
  selectedId,
  onSelect,
  onPreviewAnnotations,
  onCommitAnnotations,
  showMarks = true,
  showLabels = true,
  fill = false,
  recenterKey = 0,
  onPointCreated,
}: {
  photo: EvaluationPhoto;
  tool: EditorTool;
  color: string;
  strokeWidth: number;
  scale: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onPreviewAnnotations: (annotations: PhotoAnnotation[]) => void;
  /** Devolve false quando a mudança foi recusada (ex.: limite de marcações por foto). */
  onCommitAnnotations: (annotations: PhotoAnnotation[], previous: AnnotationSnapshot) => boolean | void;
  /** Só visualização: esconde (sem apagar) as marcações / as legendas. */
  showMarks?: boolean;
  showLabels?: boolean;
  /** Ocupa toda a área do contêiner (avaliação facial): fundo lavanda, foto centralizada e com folga para arrastar com a ferramenta Mover. */
  fill?: boolean;
  /** Muda para recentralizar a foto na área (ex.: "ajustar à tela"). */
  recenterKey?: number;
  /** Chamado depois de criar um ponto, para o painel pedir a legenda dele. */
  onPointCreated?: (id: string) => void;
}) {
  const width = Math.max(1, Math.round(photo.width * scale));
  const height = Math.max(1, Math.round(photo.height * scale));
  const pixelScale = photo.width / width; // pixels da imagem por pixel de tela
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const eraserDotRef = useRef<HTMLDivElement>(null);
  const eraserTimerRef = useRef<number | null>(null);
  const penRef = useRef<Atrament | null>(null);
  const canvasInkRef = useRef<readonly PhotoAnnotation[] | null>(null); // traços hoje desenhados no canvas
  const replayingRef = useRef(false);
  const gestureRef = useRef<Gesture | null>(null);
  const eraseRef = useRef<EraseGesture | null>(null);
  const lastTapRef = useRef<{ id: string; at: number } | null>(null);
  const [override, setOverride] = useState<PhotoAnnotation | null>(null);
  const [replayTick, setReplayTick] = useState(0);
  const [textDialog, setTextDialog] = useState<TextDialog>(null);
  const [textDraft, setTextDraft] = useState("");
  const annotations = photo.annotations;
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const panRef = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);

  useEffect(() => {
    const element = areaRef.current;
    if (!element || !fill) return;
    const update = () => setArea({ w: element.clientWidth, h: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fill]);
  // A folga em volta da foto permite arrastá-la; a rolagem volta ao centro quando a foto, o zoom ou a área mudam.
  const padX = fill ? Math.round(area.w * 0.35) : 0;
  const padY = fill ? Math.round(area.h * 0.35) : 0;

  // Ferramenta Mover: arrastar com mouse/caneta rola a área (o toque usa a rolagem nativa, que a classe touch-pan libera).
  function panDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (tool !== "pan" || event.pointerType === "touch" || event.button !== 0) return;
    const element = event.currentTarget;
    panRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
    try { element.setPointerCapture(event.pointerId); } catch { /* sem captura */ }
  }
  function panMove(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.id !== event.pointerId) return;
    event.currentTarget.scrollLeft = pan.left - (event.clientX - pan.x);
    event.currentTarget.scrollTop = pan.top - (event.clientY - pan.y);
  }
  function panEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (panRef.current?.id !== event.pointerId) return;
    panRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* sem captura */ }
  }

  // Valores atuais para os ouvintes do Atrament e dos ponteiros (registrados uma vez por tamanho de canvas).
  const latest = useRef({ photo, tool, color, strokeWidth, width, height, pixelScale, annotations, onSelect, onPreviewAnnotations, commit: onCommitAnnotations });
  // Confirma a mudança; se for recusada, desfaz a prévia (formas já apagadas) e reproduz o canvas para voltar ao estado salvo.
  const commit = useCallback((next: PhotoAnnotation[], before: AnnotationSnapshot) => {
    const accepted = onCommitAnnotations(next, before);
    if (accepted === false) {
      if (latest.current.annotations !== before) onPreviewAnnotations(before);
      canvasInkRef.current = null;
      setReplayTick((tick) => tick + 1);
    }
    return accepted;
  }, [onCommitAnnotations, onPreviewAnnotations]);
  useEffect(() => {
    latest.current = { photo, tool, color, strokeWidth, width, height, pixelScale, annotations, onSelect, onPreviewAnnotations, commit };
  });

  // O canvas do Atrament só é recriado quando o tamanho se firma e não há ponteiro pressionado (zoom/redimensionamento no meio do traço).
  const [penSize, setPenSize] = useState({ w: width, h: height });
  const pointerDownRef = useRef(false);
  useLayoutEffect(() => {
    const element = areaRef.current;
    if (!element || !fill) return;
    element.scrollLeft = Math.max(0, (element.scrollWidth - element.clientWidth) / 2);
    element.scrollTop = Math.max(0, (element.scrollHeight - element.clientHeight) / 2);
    // penSize entra porque o canvas do Atrament demora a acompanhar o zoom e, enquanto isso, alarga a área rolável.
  }, [fill, width, height, penSize.w, penSize.h, photo.id, area.w, area.h, recenterKey]);
  useEffect(() => {
    if (penSize.w === width && penSize.h === height) return;
    let timer = 0;
    const apply = () => {
      if (pointerDownRef.current) { timer = window.setTimeout(apply, 150); return; }
      setPenSize({ w: width, h: height });
    };
    timer = window.setTimeout(apply, 120);
    return () => window.clearTimeout(timer);
  }, [width, height, penSize]);

  const inkList = useMemo(() => annotations.filter(isInkAnnotation), [annotations]);
  const inking = tool === "pen" || tool === "eraser";

  const applyPenOptions = useCallback(() => {
    const pen = penRef.current;
    if (!pen) return;
    const current = latest.current;
    pen.mode = current.tool === "pen" ? "draw" : current.tool === "eraser" ? "erase" : "disabled";
    pen.color = current.color;
    pen.weight = current.tool === "eraser" ? eraserSize(current.strokeWidth) : current.strokeWidth;
    pen.smoothing = inkSmoothing;
    pen.adaptiveStroke = false;
  }, []);

  function pointOnPhoto(event: { clientX: number; clientY: number }): Point {
    const rect = (svgRef.current ?? stageRef.current)!.getBoundingClientRect();
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * photo.width, 0, photo.width),
      y: clamp(((event.clientY - rect.top) / rect.height) * photo.height, 0, photo.height),
    };
  }

  /* ---------- Atrament: traço livre e borracha ---------- */

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;
    const canvas: HTMLCanvasElement = canvasElement;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const pen = new Atrament(canvas, { width: Math.round(penSize.w * ratio), height: Math.round(penSize.h * ratio) });
    pen.recordStrokes = true;
    pen.pressureLow = 0.3;
    pen.pressureHigh = 1.7;
    penRef.current = pen;
    canvasInkRef.current = null;
    const recordedWidth = penSize.w;
    const recordedHeight = penSize.h;

    function toImage(point: Point): Point {
      const current = latest.current;
      return { x: clamp((point.x * current.photo.width) / recordedWidth, 0, current.photo.width), y: clamp((point.y * current.photo.height) / recordedHeight, 0, current.photo.height) };
    }

    pen.addEventListener("strokerecorded", ({ stroke }) => {
      if (replayingRef.current || !stroke.segments.length) return;
      const current = latest.current;
      if (stroke.mode === "draw") {
        const annotation = strokeToAnnotation({
          id: `annotation-${crypto.randomUUID()}`, segments: stroke.segments, recordedWidth, recordedHeight,
          photoWidth: current.photo.width, photoHeight: current.photo.height, color: stroke.color, weight: stroke.weight,
        });
        if (!annotation) return;
        // O canvas já mostra este traço: marca-o como desenhado para não reproduzir tudo de novo.
        canvasInkRef.current = [...current.annotations.filter(isInkAnnotation), annotation];
        current.commit([...current.annotations, annotation], current.annotations);
        return;
      }
      if (stroke.mode !== "erase") return;
      const erasing = eraseRef.current;
      eraseRef.current = null;
      const before = erasing?.before ?? current.annotations;
      const base = erasing?.working ?? current.annotations;
      const path = stroke.segments.map((segment) => toImage(segment.point));
      const next = eraseAnnotations(base, path, (stroke.weight / 2) * current.pixelScale, current.pixelScale, { others: false });
      // O canvas apagou pixels; o vetor é a verdade: reproduz para os dois ficarem iguais.
      canvasInkRef.current = null;
      setReplayTick((tick) => tick + 1);
      if (next !== before) current.commit(next, before);
    });

    function showEraser(event: PointerEvent) {
      const dot = eraserDotRef.current;
      const stage = stageRef.current;
      if (!dot || !stage || latest.current.tool !== "eraser") return;
      const rect = stage.getBoundingClientRect();
      const size = eraserSize(latest.current.strokeWidth);
      dot.style.width = `${size}px`;
      dot.style.height = `${size}px`;
      dot.style.left = `${event.clientX - rect.left - size / 2}px`;
      dot.style.top = `${event.clientY - rect.top - size / 2}px`;
      dot.style.opacity = "1";
      if (eraserTimerRef.current) window.clearTimeout(eraserTimerRef.current);
    }

    // A borracha também apaga formas, pontos e textos inteiros (o Atrament só enxerga pixels do canvas).
    function eraseOthersAt(event: PointerEvent) {
      const erasing = eraseRef.current;
      const current = latest.current;
      if (!erasing) return;
      const rect = canvas.getBoundingClientRect();
      const point: Point = { x: clamp(((event.clientX - rect.left) / rect.width) * current.photo.width, 0, current.photo.width), y: clamp(((event.clientY - rect.top) / rect.height) * current.photo.height, 0, current.photo.height) };
      const path = erasing.last ? [erasing.last, point] : [point];
      erasing.last = point;
      const next = eraseAnnotations(erasing.working, path, (eraserSize(current.strokeWidth) / 2) * current.pixelScale, current.pixelScale, { ink: false });
      if (next === erasing.working) return;
      erasing.working = next;
      current.onPreviewAnnotations(next);
      current.onSelect(null);
    }

    function onDown(event: PointerEvent) {
      if (event.isPrimary) pointerDownRef.current = true;
      if (!event.isPrimary || latest.current.tool !== "eraser") return;
      eraseRef.current = { before: latest.current.annotations, working: latest.current.annotations, last: null };
      showEraser(event);
      eraseOthersAt(event);
    }
    function onMove(event: PointerEvent) {
      if (!eraseRef.current) return;
      showEraser(event);
      eraseOthersAt(event);
    }
    function onUp(event: PointerEvent) { if (event.isPrimary) pointerDownRef.current = false; }
    function onEnd() {
      if (eraserTimerRef.current) window.clearTimeout(eraserTimerRef.current);
      eraserTimerRef.current = window.setTimeout(() => { if (eraserDotRef.current) eraserDotRef.current.style.opacity = "0"; }, 450);
    }
    function onContextMenu(event: Event) { event.preventDefault(); }
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onEnd);
    canvas.addEventListener("pointercancel", onEnd);
    canvas.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    applyPenOptions();

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onEnd);
      canvas.removeEventListener("pointercancel", onEnd);
      canvas.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      pointerDownRef.current = false;
      if (eraserTimerRef.current) window.clearTimeout(eraserTimerRef.current);
      pen.destroy();
      if (penRef.current === pen) penRef.current = null;
    };
  }, [penSize, applyPenOptions]);

  useEffect(() => { applyPenOptions(); }, [tool, color, strokeWidth, penSize, applyPenOptions]);

  // Reproduz os traços no canvas só quando a lista de traços mudou (desfazer, refazer, limpar, borracha, outra foto, zoom).
  useEffect(() => {
    const pen = penRef.current;
    if (!pen || sameAnnotationList(canvasInkRef.current, inkList)) return;
    replayingRef.current = true;
    try {
      pen.clear();
      pen.mode = "draw";
      for (const stroke of inkList) {
        const points = annotationToReplay(stroke, penSize.w, penSize.h, photo.width, photo.height);
        if (!points.length) continue;
        if (points.length === 1) points.push(points[0]);
        pen.color = stroke.color;
        pen.weight = stroke.strokeWidth;
        pen.smoothing = replaySmoothing;
        pen.adaptiveStroke = false;
        let previous: Point = points[0];
        pen.beginStroke(previous.x, previous.y);
        for (let index = 1; index < points.length; index++) previous = pen.draw(points[index].x, points[index].y, previous.x, previous.y, points[index].pressure);
        pen.endStroke(previous.x, previous.y);
      }
    } finally {
      replayingRef.current = false;
      applyPenOptions();
    }
    canvasInkRef.current = inkList;
  }, [inkList, penSize, photo.width, photo.height, replayTick, applyPenOptions]);

  /* ---------- teclado ---------- */

  useEffect(() => {
    function removeSelected(event: KeyboardEvent) {
      if (!showMarks || !selectedId || (event.key !== "Delete" && event.key !== "Backspace")) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, a[href], [role='switch'], [role='menuitem'], [role='radio'], [role='tab'], [role='dialog'], [contenteditable='true']")) return;
      // Backspace/Delete só apagam a marcação com o foco na própria área da foto (ou solto no corpo da página), nunca em botões e controles de fora.
      if (target && target !== document.body && target !== document.documentElement && !areaRef.current?.contains(target)) return;
      if (commit(annotations.filter((annotation) => annotation.id !== selectedId), annotations) !== false) onSelect(null);
    }

    window.addEventListener("keydown", removeSelected);
    return () => window.removeEventListener("keydown", removeSelected);
  }, [commit, onSelect, annotations, selectedId, showMarks]);

  /* ---------- gestos nas formas (SVG) ---------- */

  function capture(pointerId: number) {
    try { svgRef.current?.setPointerCapture(pointerId); } catch { /* sem captura */ }
  }

  const editable = tool === "select" || isShapeKind(tool);

  function grab(event: ReactPointerEvent<SVGElement>, annotation: PhotoAnnotation) {
    if (!editable || gestureRef.current || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(annotation.id);
    gestureRef.current = { type: "move", pointerId: event.pointerId, start: pointOnPhoto(event), original: annotation, before: annotations, changed: false, latest: null };
    capture(event.pointerId);
  }

  function beginResize(event: ReactPointerEvent<SVGElement>, shape: Shape, handle: Handle) {
    if (!editable || gestureRef.current || !event.isPrimary) return;
    const original = annotations.find((annotation) => annotation.id === shape.id);
    if (!original) return;
    event.preventDefault();
    event.stopPropagation();
    gestureRef.current = { type: "resize", pointerId: event.pointerId, start: pointOnPhoto(event), original, handle, before: annotations, changed: false, latest: null };
    capture(event.pointerId);
  }

  function onSvgPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (gestureRef.current || !event.isPrimary) return;
    // Toque fora da forma selecionada só a desmarca; a ferramenta continua a mesma.
    if (tool === "select" || selectedId) {
      if (selectedId) onSelect(null);
      return;
    }
    const point = pointOnPhoto(event);
    if (isShapeKind(tool)) {
      event.preventDefault();
      gestureRef.current = { type: "create", pointerId: event.pointerId, shape: { id: `annotation-${crypto.randomUUID()}`, kind: tool, x1: point.x, y1: point.y, x2: point.x, y2: point.y, color, weight: strokeWidth } };
      capture(event.pointerId);
      setOverride(annotationFromShape({ id: "draft", kind: tool, x1: point.x, y1: point.y, x2: point.x, y2: point.y, color, weight: strokeWidth }));
      return;
    }
    if (tool === "point") {
      const id = `annotation-${crypto.randomUUID()}`;
      if (commit([...annotations, { id, type: "point", x: point.x, y: point.y, radius: 7 * pixelScale, color, strokeWidth }], annotations) !== false) { onSelect(id); onPointCreated?.(id); }
      return;
    }
    if (tool === "text") {
      setTextDraft("Observação");
      setTextDialog({ mode: "create", x: point.x, y: point.y });
    }
  }

  function onSvgPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    const end = pointOnPhoto(event);
    if (gesture.type === "create") {
      setOverride(annotationFromShape({ ...gesture.shape, id: "draft", x2: end.x, y2: end.y }));
      return;
    }
    const dx = end.x - gesture.start.x;
    const dy = end.y - gesture.start.y;
    if (!gesture.changed && Math.hypot(dx, dy) < dragSlopPx * pixelScale) return;
    gesture.changed = true;
    let result: PhotoAnnotation;
    if (gesture.type === "move") {
      result = translateAnnotation(gesture.original, dx, dy, photo.width, photo.height);
    } else {
      const shape = shapeFromAnnotation(gesture.original);
      result = shape && gesture.handle ? annotationFromShape(resizeShape(shape, gesture.handle, dx, dy, photo.width, photo.height)) : gesture.original;
    }
    gesture.latest = result;
    setOverride(result);
  }

  function endGesture(event: ReactPointerEvent<SVGSVGElement>, cancelled: boolean) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    gestureRef.current = null;
    try { svgRef.current?.releasePointerCapture(event.pointerId); } catch { /* sem captura */ }
    setOverride(null);
    if (cancelled) return;
    if (gesture.type === "create") {
      const created = { ...annotationFromShape(finishCreate(gesture.shape, pointOnPhoto(event), photo.width, photo.height)), id: gesture.shape.id };
      if (commit([...annotations, created], annotations) !== false) onSelect(created.id);
      return;
    }
    if (gesture.changed && gesture.latest) {
      const moved = gesture.latest;
      commit(annotations.map((annotation) => annotation.id === moved.id ? moved : annotation), gesture.before);
      return;
    }
    // Toque duplo (ou clique duplo) num texto abre a edição.
    if (gesture.original.type === "text") {
      const now = Date.now();
      const previous = lastTapRef.current;
      if (previous && previous.id === gesture.original.id && now - previous.at < doubleTapMs) {
        lastTapRef.current = null;
        setTextDraft(gesture.original.text);
        setTextDialog({ mode: "edit", annotationId: gesture.original.id });
      } else {
        lastTapRef.current = { id: gesture.original.id, at: now };
      }
    }
  }

  function confirmText() {
    const text = textDraft.trim();
    if (!text || !textDialog) return;

    if (textDialog.mode === "create") {
      commit([
        ...annotations,
        { id: `annotation-${crypto.randomUUID()}`, type: "text", x: textDialog.x, y: textDialog.y, text, color, fontSize: 24, strokeWidth: defaultStrokeWidth },
      ], annotations);
    } else {
      const annotation = annotations.find((item) => item.id === textDialog.annotationId);
      if (annotation?.type === "text") commit(annotations.map((item) => item.id === annotation.id ? { ...annotation, text } : item), annotations);
    }
    setTextDialog(null);
    setTextDraft("");
  }

  const shown = override
    ? annotations.some((annotation) => annotation.id === override.id) ? annotations.map((annotation) => annotation.id === override.id ? override : annotation) : [...annotations, override]
    : annotations;
  const selected = selectedId ? shown.find((annotation) => annotation.id === selectedId) : undefined;
  const touchClass = (tool === "select" && !selectedId) || tool === "pan" ? "touch-pan-x touch-pan-y touch-pinch-zoom" : "touch-none";
  const hidden = !showMarks ? ({ visibility: "hidden" } as const) : undefined;

  return (
    <div
      ref={areaRef}
      className={cn("overflow-auto", fill ? "h-full w-full rounded-xl bg-primary/[0.06] [overflow-anchor:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "flex min-h-[360px] rounded-[8px] border border-[#dfe2ee] bg-[#f8f9fc] p-4", tool === "pan" && "cursor-grab touch-pan-x touch-pan-y touch-pinch-zoom active:cursor-grabbing")}
      onPointerCancel={panEnd}
      onPointerDown={panDown}
      onPointerMove={panMove}
      onPointerUp={panEnd}
    >
      <div className={fill ? "grid min-h-full w-max min-w-full place-items-center" : "contents"} style={fill ? { padding: `${padY}px ${padX}px` } : undefined}>
      <div ref={stageRef} className={cn("relative m-auto shrink-0 select-none bg-white shadow-[0_4px_22px_rgba(81,71,220,0.22)]", touchClass)} style={{ width, height }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- foto da avaliação em data URL/rota autenticada; o otimizador do next/image não serve aqui */}
        <img alt={`Foto ${photo.category}`} className="pointer-events-none absolute inset-0 block h-full w-full select-none" draggable={false} src={photo.imageUrl} />
        <canvas key={`${penSize.w}x${penSize.h}`} ref={canvasRef} aria-hidden="true" className="absolute inset-0" style={{ width: penSize.w, height: penSize.h, pointerEvents: inking && showMarks ? "auto" : "none", ...hidden }} />
        <svg
          ref={svgRef}
          aria-label="Marcações sobre a foto"
          className="absolute inset-0 h-full w-full touch-none overflow-visible"
          preserveAspectRatio="none"
          role="img"
          style={{ pointerEvents: !showMarks || tool === "pan" || inking || (tool === "select" && !selectedId) ? "none" : "auto", ...hidden }}
          viewBox={`0 0 ${photo.width} ${photo.height}`}
          onPointerCancel={(event) => endGesture(event, true)}
          onPointerDown={onSvgPointerDown}
          onPointerMove={onSvgPointerMove}
          onPointerUp={(event) => endGesture(event, false)}
        >
          {shown.map((annotation) => (
            <AnnotationNode annotation={annotation} interactive={tool === "select" || (editable && annotation.id === selectedId)} key={annotation.id} onGrab={grab} pixelScale={pixelScale} />
          ))}
          {showLabels ? shown.map((annotation) => (
            <AnnotationLabel annotation={annotation} interactive={tool === "select" || (editable && annotation.id === selectedId)} key={`label-${annotation.id}`} onGrab={grab} photoHeight={photo.height} photoWidth={photo.width} pixelScale={pixelScale} />
          )) : null}
          {selected && editable ? <SelectionOverlay annotation={selected} onResize={beginResize} pixelScale={pixelScale} /> : null}
        </svg>
        <div ref={eraserDotRef} aria-hidden="true" className="pointer-events-none absolute z-[5] box-border rounded-full border-[2.5px] border-[#5147dc] bg-white/55 opacity-0 shadow-[0_0_0_1.5px_rgba(255,255,255,0.9),0_2px_8px_rgba(0,0,0,0.35)] transition-opacity duration-200" />
      </div>
      </div>
      <Modal
        open={Boolean(textDialog)}
        onClose={() => setTextDialog(null)}
        title={textDialog?.mode === "edit" ? "Editar texto" : "Adicionar texto"}
        description="Digite o texto que será exibido sobre a foto."
      >
        <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); confirmText(); }}>
          <label className="text-xs font-bold text-[#555668]">
            Texto da marcação
            <input
              autoFocus
              className="mt-2 h-10 w-full rounded-[7px] border border-[#dddfea] bg-white px-3 text-sm text-[#303144] outline-none transition focus:border-[#5147dc] focus:ring-2 focus:ring-[#5147dc]/10"
              value={textDraft}
              onChange={(event) => setTextDraft(event.target.value)}
              maxLength={120}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setTextDialog(null)}>Cancelar</Button>
            <Button disabled={!textDraft.trim()} type="submit">{textDialog?.mode === "edit" ? "Salvar texto" : "Adicionar texto"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
