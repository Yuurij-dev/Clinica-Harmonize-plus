// Regras puras do editor de marcação da foto (traço livre do Atrament + formas em SVG). Só `import type`: carregável direto pelo node:test.
// Todas as marcações são salvas no espaço da imagem (pixels da foto original); o editor converte de/para pixels de tela.
import type { LineAnnotation, PhotoAnnotation } from "../components/harmonize/photo-editor/types";

export const maxHistory = 60;
/** Mesmo limite do PUT da avaliação (annotations.length <= 1000 por foto). */
export const maxAnnotationsPerPhoto = 1000;
/** Legenda de uma marcação (campo opcional `label` dentro do JSON da anotação; sem schema próprio). */
export const maxAnnotationLabelLength = 60;

/** Texto da legenda pronto para gravar: espaços aparados e repetidos reduzidos, cortado no limite; vazio ou não-texto vira `undefined` (sem legenda). */
export function normalizeAnnotationLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim().slice(0, maxAnnotationLabelLength).trim();
  return text || undefined;
}

/** Valor aceito para `label`: ausente (marcações antigas) ou texto de até o limite depois de aparado. */
export function isValidAnnotationLabel(value: unknown) {
  return value === undefined || (typeof value === "string" && value.trim().length <= maxAnnotationLabelLength);
}

/** Alguma marcação do JSON recebido traz `label` inválido (não é texto ou passa do limite)? Marcações antigas, sem o campo, passam. */
export function annotationsHaveInvalidLabel(annotations: readonly unknown[]) {
  return annotations.some((annotation) => Boolean(annotation) && typeof annotation === "object" && "label" in (annotation as object) && !isValidAnnotationLabel((annotation as { label?: unknown }).label));
}

/** Define (ou remove, se vazia) a legenda de uma marcação, sem tocar no resto. */
export function withAnnotationLabel(annotation: PhotoAnnotation, label: unknown): PhotoAnnotation {
  const { label: previous, ...rest } = annotation;
  void previous;
  const next = normalizeAnnotationLabel(label);
  return (next ? { ...rest, label: next } : rest) as PhotoAnnotation;
}

export const annotationLimitMessage = "Esta foto atingiu o limite de 1000 marcações. Apague ou limpe algumas para continuar.";

/** A mudança passaria do limite por foto aumentando a quantidade? (apagar ou editar sempre é permitido) */
export function exceedsAnnotationLimit(next: readonly unknown[], previous: readonly unknown[]) {
  return next.length > maxAnnotationsPerPhoto && next.length > previous.length;
}

/** Id novo para um trecho que sobrou de um traço cortado; sem repetir mesmo depois de cortes sucessivos. */
export function pieceId(strokeId: string) {
  return `${strokeId.replace(/-p[a-z0-9]{6}$/, "")}-p${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`;
}
/** A borracha é mais grossa que o traço (o dedo cobre pouco), como no app. */
export const eraserFactor = 3;
export const minEraserSize = 10;
export const defaultPressure = 0.5;

export type Point = { x: number; y: number };
export type ShapeKind = "line" | "arrow" | "rectangle" | "ellipse" | "triangle";
export const shapeKinds: readonly ShapeKind[] = ["line", "arrow", "rectangle", "ellipse", "triangle"];
/** Forma editável em dois cantos (x1,y1)-(x2,y2). `weight` é a espessura em pixels de tela, como `strokeWidth`. */
export type Shape = { id: string; kind: ShapeKind; x1: number; y1: number; x2: number; y2: number; color: string; weight: number; label?: string };

