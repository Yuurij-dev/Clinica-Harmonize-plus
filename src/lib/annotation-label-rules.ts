// Geometria da legenda de uma marcação (pílula + linha guia), no espaço da imagem. Usada pelo editor (SVG), pela galeria (SVG) e pela exportação (canvas),
// para as três mostrarem a legenda no mesmo lugar. Só `import type`/funções puras: carregável direto pelo node:test.
import { normalizeAnnotationLabel, type Point } from "./photo-annotation-rules.ts";

/** Forma mínima de uma marcação; a do editor (`PhotoAnnotation`) e a que a galeria lê do JSON salvo cabem aqui. */
export type LabelSource = { type: string; label?: string; points?: number[]; x?: number; y?: number; width?: number; height?: number; text?: string; fontSize?: number };

export type LabelLayout = {
  text: string;
  fontSize: number;
  anchor: Point;
  /** Ponto da borda da pílula onde a linha guia termina. */
  join: Point;
  pill: { x: number; y: number; width: number; height: number };
};

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const charWidthFactor = 0.58;

/** Ponto da marcação ao qual a legenda se liga: o próprio ponto, a ponta da seta, o meio da linha/traço, o topo da forma, o centro do texto. */
export function annotationAnchor(annotation: LabelSource): Point | null {
  const { type } = annotation;
  if (type === "point") return isNumber(annotation.x) && isNumber(annotation.y) ? { x: annotation.x, y: annotation.y } : null;
  if (type === "text") {
    if (!isNumber(annotation.x) || !isNumber(annotation.y) || typeof annotation.text !== "string") return null;
    const fontSize = isNumber(annotation.fontSize) ? annotation.fontSize : 16;
    return { x: annotation.x + (annotation.text.length * fontSize * 0.6) / 2, y: annotation.y };
  }
  if (type === "ellipse" || type === "rectangle" || type === "triangle") {
    if (![annotation.x, annotation.y, annotation.width, annotation.height].every(isNumber)) return null;
    const x = annotation.x as number; const y = annotation.y as number; const w = annotation.width as number; const h = annotation.height as number;
    return { x: x + w / 2, y: Math.min(y, y + h) };
  }
  const points = annotation.points;
  if (!Array.isArray(points) || points.length < 2 || !points.every(isNumber)) return null;
  const count = Math.floor(points.length / 2);
  if (type === "arrow") return { x: points[count * 2 - 2], y: points[count * 2 - 1] };
  if (type === "line") return { x: (points[0] + points[count * 2 - 2]) / 2, y: (points[1] + points[count * 2 - 1]) / 2 };
  if (type === "freehand" || type === "curve") { const middle = Math.floor((count - 1) / 2); return { x: points[middle * 2], y: points[middle * 2 + 1] }; }
  return null;
}

/**
 * Posição da pílula e da linha guia. A pílula fica ao lado da âncora (à direita se a âncora está na metade direita da foto, senão à esquerda),
 * um pouco acima, sempre dentro da foto. `pixelScale` (pixels da imagem por pixel de tela) garante texto legível quando a foto é reduzida.
 */
export function labelLayout(annotation: LabelSource, photoWidth: number, photoHeight: number, pixelScale = 0): LabelLayout | null {
  const text = normalizeAnnotationLabel(annotation.label);
  const anchor = annotationAnchor(annotation);
  if (!text || !anchor || !(photoWidth > 0) || !(photoHeight > 0)) return null;
  const fontSize = Math.max(photoWidth * 0.017, 12 * pixelScale, 10);
  const padX = fontSize * 0.75;
  const width = text.length * fontSize * charWidthFactor + padX * 2;
  const height = fontSize * 1.8;
  const margin = fontSize * 0.5;
  const gap = Math.max(photoWidth * 0.07, fontSize * 3);
  const side = anchor.x >= photoWidth * 0.45 ? 1 : -1;
  const rawX = side === 1 ? anchor.x + gap : anchor.x - gap - width;
  const x = Math.max(margin, Math.min(photoWidth - width - margin, rawX));
  const y = Math.max(margin, Math.min(photoHeight - height - margin, anchor.y - height / 2 - photoHeight * 0.035));
  const midY = y + height / 2;
  let join: Point;
  if (anchor.x < x) join = { x, y: midY };
  else if (anchor.x > x + width) join = { x: x + width, y: midY };
  else join = { x: anchor.x, y: anchor.y < y ? y : y + height };
  return { text, fontSize, anchor, join, pill: { x, y, width, height } };
}
