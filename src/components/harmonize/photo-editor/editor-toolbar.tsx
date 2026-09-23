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
  isSaving,
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
  isSaving?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-[8px] border border-[#e3e5f0] bg-white p-3 text-[#303144] shadow-[0_8px_24px_rgba(38,39,58,0.05)] lg:w-[192px]">
      <div>
        <p className="mb-2 text-[11px] font-black text-[#303144]">Ferramentas de desenho</p>
        <div className="grid grid-cols-2 gap-1.5">
        {tools.map(({ id, label, icon: Icon }) => (
          <button
            aria-label={label}
            className={cn(
              "flex h-16 w-full flex-col items-center justify-center gap-1 rounded-[7px] border text-[9px] font-bold transition",
              tool === id
                ? "border-[#5147dc] bg-[#5147dc] text-white shadow-[0_0_0_3px_rgba(81,71,220,0.14)]"
                : "border-[#e0e2ed] bg-white text-[#606176] hover:border-[#5147dc] hover:bg-[#f7f6ff] hover:text-[#5147dc]",
            )}
            key={id}
            title={label}
            type="button"
            onClick={() => onToolChange(id)}
          >
            <Icon className="h-4 w-4" />
            <span>{label === "Círculo/elipse" ? "Forma" : label === "Desenho livre" ? "Pincel" : label}</span>
          </button>
        ))}
        </div>
      </div>

      <div className="border-t border-[#ececf3] pt-3">
        <p className="mb-2 text-[11px] font-black text-[#303144]">Cores</p>
        <div className="grid grid-cols-5 gap-1.5">
        {colors.map((item) => (
          <button
            aria-label={item.label}
            className={cn(
              "h-8 w-8 rounded-full border transition",
              color === item.value ? "border-white ring-2 ring-[#5147dc]" : "border-[#d7d9e5]",
            )}
            key={item.value}
            style={{ backgroundColor: item.value }}
            title={item.label}
            type="button"
            onClick={() => onColorChange(item.value)}
          />
        ))}
        </div>
      </div>

      <div className="border-t border-[#ececf3] pt-3">
        <p className="mb-2 text-[11px] font-black text-[#303144]">Ações</p>
        <div className="grid grid-cols-3 gap-1">
        <ToolbarIcon disabled={!canUndo} label="Desfazer" onClick={onUndo} icon={Undo2} />
        <ToolbarIcon disabled={!canRedo} label="Refazer" onClick={onRedo} icon={Redo2} />
        <ToolbarIcon disabled={!hasSelection} label="Excluir seleção" onClick={onDeleteSelected} icon={Trash2} />
        <ToolbarIcon label="Zoom +" onClick={onZoomIn} icon={ZoomIn} />
        <ToolbarIcon label="Zoom -" onClick={onZoomOut} icon={ZoomOut} />
        <ToolbarIcon label="Resetar zoom" onClick={onZoomReset} icon={RotateCcw} />
        </div>
      </div>

      <div className="grid min-w-0 gap-2 lg:w-full">
        <Button className="w-full min-w-0 justify-center whitespace-normal px-2 leading-4" disabled={isSaving} size="sm" onClick={onSave}>
          <Save className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 text-center">{isSaving ? "Salvando..." : "Salvar avaliação"}</span>
        </Button>
        <Button className="w-full min-w-0 justify-center whitespace-normal px-2 leading-4" size="sm" variant="secondary" onClick={onExport}>
          <Download className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 text-center">Exportar imagem</span>
        </Button>
        <Button className="w-full min-w-0 justify-center whitespace-normal px-2 leading-4 border-[#f2c8c3] text-[#b42318] hover:border-[#b42318] hover:text-[#b42318]" size="sm" variant="secondary" onClick={onClear}>
          <Trash2 className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 text-center">Limpar</span>
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
      className="flex min-h-12 w-full flex-col items-center justify-center gap-1 rounded-[7px] border border-[#e0e2ed] bg-white px-1 text-[#606176] transition hover:border-[#5147dc] hover:bg-[#f7f6ff] hover:text-[#5147dc] disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled}
      title={label}
      type="button"
      onClick={onClick}
    >
      <Icon className="h-4 w-4" />
      <span className="truncate text-[8px] font-bold">{label === "Excluir seleção" ? "Excluir" : label === "Resetar zoom" ? "Resetar" : label}</span>
    </button>
  );
}
