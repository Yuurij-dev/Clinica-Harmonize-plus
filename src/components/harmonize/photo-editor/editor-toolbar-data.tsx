import { ArrowUpRight, Circle, Eraser, Hand, MousePointer2, Pencil, Slash, Square, Type } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { EditorTool } from "./types";

// Ponto cheio, como no desenho (o CircleDot do Lucide e vazado).
const FilledDot = (({ className, size = 24 }: { className?: string; size?: number | string }) => (
  <svg aria-hidden="true" className={className} fill="currentColor" height={size} viewBox="0 0 24 24" width={size}><circle cx="12" cy="12" r="4.5" /></svg>
)) as unknown as LucideIcon;

// Ferramentas da barra (mesma ordem do desenho da avaliação facial). O triângulo não é mais criado aqui; os que já existem continuam editáveis ao selecionar.
export const editorTools: { id: EditorTool; label: string; short: string; icon: LucideIcon }[] = [
  { id: "select", label: "Selecionar e editar marcações", short: "Selecionar", icon: MousePointer2 },
  { id: "pan", label: "Mover a imagem (arrastar)", short: "Mover", icon: Hand },
  { id: "pen", label: "Caneta (desenho livre)", short: "Caneta", icon: Pencil },
  { id: "point", label: "Ponto", short: "Ponto", icon: FilledDot },
  { id: "line", label: "Linha", short: "Linha", icon: Slash },
  { id: "arrow", label: "Seta", short: "Seta", icon: ArrowUpRight },
  { id: "ellipse", label: "Círculo", short: "Círculo", icon: Circle },
  { id: "rectangle", label: "Retângulo", short: "Retângulo", icon: Square },
  { id: "text", label: "Texto", short: "Texto", icon: Type },
  { id: "eraser", label: "Borracha", short: "Borracha", icon: Eraser },
];

/** Ferramentas que não desenham nem apagam: seguem disponíveis com as marcações ocultas. */
export const viewOnlyTools: readonly EditorTool[] = ["select", "pan"];

export const defaultMarkColor = "#5147dc";

export const editorColors = [
  { label: "Roxo Harmonize", value: "#5147dc" },
  { label: "Vermelho", value: "#ff3b30" },
  { label: "Azul", value: "#2563eb" },
  { label: "Verde", value: "#16a34a" },
  { label: "Branco", value: "#ffffff" },
];
