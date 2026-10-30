"use client";

import { Download, Loader2, Maximize2, Minimize2, Redo2, Save, Undo2, Upload, ZoomIn, ZoomOut } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EditorTool } from "./types";
import { editorTools, viewOnlyTools } from "./editor-toolbar-data";

const itemClass = "flex h-14 min-w-10 shrink-0 flex-col items-center justify-center gap-1.5 rounded-lg px-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";
const idleClass = "text-foreground/80 hover:bg-primary/5 hover:text-foreground";
const activeClass = "hp-accent-text bg-primary/10 text-primary";

function Divider() {
  return <span aria-hidden="true" className="mx-0.5 h-10 w-px shrink-0 self-center bg-border" />;
}

function ToolbarButton({ icon: Icon, label, hint, active, disabled, onClick, ...rest }: { "data-facial-expand"?: boolean; icon: LucideIcon; label: string; hint: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button {...rest} aria-label={hint} aria-pressed={active} className={cn(itemClass, active ? activeClass : idleClass)} disabled={disabled} title={hint} type="button" onClick={onClick}>
      <Icon aria-hidden="true" className="h-5 w-5" />
      <span className="text-xs font-medium leading-none">{label}</span>
    </button>
  );
}

const groups: EditorTool[][] = [["select", "pan"], ["pen"], ["point", "line", "arrow", "ellipse", "rectangle", "text", "eraser"]];

/** Barra horizontal de ferramentas da avaliação facial (desktop; abaixo de lg vale a barra rolável do celular). */
export function FacialToolbar({ tool, onToolChange, marksHidden, noPhoto, readOnly = false, canUndo, canRedo, onUndo, onRedo, zoomPercent, onZoomIn, onZoomOut, expanded, onToggleExpanded, onAddPhotos, onExport, onSave, saveDisabled, saving }: {
  tool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
  /** "Mostrar marcações" desligado: só Selecionar e Mover seguem ativas. */
  marksHidden: boolean;
  noPhoto: boolean;
  /** Só consulta: "Adicionar foto" desligado (as ferramentas de desenho já vêm bloqueadas por `marksHidden`). */
  readOnly?: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  zoomPercent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  onAddPhotos: () => void;
  onExport: () => void;
  onSave: () => void;
  /** Sem avaliação carregada, só leitura ou erro de carga: nada para gravar. */
  saveDisabled: boolean;
  saving: boolean;
}) {
  return (
    <div aria-label="Ferramentas de marcação" className="hidden flex-wrap items-center gap-y-1 rounded-xl border border-border bg-card p-2 shadow-sm lg:flex" role="toolbar">
      {groups.map((ids, groupIndex) => (
        <div className="flex items-center" key={ids[0]} role="group" aria-label={groupIndex === 0 ? "Navegação" : "Desenho"}>
          {groupIndex > 0 ? <Divider /> : null}
          {ids.map((id) => {
            const item = editorTools.find((entry) => entry.id === id)!;
            const blocked = marksHidden && !viewOnlyTools.includes(id);
            return <ToolbarButton active={tool === id} disabled={noPhoto || blocked} hint={blocked ? `${item.label} (ative "Mostrar marcações" para desenhar)` : item.label} icon={item.icon} key={id} label={item.short} onClick={() => onToolChange(id)} />;
          })}
        </div>
      ))}
      <Divider />
      <div className="flex items-center" role="group" aria-label="Histórico">
        <ToolbarButton disabled={noPhoto || marksHidden || !canUndo} hint="Desfazer (Ctrl+Z)" icon={Undo2} label="Desfazer" onClick={onUndo} />
        <ToolbarButton disabled={noPhoto || marksHidden || !canRedo} hint="Refazer (Ctrl+Y)" icon={Redo2} label="Refazer" onClick={onRedo} />
      </div>
      <Divider />
      <div className="flex items-center" role="group" aria-label="Visualização">
        <div className="flex h-14 w-[4.75rem] shrink-0 flex-col items-center justify-center gap-1.5">
          <div className="flex h-5 items-center gap-2">
            <button aria-label="Diminuir o zoom (Ctrl+−)" className="grid h-6 w-7 place-items-center rounded-md text-foreground/80 transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40" disabled={noPhoto} title="Diminuir o zoom (Ctrl+−)" type="button" onClick={onZoomOut}><ZoomOut aria-hidden="true" className="h-5 w-5" /></button>
            <button aria-label="Aumentar o zoom (Ctrl++)" className="grid h-6 w-7 place-items-center rounded-md text-foreground/80 transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40" disabled={noPhoto} title="Aumentar o zoom (Ctrl++)" type="button" onClick={onZoomIn}><ZoomIn aria-hidden="true" className="h-5 w-5" /></button>
          </div>
          <span className="text-xs font-medium leading-none text-foreground/80" title={`Zoom ${zoomPercent}%`}>Zoom <span className="font-normal text-muted-foreground">{zoomPercent}%</span></span>
        </div>
        <ToolbarButton data-facial-expand active={expanded} disabled={noPhoto} hint={expanded ? "Recolher a área de trabalho (Esc)" : "Expandir a área de trabalho"} icon={expanded ? Minimize2 : Maximize2} label={expanded ? "Recolher" : "Expandir"} onClick={onToggleExpanded} />
      </div>
      <Divider />
      <button aria-label="Adicionar foto" className={cn(itemClass, idleClass)} disabled={readOnly} title="Adicionar foto" type="button" onClick={onAddPhotos}><Upload aria-hidden="true" className="h-5 w-5" /></button>
      <div aria-label="Exportar e salvar" className="ml-auto flex items-center gap-1.5 pl-1" role="group">
        <Button className="px-2.5" disabled={noPhoto} variant="outline" onClick={onExport} title={marksHidden ? "Exporta só a foto (as marcações estão ocultas)" : "Exportar a foto com as marcações em PNG"}><Download className="h-4 w-4" /><span className="text-sm font-semibold">Exportar PNG</span></Button>
        <span aria-hidden="true" className="h-10 w-px shrink-0 bg-border" />
        <Button className="h-10 px-2.5" disabled={readOnly || saveDisabled || saving} onClick={onSave}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}<span className="text-sm font-semibold">Salvar avaliação</span></Button>
      </div>
    </div>
  );
}
