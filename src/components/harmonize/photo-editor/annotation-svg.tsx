"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import type { PhotoAnnotation } from "./types";
import { arrowHead, arrowHeadLength, bounds, handlePoint, isInkAnnotation, shapeFromAnnotation, textBounds, trianglePoints, type Handle, type Shape } from "@/lib/photo-annotation-rules";

// Camada SVG das marcações (formas, ponto e texto), no espaço da imagem (viewBox = tamanho da foto).
// O traço livre fica no canvas do Atrament, não aqui. Espessuras em pixels de tela (non-scaling-stroke).

type Paint = {
  stroke: string; strokeWidth: number; fill: string; vectorEffect: "non-scaling-stroke"; pointerEvents: "none" | "stroke" | "all";
  strokeLinecap?: "round"; strokeLinejoin?: "round";
};

const selectionColor = "#5147dc";
const handles: Handle[] = ["nw", "ne", "se", "sw"];

function geometry(shape: Shape, paint: Paint) {
  const b = bounds(shape);
  if (shape.kind === "line" || shape.kind === "arrow") return <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} {...paint} />;
  if (shape.kind === "rectangle") return <rect x={b.minX} y={b.minY} width={b.maxX - b.minX} height={b.maxY - b.minY} {...paint} />;
  if (shape.kind === "ellipse") return <ellipse cx={(b.minX + b.maxX) / 2} cy={(b.minY + b.maxY) / 2} rx={(b.maxX - b.minX) / 2} ry={(b.maxY - b.minY) / 2} {...paint} />;
  return <polygon points={trianglePoints(shape).map((p) => `${p.x},${p.y}`).join(" ")} {...paint} />;
}

export type GrabHandler = (event: ReactPointerEvent<SVGElement>, annotation: PhotoAnnotation) => void;

export function AnnotationNode({ annotation, pixelScale, interactive, onGrab }: { annotation: PhotoAnnotation; pixelScale: number; interactive: boolean; onGrab: GrabHandler }) {
  if (isInkAnnotation(annotation)) return null;
  const grab = interactive ? { onPointerDown: (event: ReactPointerEvent<SVGElement>) => onGrab(event, annotation) } : {};
  const shape = shapeFromAnnotation(annotation);

  if (shape) {
    const visible: Paint = { stroke: shape.color, strokeWidth: shape.weight, fill: "none", vectorEffect: "non-scaling-stroke", pointerEvents: "none", strokeLinecap: "round", strokeLinejoin: "round" };
    const open = shape.kind === "line" || shape.kind === "arrow";
    const hit: Paint = { stroke: "transparent", strokeWidth: 30, fill: open ? "none" : "transparent", vectorEffect: "non-scaling-stroke", pointerEvents: open ? "stroke" : "all" };
    const head = shape.kind === "arrow" ? arrowHead(shape, arrowHeadLength(shape.weight, pixelScale)) : null;
    return <g data-annotation-id={annotation.id} {...grab}>
      {geometry(shape, visible)}
      {head ? <polygon points={head.map((p) => `${p.x},${p.y}`).join(" ")} fill={shape.color} pointerEvents="none" /> : null}
      {interactive ? geometry(shape, hit) : null}
    </g>;
  }

  if (annotation.type === "point") {
    const hitRadius = Math.max(annotation.radius, 22 * pixelScale);
    return <g data-annotation-id={annotation.id} {...grab}>
      <circle cx={annotation.x} cy={annotation.y} r={annotation.radius} fill={annotation.color} stroke="#ffffff" strokeWidth={Math.max(1, annotation.strokeWidth)} vectorEffect="non-scaling-stroke" pointerEvents="none" />
      {interactive ? <circle cx={annotation.x} cy={annotation.y} r={hitRadius} fill="transparent" pointerEvents="all" /> : null}
    </g>;
  }

  if (annotation.type === "text") {
    const box = textBounds(annotation);
    return <g data-annotation-id={annotation.id} {...grab}>
      <text x={annotation.x} y={annotation.y} fill={annotation.color} fontSize={annotation.fontSize} fontFamily="Inter, Arial, sans-serif" dominantBaseline="hanging" pointerEvents="none" style={{ userSelect: "none" }}>{annotation.text}</text>
      {interactive ? <rect x={box.minX} y={box.minY} width={box.maxX - box.minX} height={box.maxY - box.minY} fill="transparent" pointerEvents="all" /> : null}
    </g>;
  }

  return null;
}

/** Contorno tracejado e alças de canto da marcação selecionada (alças só para formas de dois cantos). */
export function SelectionOverlay({ annotation, pixelScale, onResize }: { annotation: PhotoAnnotation; pixelScale: number; onResize: (event: ReactPointerEvent<SVGElement>, shape: Shape, handle: Handle) => void }) {
  const shape = shapeFromAnnotation(annotation);
  let box: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  if (shape) box = bounds(shape);
  else if (annotation.type === "point") box = { minX: annotation.x - annotation.radius, minY: annotation.y - annotation.radius, maxX: annotation.x + annotation.radius, maxY: annotation.y + annotation.radius };
  else if (annotation.type === "text") box = textBounds(annotation);
  if (!box) return null;
  const used = shape ? (shape.kind === "line" || shape.kind === "arrow" ? (["nw", "se"] as Handle[]) : handles) : [];
  return <g>
    <rect x={box.minX} y={box.minY} width={box.maxX - box.minX} height={box.maxY - box.minY} fill="none" stroke={selectionColor} strokeDasharray="7 5" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
    {shape ? used.map((handle) => {
      const p = handlePoint(shape, handle);
      return <g key={handle} onPointerDown={(event) => onResize(event, shape, handle)}>
        <circle cx={p.x} cy={p.y} r={10 * pixelScale} fill="#ffffff" stroke={selectionColor} strokeWidth={2.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
        <circle cx={p.x} cy={p.y} r={22 * pixelScale} fill="transparent" pointerEvents="all" />
      </g>;
    }) : null}
  </g>;
}
