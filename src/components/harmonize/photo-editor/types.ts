export type EditorTool =
  | "select"
  | "pen"
  | "line"
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
  type: "freehand" | "line" | "arrow";
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

export type PhotoAnnotation = LineAnnotation | EllipseAnnotation | TextAnnotation;

export type EvaluationPhoto = {
  id: string;
  name: string;
  imageUrl: string;
  width: number;
  height: number;
  annotations: PhotoAnnotation[];
};

export type AnnotationSnapshot = PhotoAnnotation[];
