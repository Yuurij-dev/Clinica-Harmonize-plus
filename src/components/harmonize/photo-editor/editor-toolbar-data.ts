import { ArrowUpRight, Circle, Eraser, MousePointer2, Move, Pencil, Slash, Type } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { EditorTool } from "./types";

export const editorTools: { id: EditorTool; label: string; short: string; icon: LucideIcon }[] = [
  { id: "select", label: "Seleção", short: "Seleção", icon: MousePointer2 },
  { id: "pan", label: "Mover foto", short: "Mover", icon: Move },
  { id: "pen", label: "Desenho livre", short: "Pincel", icon: Pencil },
  { id: "point", label: "Ponto", short: "Ponto", icon: Circle },
  { id: "line", label: "Linha", short: "Linha", icon: Slash },
  { id: "curve", label: "Curva", short: "Curva", icon: Pencil },
  { id: "arrow", label: "Seta", short: "Seta", icon: ArrowUpRight },
  { id: "ellipse", label: "Círculo/elipse", short: "Forma", icon: Circle },
  { id: "text", label: "Texto", short: "Texto", icon: Type },
  { id: "eraser", label: "Borracha", short: "Borracha", icon: Eraser },
];

export const editorColors = [
  { label: "Vermelho", value: "#ff3b30" },
  { label: "Roxo", value: "#6c4cff" },
  { label: "Azul", value: "#2563eb" },
  { label: "Verde", value: "#16a34a" },
  { label: "Branco", value: "#ffffff" },
];
