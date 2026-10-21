export type EditorTool =
  | "select"
  | "pan"
  | "pen"
  | "point"
  | "line"
  | "curve"
  | "arrow"
  | "ellipse"
  | "text"
  | "eraser";

export type AnnotationBase = {
  id: string;
  color: string;
  strokeWidth: number;
};

export type LineAnnotation = AnnotationBase & {
  type: "freehand" | "line" | "curve" | "arrow";
  points: number[];
};

export type EllipseAnnotation = AnnotationBase & {
  type: "ellipse";
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TextAnnotation = AnnotationBase & {
  type: "text";
  x: number;
  y: number;
  text: string;
  fontSize: number;
};

export type PointAnnotation = AnnotationBase & { type: "point"; x: number; y: number; radius: number };

export type PhotoAnnotation = LineAnnotation | EllipseAnnotation | TextAnnotation | PointAnnotation;

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