export function isShapeKind(value: string): value is ShapeKind {
  return (shapeKinds as readonly string[]).includes(value);
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const round2 = (value: number) => Math.round(value * 100) / 100;

export function eraserSize(strokeWidth: number) {
  return Math.max(minEraserSize, strokeWidth * eraserFactor);
}

/** Empilha um snapshot no histórico e descarta os mais antigos acima do limite. */
export function pushHistory<T>(stack: readonly T[], snapshot: T, max = maxHistory): T[] {
  const next = [...stack, snapshot];
  return next.length > max ? next.slice(next.length - max) : next;
}

/* ---------- tipos de marcação ---------- */

/** Traço livre (Atrament): `freehand` e o `curve` das marcações antigas. */
export function isInkAnnotation(annotation: PhotoAnnotation): annotation is LineAnnotation {
  return annotation.type === "freehand" || annotation.type === "curve";
}

export function shapeFromAnnotation(annotation: PhotoAnnotation): Shape | null {
  const base = { id: annotation.id, color: annotation.color, weight: annotation.strokeWidth, ...(annotation.label ? { label: annotation.label } : {}) };
  if (annotation.type === "line" || annotation.type === "arrow") {
    const p = annotation.points;
    if (!Array.isArray(p) || p.length < 4 || !p.every(finite)) return null;
    return { ...base, kind: annotation.type, x1: p[0], y1: p[1], x2: p[p.length - 2], y2: p[p.length - 1] };
  }
  if (annotation.type === "ellipse" || annotation.type === "rectangle" || annotation.type === "triangle") {
    if (![annotation.x, annotation.y, annotation.width, annotation.height].every(finite)) return null;
    return { ...base, kind: annotation.type, x1: annotation.x, y1: annotation.y, x2: annotation.x + annotation.width, y2: annotation.y + annotation.height };
  }
  return null;
}

export function annotationFromShape(shape: Shape): PhotoAnnotation {
  const base = { id: shape.id, color: shape.color, strokeWidth: shape.weight, ...(shape.label ? { label: shape.label } : {}) };
  if (shape.kind === "line" || shape.kind === "arrow") return { ...base, type: shape.kind, points: [shape.x1, shape.y1, shape.x2, shape.y2].map(round2) };
  return { ...base, type: shape.kind, x: round2(shape.x1), y: round2(shape.y1), width: round2(shape.x2 - shape.x1), height: round2(shape.y2 - shape.y1) };
}

/* ---------- geometria das formas (porta de marking-web/shapes.js do app) ---------- */

export function bounds(shape: Shape) {
  return { minX: Math.min(shape.x1, shape.x2), minY: Math.min(shape.y1, shape.y2), maxX: Math.max(shape.x1, shape.x2), maxY: Math.max(shape.y1, shape.y2) };
}

export function segmentDistance(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = dx * dx + dy * dy;
  const t = length ? clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / length, 0, 1) : 0;
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

/** Vértices da ponta da seta (o primeiro é a ponta). */
export function arrowHead(shape: Shape, relativeLength: number): Point[] {
  const dx = shape.x2 - shape.x1;
  const dy = shape.y2 - shape.y1;
  const angle = Math.atan2(dy, dx);
  const length = Math.min(relativeLength, Math.max(7, Math.hypot(dx, dy) * 0.36));
  const half = 0.5;
  return [
    { x: shape.x2, y: shape.y2 },
    { x: shape.x2 - length * Math.cos(angle - half), y: shape.y2 - length * Math.sin(angle - half) },
    { x: shape.x2 - length * Math.cos(angle + half), y: shape.y2 - length * Math.sin(angle + half) },
  ];
}

/** Comprimento da ponta da seta em unidades da imagem; `pixelScale` = pixels da imagem por pixel de tela. */
export function arrowHeadLength(weight: number, pixelScale: number) {
  return Math.max(15 * pixelScale, weight * 4 * pixelScale);
}

export function trianglePoints(shape: Shape): Point[] {
  const b = bounds(shape);
  return [{ x: (b.minX + b.maxX) / 2, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }];
}

export function rectanglePoints(shape: Shape): Point[] {
  return [{ x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y1 }, { x: shape.x2, y: shape.y2 }, { x: shape.x1, y: shape.y2 }];
}

/** O traço da forma está a até `radius` de `point` (borracha ou dedo), além da meia espessura? */
export function hitShape(shape: Shape, point: Point, radius: number, pixelScale = 1) {
  const tolerance = radius + (shape.weight * pixelScale) / 2;
  const near = (a: Point, b: Point) => segmentDistance(point, a, b) <= tolerance;
  if (shape.kind === "line" || shape.kind === "arrow") {
    if (near({ x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 })) return true;
    if (shape.kind === "arrow") {
      const head = arrowHead(shape, arrowHeadLength(shape.weight, pixelScale));
      return near(head[0], head[1]) || near(head[0], head[2]);
    }
    return false;
  }
  if (shape.kind === "ellipse") {
    const b = bounds(shape);
    const rx = (b.maxX - b.minX) / 2;
    const ry = (b.maxY - b.minY) / 2;
    if (!rx || !ry) return near({ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY });
    const nx = (point.x - (b.minX + b.maxX) / 2) / rx;
    const ny = (point.y - (b.minY + b.maxY) / 2) / ry;
    return Math.abs(Math.hypot(nx, ny) - 1) * Math.min(rx, ry) <= tolerance;
  }
  const points = shape.kind === "rectangle" ? rectanglePoints(shape) : trianglePoints(shape);
  return points.some((start, index) => near(start, points[(index + 1) % points.length]));
}

/** Toque sem arrasto cria uma forma de tamanho padrão em vez de uma forma vazia. */
export function finishCreate(shape: Shape, end: Point, photoWidth: number, photoHeight: number): Shape {
  const tap = Math.hypot(end.x - shape.x1, end.y - shape.y1) < photoWidth * 0.012;
  return {
    ...shape,
    x2: tap ? clamp(shape.x1 + photoWidth * 0.16, 0, photoWidth) : end.x,
    y2: tap ? clamp(shape.y1 + photoHeight * 0.11, 0, photoHeight) : end.y,
  };
}

/* ---------- traços do Atrament <-> marcações ---------- */

export type RecordedSegment = { point: Point; pressure?: number };
export type InkPoint = Point & { pressure: number };

/** Suavização do traço ao vivo (a mesma do app) e a usada na reprodução: os pontos gravados já são o caminho suavizado, então não se suaviza de novo. */
export const inkSmoothing = 0.85;
export const replaySmoothing = 0.02;

/** Fator de suavização do Atrament para um passo de `distance` pixels (ver `getSmoothingFactor` da biblioteca). */
export function smoothingFactor(distance: number, smoothing: number) {
  return Math.min(0.87, smoothing + (distance - 60) / 3000);
}

/**
 * Reproduz a suavização do Atrament sobre os pontos crus do ponteiro (pixels de tela) e devolve o caminho que ele realmente desenhou.
 * Guardar esse caminho permite reproduzir o traço com suavização quase nula, igual ao que o usuário viu, e cortá-lo com a borracha sem deformar.
 */
export function smoothPath(points: readonly InkPoint[], smoothing = inkSmoothing): InkPoint[] {
  const out: InkPoint[] = [];
  let previous: Point | null = null;
  for (const p of points) {
    if (!previous) {
      previous = { x: p.x, y: p.y };
    } else {
      const u = smoothingFactor(Math.hypot(p.x - previous.x, p.y - previous.y), smoothing);
      previous = { x: p.x - (p.x - previous.x) * u, y: p.y - (p.y - previous.y) * u };
    }
    out.push({ x: previous.x, y: previous.y, pressure: p.pressure });
  }
  return out;
}

/** Remove pontos a menos de `minDistance` do último mantido (sempre fica com o primeiro e o último) e arredonda. */
export function simplifyStroke(points: InkPoint[], minDistance: number): InkPoint[] {
  if (points.length <= 2) return points.map((p) => ({ x: round2(p.x), y: round2(p.y), pressure: round2(p.pressure) }));
  const kept: InkPoint[] = [points[0]];
  for (let index = 1; index < points.length - 1; index++) {
    const last = kept[kept.length - 1];
    if (Math.hypot(points[index].x - last.x, points[index].y - last.y) >= minDistance) kept.push(points[index]);
  }
  kept.push(points[points.length - 1]);
  return kept.map((p) => ({ x: round2(p.x), y: round2(p.y), pressure: round2(p.pressure) }));
}

function inkToAnnotation(id: string, base: { color: string; strokeWidth: number; label?: string }, points: InkPoint[]): LineAnnotation {
  const flat = points.length === 1 ? [points[0], points[0]] : points;
  const annotation: LineAnnotation = { id, type: "freehand", points: flat.flatMap((p) => [p.x, p.y]), color: base.color, strokeWidth: base.strokeWidth };
  if (base.label) annotation.label = base.label;
  if (flat.some((p) => p.pressure !== defaultPressure)) annotation.pressure = flat.map((p) => p.pressure);
  return annotation;
}

/**
 * Traço gravado pelo Atrament (pixels de tela de um canvas `recordedWidth` x `recordedHeight`) para marcação no espaço da imagem,
 * já com o caminho suavizado que ele desenhou (ver `smoothPath`).
 * Um toque sem arrasto vira um ponto duplicado (a ponta redonda desenha o pingo).
 */
export function strokeToAnnotation(input: {
  id: string; segments: readonly RecordedSegment[]; recordedWidth: number; recordedHeight: number;
  photoWidth: number; photoHeight: number; color: string; weight: number;
}): LineAnnotation | null {
  const { segments, recordedWidth, recordedHeight, photoWidth, photoHeight } = input;
  if (!segments.length || recordedWidth <= 0 || recordedHeight <= 0) return null;
  const sx = photoWidth / recordedWidth;
  const sy = photoHeight / recordedHeight;
  const drawn = smoothPath(segments
    .filter((segment) => finite(segment.point?.x) && finite(segment.point?.y))
    .map((segment) => ({ x: segment.point.x, y: segment.point.y, pressure: finite(segment.pressure) ? clamp(segment.pressure, 0, 1) : defaultPressure })));
  if (!drawn.length) return null;
  const raw = drawn.map((p) => ({ x: clamp(p.x * sx, 0, photoWidth), y: clamp(p.y * sy, 0, photoHeight), pressure: p.pressure }));
  const simplified = simplifyStroke(raw, Math.max(sx, sy));
  return inkToAnnotation(input.id, { color: input.color, strokeWidth: input.weight }, simplified);
}

/** Pontos de um traço (espaço da imagem) para reproduzir no Atrament, em pixels de um canvas `displayWidth` x `displayHeight`. */
export function annotationToReplay(annotation: LineAnnotation, displayWidth: number, displayHeight: number, photoWidth: number, photoHeight: number): InkPoint[] {
  if (!Array.isArray(annotation.points) || photoWidth <= 0 || photoHeight <= 0) return [];
  const sx = displayWidth / photoWidth;
  const sy = displayHeight / photoHeight;
  const result: InkPoint[] = [];
  for (let index = 0; index + 1 < annotation.points.length; index += 2) {
    const x = annotation.points[index];
    const y = annotation.points[index + 1];
    if (!finite(x) || !finite(y)) continue;
    const pressure = annotation.pressure?.[index / 2];
    result.push({ x: x * sx, y: y * sy, pressure: finite(pressure) ? pressure : defaultPressure });
  }
  return result;
}

/** Mesma lista (mesmos objetos na mesma ordem)? Usado para só reproduzir o canvas quando os traços mudam. */
export function sameAnnotationList(a: readonly PhotoAnnotation[] | null, b: readonly PhotoAnnotation[]) {
  return Boolean(a) && a!.length === b.length && a!.every((item, index) => item === b[index]);
}

/* ---------- borracha ---------- */

/** Pontos ao longo de uma poligonal, no máximo `step` entre eles. */
export function samplePath(path: readonly Point[], step: number): Point[] {
  if (path.length <= 1) return path.slice();
  const out: Point[] = [path[0]];
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1];
    const b = path[index];
    const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(0.1, step)));
    for (let k = 1; k <= count; k++) out.push({ x: a.x + ((b.x - a.x) * k) / count, y: a.y + ((b.y - a.y) * k) / count });
  }
  return out;
}

