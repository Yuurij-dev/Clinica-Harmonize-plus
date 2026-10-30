"use client";

import { createPortal } from "react-dom";
import { Download, Redo2, RotateCcw, Save, Trash2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollFade } from "@/components/ui/scroll-fade";
import { cn } from "@/lib/utils";
import { editorColors, editorTools, viewOnlyTools } from "./editor-toolbar-data";
import type { EditorToolbarProps } from "./editor-toolbar";

const iconButton = "grid h-11 w-11 shrink-0 place-items-center rounded-[7px] border border-border bg-card text-foreground transition disabled:cursor-not-allowed disabled:opacity-40";

function IconAction({ icon: Icon, label, ...props }: { icon: LucideIcon; label: string; disabled?: boolean; onClick: () => void }) {
  return <button aria-label={label} title={label} type="button" className={iconButton} {...props}><Icon aria-hidden="true" className="h-5 w-5" /></button>;
}

/**
 * Barra do editor no celular (abaixo de lg): fica colada abaixo da topbar, com Desfazer/Refazer/Zoom sempre à mostra
 * e ferramentas, cores e espessura em uma linha rolável. Só muda a apresentação: as chamadas são as mesmas do desktop.
 */
export function EditorMobileBar(props: EditorToolbarProps) {
  const { tool, color, strokeWidth, canUndo, canRedo, hasSelection, marksHidden, onToolChange, onColorChange, onStrokeWidthChange, onUndo, onRedo, onZoomIn, onZoomOut, onZoomReset, onDeleteSelected } = props;
  return (
    <div className="hp-editor-bar sticky top-[var(--hp-topbar-h)] z-20 space-y-1.5 rounded-[8px] border border-border bg-card p-1.5 shadow-sm lg:hidden">
      <div className="flex justify-between gap-1">
        <IconAction disabled={!canUndo || marksHidden} icon={Undo2} label="Desfazer" onClick={onUndo} />
        <IconAction disabled={!canRedo || marksHidden} icon={Redo2} label="Refazer" onClick={onRedo} />
        <IconAction icon={ZoomOut} label="Zoom -" onClick={onZoomOut} />
        <IconAction icon={ZoomIn} label="Zoom +" onClick={onZoomIn} />
        <IconAction icon={RotateCcw} label="Resetar zoom" onClick={onZoomReset} />
        <IconAction disabled={!hasSelection || marksHidden} icon={Trash2} label="Excluir seleção" onClick={onDeleteSelected} />
      </div>
      <ScrollFade className="flex snap-x items-center gap-1" aria-label="Ferramentas de desenho">
        {editorTools.map(({ id, label, short, icon: Icon }) => (
          <button aria-label={label} aria-pressed={tool === id} disabled={marksHidden && !viewOnlyTools.includes(id)} key={id} title={marksHidden && !viewOnlyTools.includes(id) ? "Ative \"Mostrar marcações\" para desenhar" : label} type="button" onClick={() => onToolChange(id)} className={cn("flex h-11 min-w-14 shrink-0 snap-start flex-col items-center justify-center rounded-[7px] border px-1.5 transition disabled:cursor-not-allowed disabled:opacity-40", tool === id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground")}>
            <Icon aria-hidden="true" className="h-4 w-4" />
            <span className="text-xs font-medium leading-none">{short}</span>
          </button>
        ))}
        <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-border" />
        {editorColors.map((item) => (
          <button aria-label={item.label} aria-pressed={color === item.value} key={item.value} title={item.label} type="button" onClick={() => onColorChange(item.value)} className="grid h-11 w-11 shrink-0 snap-start place-items-center rounded-full">
            <span className={cn("h-7 w-7 rounded-full border", color === item.value ? "border-background ring-2 ring-primary" : "border-border")} style={{ backgroundColor: item.value }} />
          </button>
        ))}
        <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-border" />
        <label className="flex h-11 shrink-0 items-center gap-2 pr-2 text-xs font-medium"><span className="whitespace-nowrap">Espessura {strokeWidth}px</span>
          <input aria-label="Espessura da marcação" className="h-11 w-28 accent-[var(--primary)]" max="12" min="1" type="range" value={strokeWidth} onChange={(event) => onStrokeWidthChange(Number(event.target.value))} />
        </label>
      </ScrollFade>
    </div>
  );
}

/** Ações finais fixas acima da barra de navegação. Vai para o body (portal) para não depender de ancestrais com transform. */
export function EditorMobileActions({ onSave, onExport, onClear, isSaving, readOnly }: Pick<EditorToolbarProps, "onSave" | "onExport" | "onClear" | "isSaving" | "readOnly">) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="hp-editor-actions fixed inset-x-0 bottom-[calc(var(--hp-nav-h)+env(safe-area-inset-bottom))] z-20 flex gap-2 border-t border-border bg-card p-2 lg:hidden">
      <Button className="flex-1" disabled={isSaving || readOnly} onClick={onSave}><Save className="h-4 w-4" />{isSaving ? "Salvando..." : "Salvar avaliação"}</Button>
      <Button aria-label="Exportar imagem" size="icon" variant="secondary" onClick={onExport}><Download className="h-4 w-4" /></Button>
      <Button aria-label="Limpar" className="text-destructive" disabled={readOnly} size="icon" variant="secondary" onClick={onClear}><Trash2 className="h-4 w-4" /></Button>
    </div>,
    document.body,
  );
}
