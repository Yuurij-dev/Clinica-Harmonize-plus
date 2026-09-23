"use client";

import { useEffect, useRef, useState } from "react";
import Konva from "konva";
import {
  Arrow,
  Ellipse,
  Image as KonvaImage,
  Layer,
  Line,
  Stage,
  Text,
  Transformer,
} from "react-konva";
import type {
  AnnotationSnapshot,
  EditorTool,
  EvaluationPhoto,
  PhotoAnnotation,
} from "./types";

const defaultStrokeWidth = 3;

export function EditorCanvas({
  photo,
  tool,
  color,
  scale,
  selectedId,
  onSelect,
  onPreviewAnnotations,
  onCommitAnnotations,
}: {
  photo: EvaluationPhoto;
  tool: EditorTool;
  color: string;
  scale: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onPreviewAnnotations: (annotations: PhotoAnnotation[]) => void;
  onCommitAnnotations: (annotations: PhotoAnnotation[], previous: AnnotationSnapshot) => void;
}) {
  const image = useLoadedImage(photo.imageUrl);
  const transformerRef = useRef<Konva.Transformer>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const previousSnapshotRef = useRef<AnnotationSnapshot | null>(null);
  const drawingIdRef = useRef<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const width = Math.max(1, Math.round(photo.width * scale));
  const height = Math.max(1, Math.round(photo.height * scale));

  useEffect(() => {
    if (!selectedId) {
      transformerRef.current?.nodes([]);
      return;
    }

    const selectedNode = stageRef.current?.findOne(`#annotation-${selectedId}`);
    if (selectedNode) {
      transformerRef.current?.nodes([selectedNode]);
      transformerRef.current?.getLayer()?.batchDraw();
    }
  }, [selectedId, photo.annotations, scale]);

  useEffect(() => {
    function removeSelected(event: KeyboardEvent) {
      if (!selectedId || (event.key !== "Delete" && event.key !== "Backspace")) return;
      const next = photo.annotations.filter((annotation) => annotation.id !== selectedId);
      onCommitAnnotations(next, photo.annotations);
      onSelect(null);
    }

    window.addEventListener("keydown", removeSelected);
    return () => window.removeEventListener("keydown", removeSelected);
  }, [onCommitAnnotations, onSelect, photo.annotations, selectedId]);

  function pointerInImage() {
    const point = stageRef.current?.getPointerPosition();
    if (!point) return null;

    return {
      x: clamp(point.x / scale, 0, photo.width),
      y: clamp(point.y / scale, 0, photo.height),
    };
  }

  function startDrawing() {
    const point = pointerInImage();
    if (!point) return;

    if (tool === "select") {
      onSelect(null);
      return;
    }

    if (tool === "text") {
      const text = window.prompt("Texto da marcação", "Observação");
      if (!text) return;
      const next: PhotoAnnotation[] = [
        ...photo.annotations,
        {
          id: createAnnotationId(),
          type: "text",
          x: point.x,
          y: point.y,
          text,
          color,
          fontSize: 24,
          strokeWidth: defaultStrokeWidth,
        },
      ];
      onCommitAnnotations(next, photo.annotations);
      return;
    }

    if (tool === "eraser") return;

    previousSnapshotRef.current = photo.annotations;
    const id = createAnnotationId();
    drawingIdRef.current = id;
    setIsDrawing(true);

    const nextAnnotation: PhotoAnnotation = tool === "ellipse"
      ? {
          id,
          type: "ellipse",
          x: point.x,
          y: point.y,
          width: 1,
          height: 1,
          color,
          strokeWidth: defaultStrokeWidth,
        }
      : {
          id,
          type: tool === "pen" ? "freehand" : tool,
          points: [point.x, point.y, point.x, point.y],
          color,
          strokeWidth: defaultStrokeWidth,
        };

    onPreviewAnnotations([...photo.annotations, nextAnnotation]);
  }

  function continueDrawing() {
    if (!isDrawing || !drawingIdRef.current) return;
    const point = pointerInImage();
    if (!point) return;

    onPreviewAnnotations(photo.annotations.map((annotation) => {
      if (annotation.id !== drawingIdRef.current) return annotation;

      if (annotation.type === "ellipse") {
        return {
          ...annotation,
          width: point.x - annotation.x,
          height: point.y - annotation.y,
        };
      }

      if (annotation.type === "freehand") {
        return {
          ...annotation,
          points: [...annotation.points, point.x, point.y],
        };
      }

      if (annotation.type !== "line" && annotation.type !== "arrow") return annotation;

      return {
        ...annotation,
        points: [annotation.points[0], annotation.points[1], point.x, point.y],
      };
    }));
  }

  function finishDrawing() {
    if (!isDrawing || !previousSnapshotRef.current) return;

    setIsDrawing(false);
    drawingIdRef.current = null;
    onCommitAnnotations(photo.annotations, previousSnapshotRef.current);
    previousSnapshotRef.current = null;
  }

  function eraseAnnotation(id: string) {
    const next = photo.annotations.filter((annotation) => annotation.id !== id);
    onCommitAnnotations(next, photo.annotations);
    onSelect(null);
  }

  function updateAnnotation(id: string, nextAnnotation: PhotoAnnotation, previous: AnnotationSnapshot) {
    onCommitAnnotations(photo.annotations.map((annotation) => annotation.id === id ? nextAnnotation : annotation), previous);
  }

  return (
    <div className="flex min-h-[360px] items-center justify-center overflow-auto rounded-[8px] border border-[#12315d] bg-[#101724] p-4">
      <Stage
        className="shrink-0"
        height={height}
        ref={stageRef}
        width={width}
        onMouseDown={(event) => {
          if (event.target !== event.target.getStage()) return;
          startDrawing();
        }}
        onMouseMove={continueDrawing}
        onMouseUp={finishDrawing}
        onTouchStart={(event) => {
          if (event.target !== event.target.getStage()) return;
          startDrawing();
        }}
        onTouchMove={continueDrawing}
        onTouchEnd={finishDrawing}
      >
        <Layer>
          {image ? (
            <KonvaImage image={image} height={height} listening={false} width={width} x={0} y={0} />
          ) : null}
        </Layer>
        <Layer>
          {photo.annotations.map((annotation) => (
            <AnnotationNode
              annotation={annotation}
              annotationsSnapshot={photo.annotations}
              key={annotation.id}
              scale={scale}
              selected={selectedId === annotation.id}
              tool={tool}
              onEditText={(text) => {
                if (annotation.type !== "text") return;
                updateAnnotation(annotation.id, { ...annotation, text }, photo.annotations);
              }}
              onErase={eraseAnnotation}
              onMove={(nextAnnotation, previous) => updateAnnotation(annotation.id, nextAnnotation, previous)}
              onSelect={onSelect}
            />
          ))}
          <Transformer
            anchorSize={8}
            borderStroke="#6c4cff"
            enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]}
            ignoreStroke
            ref={transformerRef}
            rotateEnabled={false}
          />
        </Layer>
      </Stage>
    </div>
  );
}