function distanceToPath(point: Point, path: readonly Point[]) {
  if (path.length === 1) return Math.hypot(point.x - path[0].x, point.y - path[0].y);
  let best = Infinity;
  for (let index = 1; index < path.length; index++) best = Math.min(best, segmentDistance(point, path[index - 1], path[index]));
  return best;
}

function pathBounds(path: readonly Point[], margin: number) {
  return {
    minX: Math.min(...path.map((p) => p.x)) - margin, maxX: Math.max(...path.map((p) => p.x)) + margin,
    minY: Math.min(...path.map((p) => p.y)) - margin, maxY: Math.max(...path.map((p) => p.y)) + margin,
  };
}

/** Subdivide segmentos maiores que `step` para a borracha cortar o traço no lugar certo. */
function densify(points: InkPoint[], step: number): InkPoint[] {
  const out: InkPoint[] = [];
  points.forEach((p, index) => {
    if (index === 0) { out.push(p); return; }
    const a = points[index - 1];
    const count = Math.max(1, Math.ceil(Math.hypot(p.x - a.x, p.y - a.y) / step));
    for (let k = 1; k <= count; k++) {
      const t = k / count;
      out.push({ x: a.x + (p.x - a.x) * t, y: a.y + (p.y - a.y) * t, pressure: a.pressure + (p.pressure - a.pressure) * t });
    }
  });
  return out;
}

