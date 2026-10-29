export type EditorTool =
  | "select"
  | "pan"
  | "pen"
  | "eraser"
  | "line"
  | "arrow"
  | "rectangle"
  | "ellipse"
  | "triangle"
  | "point"
  | "text";

export type AnnotationBase = {
  id: string;
  color: string;
  strokeWidth: number;
  /** Legenda opcional (ex.: "Glabela") desenhada com linha guia; ausente nas marcações antigas. Limite em `maxAnnotationLabelLength`. */
  label?: string;
};

/** Pontos em pares [x0, y0, x1, y1, ...] no espaço da imagem. `curve` e `freehand` são traços; `pressure` (opcional, um valor por ponto) vem do Atrament. */
export type LineAnnotation = AnnotationBase & {
  type: "freehand" | "line" | "curve" | "arrow";
  points: number[];
  pressure?: number[];
};

/** Caixa no espaço da imagem (largura/altura podem ser negativas em marcações antigas). */
type BoxFields = AnnotationBase & { x: number; y: number; width: number; height: number };
export type EllipseAnnotation = BoxFields & { type: "ellipse" };
export type RectangleAnnotation = BoxFields & { type: "rectangle" };
export type TriangleAnnotation = BoxFields & { type: "triangle" };
export type BoxAnnotation = EllipseAnnotation | RectangleAnnotation | TriangleAnnotation;

export type TextAnnotation = AnnotationBase & {
  type: "text";
  x: number;
  y: number;
  text: string;
  fontSize: number;
};

export type PointAnnotation = AnnotationBase & { type: "point"; x: number; y: number; radius: number };

export type PhotoAnnotation = LineAnnotation | BoxAnnotation | TextAnnotation | PointAnnotation;

export type EvaluationPhoto = {
  id: string;
  name: string;
  imageUrl: string;
  width: number;
  height: number;
  category: "Frontal" | "Perfil direito" | "Perfil esquerdo" | "Sorriso" | "Outra";
  sortOrder: number;
  annotations: PhotoAnnotation[];
};

export type AnnotationSnapshot = PhotoAnnotation[];
