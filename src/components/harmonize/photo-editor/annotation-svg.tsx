"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import type { PhotoAnnotation } from "./types";
import { labelLayout } from "@/lib/annotation-label-rules";
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

/** Legenda da marcação: pílula lavanda com borda roxa clara, ligada à marcação por uma linha fina. Fica numa camada acima das formas. */
export function AnnotationLabel({ annotation, photoWidth, photoHeight, pixelScale, interactive, onGrab }: { annotation: PhotoAnnotation; photoWidth: number; photoHeight: number; pixelScale: number; interactive: boolean; onGrab: GrabHandler }) {
  const layout = labelLayout(annotation, photoWidth, photoHeight, pixelScale);
  if (!layout) return null;
  const { pill, fontSize, anchor, join, text } = layout;
  const guide = annotation.color.toLowerCase() === "#ffffff" ? "#b9a7f5" : annotation.color;
  const grab = interactive ? { onPointerDown: (event: ReactPointerEvent<SVGElement>) => onGrab(event, annotation) } : {};
  return <g data-label-for={annotation.id} {...grab}>
    <line x1={anchor.x} y1={anchor.y} x2={join.x} y2={join.y} stroke={guide} strokeWidth={1.25} strokeLinecap="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />
    <rect x={pill.x} y={pill.y} width={pill.width} height={pill.height} rx={pill.height / 2} fill="#f3efff" stroke="#b9a7f5" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents={interactive ? "all" : "none"} />
    <text x={pill.x + pill.width / 2} y={pill.y + pill.height / 2} fill="#5b21b6" fontSize={fontSize} fontWeight={600} fontFamily="Inter, Arial, sans-serif" textAnchor="middle" dominantBaseline="central" pointerEvents="none" style={{ userSelect: "none" }}>{text}</text>
  </g>;
}

function inkBounds(points: number[]) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (let index = 0; index + 1 < points.length; index += 2) {
    minX = Math.min(minX, points[index]); maxX = Math.max(maxX, points[index]);
    minY = Math.min(minY, points[index + 1]); maxY = Math.max(maxY, points[index + 1]);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** Contorno tracejado e alças de canto da marcação selecionada (alças só para formas de dois cantos). */
export function SelectionOverlay({ annotation, pixelScale, onResize }: { annotation: PhotoAnnotation; pixelScale: number; onResize: (event: ReactPointerEvent<SVGElement>, shape: Shape, handle: Handle) => void }) {
  const shape = shapeFromAnnotation(annotation);
  let box: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  if (shape) box = bounds(shape);
  else if (isInkAnnotation(annotation)) box = inkBounds(annotation.points);
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