/**
 * Apaga de um traço livre só os trechos tocados pela borracha. Devolve o próprio traço se nada foi tocado,
 * ou 0..n traços (cada trecho que sobrou). `radius` e `pixelScale` como em `eraseAnnotations`.
 */
export function eraseInkStroke(stroke: LineAnnotation, path: readonly Point[], radius: number, pixelScale: number): LineAnnotation[] {
  if (!path.length || !Array.isArray(stroke.points)) return [stroke];
  const tolerance = radius + (stroke.strokeWidth * pixelScale) / 2;
  const box = pathBounds(path, tolerance);
  const points: InkPoint[] = [];
  for (let index = 0; index + 1 < stroke.points.length; index += 2) {
    const x = stroke.points[index];
    const y = stroke.points[index + 1];
    if (finite(x) && finite(y)) points.push({ x, y, pressure: finite(stroke.pressure?.[index / 2]) ? stroke.pressure![index / 2] : defaultPressure });
  }
  if (!points.length) return [stroke];
  // Rejeição rápida: traço inteiro fora da área da borracha.
  const strokeBox = { minX: Math.min(...points.map((p) => p.x)), maxX: Math.max(...points.map((p) => p.x)), minY: Math.min(...points.map((p) => p.y)), maxY: Math.max(...points.map((p) => p.y)) };
  if (strokeBox.maxX < box.minX || strokeBox.minX > box.maxX || strokeBox.maxY < box.minY || strokeBox.minY > box.maxY) return [stroke];

  const dense = densify(points.length === 1 ? [points[0], points[0]] : points, Math.max(0.5 * pixelScale, tolerance / 3));
  const erased = dense.map((p) => distanceToPath(p, path) <= tolerance);
  if (!erased.some(Boolean)) return [stroke];

  const runs: InkPoint[][] = [];
  let current: InkPoint[] = [];
  dense.forEach((p, index) => {
    if (erased[index]) { if (current.length) runs.push(current); current = []; } else current.push(p);
  });
  if (current.length) runs.push(current);
  return runs
    .filter((run) => run.length >= 2)
    .map((run, index) => inkToAnnotation(index === 0 ? stroke.id : pieceId(stroke.id), { color: stroke.color, strokeWidth: stroke.strokeWidth, label: index === 0 ? stroke.label : undefined }, simplifyStroke(run, pixelScale)));
}

