import { ArrowUpRight, Circle, CircleDot, Eraser, MousePointer2, Pencil, Slash, Square, Triangle, Type } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { EditorTool } from "./types";

// Mesmas ferramentas do editor do app: Lápis, Borracha, Mover e as formas; Ponto e Texto continuam da versão web.
export const editorTools: { id: EditorTool; label: string; short: string; icon: LucideIcon }[] = [
  { id: "pen", label: "Lápis (desenho livre)", short: "Lápis", icon: Pencil },
  { id: "eraser", label: "Borracha", short: "Borracha", icon: Eraser },
  { id: "select", label: "Mover e selecionar formas", short: "Mover", icon: MousePointer2 },
  { id: "line", label: "Linha", short: "Linha", icon: Slash },
  { id: "arrow", label: "Seta", short: "Seta", icon: ArrowUpRight },
  { id: "rectangle", label: "Retângulo", short: "Retângulo", icon: Square },
  { id: "ellipse", label: "Elipse", short: "Elipse", icon: Circle },
  { id: "triangle", label: "Triângulo", short: "Triângulo", icon: Triangle },
  { id: "point", label: "Ponto", short: "Ponto", icon: CircleDot },
  { id: "text", label: "Texto", short: "Texto", icon: Type },
];

export const editorColors = [
  { label: "Vermelho", value: "#ff3b30" },
  { label: "Roxo", value: "#6c4cff" },
  { label: "Azul", value: "#2563eb" },
  { label: "Verde", value: "#16a34a" },
  { label: "Branco", value: "#ffffff" },
];