function AnnotationNode({
  annotation,
  annotationsSnapshot,
  scale,
  tool,
  selected,
  onSelect,
  onErase,
  onMove,
  onEditText,
}: {
  annotation: PhotoAnnotation;
  annotationsSnapshot: AnnotationSnapshot;
  scale: number;
  tool: EditorTool;
  selected: boolean;
  onSelect: (id: string | null) => void;
  onErase: (id: string) => void;
  onMove: (annotation: PhotoAnnotation, previous: AnnotationSnapshot) => void;
  onEditText: (text: string) => void;
}) {
  const previousSnapshotRef = useRef<AnnotationSnapshot | null>(null);
  const commonProps = {
    id: `annotation-${annotation.id}`,
    draggable: tool === "select",
    opacity: selected ? 0.92 : 1,
    onClick: () => {
      if (tool === "eraser") {
        onErase(annotation.id);
        return;
      }
      if (tool === "select") onSelect(annotation.id);
    },
    onTap: () => {
      if (tool === "eraser") {
        onErase(annotation.id);
        return;
      }
      if (tool === "select") onSelect(annotation.id);
    },
  };

  if (annotation.type === "ellipse") {
    const normalized = normalizeRect(annotation);

    return (
      <Ellipse
        {...commonProps}
        radiusX={(normalized.width * scale) / 2}
        radiusY={(normalized.height * scale) / 2}
        stroke={annotation.color}
        strokeWidth={annotation.strokeWidth}
        x={(normalized.x + normalized.width / 2) * scale}
        y={(normalized.y + normalized.height / 2) * scale}
        onDragStart={() => {
          previousSnapshotRef.current = annotationsSnapshot;
        }}
        onDragEnd={(event) => {
          const next = {
            ...normalized,
            id: annotation.id,
            type: "ellipse" as const,
            x: event.target.x() / scale - normalized.width / 2,
            y: event.target.y() / scale - normalized.height / 2,
          };
          onMove(next, previousSnapshotRef.current ?? annotationsSnapshot);
        }}
        onTransformEnd={(event) => {
          const node = event.target;
          const nextWidth = Math.max(4, normalized.width * node.scaleX());
          const nextHeight = Math.max(4, normalized.height * node.scaleY());
          const next = {
            ...normalized,
            id: annotation.id,
            type: "ellipse" as const,
            x: node.x() / scale - nextWidth / 2,
            y: node.y() / scale - nextHeight / 2,
            width: nextWidth,
            height: nextHeight,
          };
          node.scaleX(1);
          node.scaleY(1);
          onMove(next, annotationsSnapshot);
        }}
      />
    );
  }

  if (annotation.type === "text") {
    return (
      <Text
        {...commonProps}
        fill={annotation.color}
        fontFamily="Inter, Arial, sans-serif"
        fontSize={annotation.fontSize * scale}
        text={annotation.text}
        x={annotation.x * scale}
        y={annotation.y * scale}
        onDblClick={() => {
          const text = window.prompt("Editar texto", annotation.text);
          if (text) onEditText(text);
        }}
        onDblTap={() => {
          const text = window.prompt("Editar texto", annotation.text);
          if (text) onEditText(text);
        }}
        onDragStart={() => {
          previousSnapshotRef.current = annotationsSnapshot;
        }}
        onDragEnd={(event) => {
          onMove({
            ...annotation,
            x: event.target.x() / scale,
            y: event.target.y() / scale,
          }, previousSnapshotRef.current ?? annotationsSnapshot);
        }}
        onTransformEnd={(event) => {
          const node = event.target;
          const nextFontSize = Math.max(10, annotation.fontSize * node.scaleY());
          const next = {
            ...annotation,
            x: node.x() / scale,
            y: node.y() / scale,
            fontSize: nextFontSize,
          };
          node.scaleX(1);
          node.scaleY(1);
          onMove(next, annotationsSnapshot);
        }}
      />
    );
  }

  const Shape = annotation.type === "arrow" ? Arrow : Line;
  const points = annotation.points.map((point) => point * scale);

  return (
    <Shape
      {...commonProps}
      fill={annotation.color}
      lineCap="round"
      lineJoin="round"
      pointerLength={12}
      pointerWidth={12}
      points={points}
      stroke={annotation.color}
      strokeWidth={annotation.strokeWidth}
      tension={annotation.type === "freehand" ? 0.35 : 0}
      onDragStart={() => {
        previousSnapshotRef.current = annotationsSnapshot;
      }}
      onDragEnd={(event) => {
        const dx = event.target.x() / scale;
        const dy = event.target.y() / scale;
        const next = {
          ...annotation,
          points: annotation.points.map((point, index) => point + (index % 2 === 0 ? dx : dy)),
        };
        event.target.x(0);
        event.target.y(0);
        onMove(next, previousSnapshotRef.current ?? annotationsSnapshot);
      }}
      onTransformEnd={(event) => {
        const node = event.target;
        const next = {
          ...annotation,
          points: annotation.points.map((point, index) => {
            const offset = index % 2 === 0 ? node.x() / scale : node.y() / scale;
            const nodeScale = index % 2 === 0 ? node.scaleX() : node.scaleY();
            return point * nodeScale + offset;
          }),
        };
        node.x(0);
        node.y(0);
        node.scaleX(1);
        node.scaleY(1);
        onMove(next, annotationsSnapshot);
      }}
    />
  );
}

function useLoadedImage(src: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const nextImage = new window.Image();
    nextImage.onload = () => setImage(nextImage);
    nextImage.src = src;
    return () => setImage(null);
  }, [src]);

  return image;
}

function createAnnotationId() {
  return `annotation-${crypto.randomUUID()}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeRect(annotation: Extract<PhotoAnnotation, { type: "ellipse" }>) {
  return {
    ...annotation,
    x: annotation.width < 0 ? annotation.x + annotation.width : annotation.x,
    y: annotation.height < 0 ? annotation.y + annotation.height : annotation.y,
    width: Math.abs(annotation.width),
    height: Math.abs(annotation.height),
  };
}