export function textBounds(annotation: Extract<PhotoAnnotation, { type: "text" }>) {
  return { minX: annotation.x, minY: annotation.y, maxX: annotation.x + annotation.text.length * annotation.fontSize * 0.6, maxY: annotation.y + annotation.fontSize * 1.2 };
}

function touchesPoint(annotation: Extract<PhotoAnnotation, { type: "point" }>, sampled: readonly Point[], radius: number) {
  return sampled.some((p) => Math.hypot(p.x - annotation.x, p.y - annotation.y) <= radius + annotation.radius);
}

function touchesText(annotation: Extract<PhotoAnnotation, { type: "text" }>, sampled: readonly Point[], radius: number) {
  const b = textBounds(annotation);
  return sampled.some((p) => p.x >= b.minX - radius && p.x <= b.maxX + radius && p.y >= b.minY - radius && p.y <= b.maxY + radius);
}

/**
 * Passa a borracha (poligonal `path` no espaço da imagem, raio `radius` em unidades da imagem) sobre as marcações:
 * apaga só o trecho tocado dos traços livres e remove inteiras as formas, pontos e textos tocados (como o app).
 * `pixelScale` = pixels da imagem por pixel de tela (a espessura do traço é em pixels de tela). Devolve a mesma lista se nada mudou.
 */
