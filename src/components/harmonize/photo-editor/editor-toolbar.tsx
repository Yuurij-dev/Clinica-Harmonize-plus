"use client";

import {
  ArrowUpRight,
  Circle,
  Download,
  Eraser,
  MousePointer2,
  Pencil,
  Redo2,
  RotateCcw,
  Save,
  Slash,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EditorTool } from "./types";

const tools: { id: EditorTool; label: string; icon: LucideIcon }[] = [
  { id: "select", label: "Seleção", icon: MousePointer2 },
  { id: "pen", label: "Desenho livre", icon: Pencil },
  { id: "line", label: "Linha", icon: Slash },
  { id: "arrow", label: "Seta", icon: ArrowUpRight },
  { id: "ellipse", label: "Círculo/elipse", icon: Circle },
  { id: "text", label: "Texto", icon: Type },
  { id: "eraser", label: "Borracha", icon: Eraser },
];

const colors = [
  { label: "Vermelho", value: "#ff3b30" },
  { label: "Roxo", value: "#6c4cff" },
  { label: "Azul", value: "#2563eb" },
  { label: "Verde", value: "#16a34a" },
  { label: "Branco", value: "#ffffff" },
];

export function EditorToolbar({
  tool,
  color,
  canUndo,
  canRedo,
  hasSelection,
  onToolChange,
  onColorChange,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onDeleteSelected,
  onClear,
  onSave,
  onExport,
}: {
  tool: EditorTool;
  color: string;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  onToolChange: (tool: EditorTool) => void;
  onColorChange: (color: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onDeleteSelected: () => void;
  onClear: () => void;
  onSave: () => void;
  onExport: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[8px] border border-[#12315d] bg-[#071338] p-3 text-white shadow-[0_18px_40px_rgba(7,19,56,0.18)]">
      <div className="grid grid-cols-7 gap-1 lg:grid-cols-1">
        {tools.map(({ id, label, icon: Icon }) => (
          <button
            aria-label={label}
            className={cn(
              "grid h-10 w-10 place-items-center rounded-[7px] border text-white transition",
              tool === id
                ? "border-[#6c4cff] bg-[#5147dc] shadow-[0_0_0_3px_rgba(108,76,255,0.18)]"
                : "border-[#12315d] bg-[#0b1d42] hover:border-[#6c4cff]",
            )}
            key={id}
            title={label}
            type="button"
            onClick={() => onToolChange(id)}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1 lg:grid lg:grid-cols-1">
        {colors.map((item) => (
          <button
            aria-label={item.label}
            className={cn(
              "h-8 w-8 rounded-full border transition",
              color === item.value ? "border-white ring-2 ring-[#6c4cff]" : "border-white/20",
            )}
            key={item.value}
            style={{ backgroundColor: item.value }}
            title={item.label}
            type="button"
            onClick={() => onColorChange(item.value)}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-1 lg:grid-cols-1">
        <ToolbarIcon disabled={!canUndo} label="Desfazer" onClick={onUndo} icon={Undo2} />
        <ToolbarIcon disabled={!canRedo} label="Refazer" onClick={onRedo} icon={Redo2} />
        <ToolbarIcon disabled={!hasSelection} label="Excluir seleção" onClick={onDeleteSelected} icon={Trash2} />
        <ToolbarIcon label="Zoom +" onClick={onZoomIn} icon={ZoomIn} />
        <ToolbarIcon label="Zoom -" onClick={onZoomOut} icon={ZoomOut} />
        <ToolbarIcon label="Resetar zoom" onClick={onZoomReset} icon={RotateCcw} />
      </div>

      <div className="grid gap-2 lg:w-44">
        <Button className="w-full justify-center" size="sm" onClick={onSave}>
          <Save className="h-3.5 w-3.5" />
          Salvar avaliação
        </Button>
        <Button className="w-full justify-center border-[#2e4a78] bg-[#0b1d42] text-white hover:border-[#6c4cff] hover:text-white" size="sm" variant="secondary" onClick={onExport}>
          <Download className="h-3.5 w-3.5" />
          Exportar imagem
        </Button>
        <Button className="w-full justify-center border-[#7f2c35] bg-[#1d1220] text-[#ffd7d7] hover:border-[#ff3b30] hover:text-white" size="sm" variant="secondary" onClick={onClear}>
          <Trash2 className="h-3.5 w-3.5" />
          Limpar
        </Button>
      </div>
    </div>
  );
}

function ToolbarIcon({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="grid h-9 w-9 place-items-center rounded-[7px] border border-[#12315d] bg-[#0b1d42] text-white transition hover:border-[#6c4cff] disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled}
      title={label}
      type="button"
      onClick={onClick}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