export function eraseAnnotations(annotations: readonly PhotoAnnotation[], path: readonly Point[], radius: number, pixelScale = 1, only?: { ink?: boolean; others?: boolean }): PhotoAnnotation[] {
  const doInk = only?.ink ?? true;
  const doOthers = only?.others ?? true;
  if (!path.length) return annotations as PhotoAnnotation[];
  const sampled = samplePath(path, Math.max(1, radius / 2));
  let changed = false;
  const next: PhotoAnnotation[] = [];
  for (const annotation of annotations) {
    if (isInkAnnotation(annotation)) {
      if (!doInk) { next.push(annotation); continue; }
      const pieces = eraseInkStroke(annotation, path, radius, pixelScale);
      if (pieces.length !== 1 || pieces[0] !== annotation) changed = true;
      next.push(...pieces);
      continue;
    }
    if (!doOthers) { next.push(annotation); continue; }
    const shape = shapeFromAnnotation(annotation);
    const touched = shape
      ? sampled.some((p) => hitShape(shape, p, radius, pixelScale))
      : annotation.type === "point" ? touchesPoint(annotation, sampled, radius)
      : annotation.type === "text" ? touchesText(annotation, sampled, radius)
      : false;
    if (touched) changed = true; else next.push(annotation);
  }
  return changed ? next : (annotations as PhotoAnnotation[]);
}

/* ---------- mover e redimensionar ---------- */

export type Handle = "nw" | "ne" | "se" | "sw";

/** Canto de uma forma onde fica a alça (x1/x2 e y1/y2 como foram desenhados). */
export function handlePoint(shape: Shape, handle: Handle): Point {
  return { x: handle === "nw" || handle === "sw" ? shape.x1 : shape.x2, y: handle === "nw" || handle === "ne" ? shape.y1 : shape.y2 };
}

/** Arrasta uma alça por (dx, dy), sem sair da foto. */
export function resizeShape(original: Shape, handle: Handle, dx: number, dy: number, photoWidth: number, photoHeight: number): Shape {
  const result = { ...original };
  if (handle === "nw" || handle === "sw") result.x1 = clamp(original.x1 + dx, 0, photoWidth);
  else result.x2 = clamp(original.x2 + dx, 0, photoWidth);
  if (handle === "nw" || handle === "ne") result.y1 = clamp(original.y1 + dy, 0, photoHeight);
  else result.y2 = clamp(original.y2 + dy, 0, photoHeight);
  return result;
}

/** Desloca uma marcação (forma, ponto ou texto) por (dx, dy) mantendo-a dentro da foto. Traços livres não se movem. */
export function translateAnnotation(annotation: PhotoAnnotation, dx: number, dy: number, photoWidth: number, photoHeight: number): PhotoAnnotation {
  const shape = shapeFromAnnotation(annotation);
  if (shape) {
    const b = bounds(shape);
    const mx = clamp(dx, -b.minX, photoWidth - b.maxX);
    const my = clamp(dy, -b.minY, photoHeight - b.maxY);
    return annotationFromShape({ ...shape, x1: shape.x1 + mx, x2: shape.x2 + mx, y1: shape.y1 + my, y2: shape.y2 + my });
  }
  if (annotation.type === "point" || annotation.type === "text") {
    return { ...annotation, x: round2(clamp(annotation.x + dx, 0, photoWidth)), y: round2(clamp(annotation.y + dy, 0, photoHeight)) };
  }
  return annotation;
}

/** Aplica cor/espessura a uma marcação selecionada (texto e ponto só mudam de cor; traço livre não é editado). */
export function restyleAnnotation(annotation: PhotoAnnotation, patch: { color?: string; strokeWidth?: number }): PhotoAnnotation {
  if (isInkAnnotation(annotation)) return annotation;
  const keepsWidth = annotation.type === "text" || annotation.type === "point";
  return {
    ...annotation,
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.strokeWidth !== undefined && !keepsWidth ? { strokeWidth: patch.strokeWidth } : {}),
  };
}
