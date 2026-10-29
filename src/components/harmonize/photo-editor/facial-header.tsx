"use client";

import { ArrowLeft, ChevronRight, Loader2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { saveIndicator } from "@/lib/facial-editor-rules";

export const saveDotClass = { ok: "bg-emerald-500", busy: "bg-amber-500", error: "bg-destructive", idle: "bg-muted-foreground/50" } as const;

/** Cabeçalho compacto da área de trabalho ampliada (overlay): título, estado do salvamento, Salvar e Recolher. */
export function FacialExpandedBar({ patientName, readOnly, autosaveState, isSaving, lastSavedAt, hasRecord, onCollapse }: {
  patientName: string; readOnly: boolean; autosaveState: "saved" | "pending" | "saving" | "error"; isSaving: boolean; lastSavedAt: number | null; hasRecord: boolean; onCollapse: () => void;
}) {
  const indicator = saveIndicator({ readOnly, autosave: autosaveState, saving: isSaving, lastSavedAt, hasRecord, now: 0 });
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 items-baseline gap-3"><h2 className="text-lg font-semibold text-foreground">Avaliação facial</h2><span className="max-w-[18rem] truncate text-sm text-muted-foreground">{patientName}</span></div>
      <div className="flex items-center gap-3">
        <span aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><span aria-hidden="true" className={cn("h-2.5 w-2.5 shrink-0 rounded-full", saveDotClass[indicator.tone], indicator.tone === "busy" && "animate-pulse")} /><span className={cn(indicator.tone === "error" && "font-medium text-destructive")}>{indicator.header}</span></span>
        <Button data-facial-collapse variant="outline" onClick={onCollapse}><Minimize2 className="h-4 w-4" /><span className="text-sm font-semibold">Recolher (Esc)</span></Button>
      </div>
    </div>
  );
}

/** Título da etapa (o card do paciente e a trilha da jornada vêm logo abaixo, como nas outras etapas). */
export function FacialTitle() {
  return <h1 className="text-2xl font-semibold tracking-tight text-foreground">Avaliação facial</h1>;
}

/** Lado direito do card do paciente na etapa facial: estado do salvamento e as ações (Voltar, Salvar, Concluir). Fica fora do `inert` do editor. */
export function FacialCardActions({ readOnly, autosaveState, isSaving, lastSavedAt, hasRecord, finishLabel, finishing, onRetry, onBack, onFinish }: {
  readOnly: boolean;
  autosaveState: "saved" | "pending" | "saving" | "error";
  isSaving: boolean;
  lastSavedAt: number | null;
  hasRecord: boolean;
  finishLabel: string;
  finishing: boolean;
  onRetry: () => void;
  onBack: () => void;
  onFinish: () => void;
}) {
  const indicator = saveIndicator({ readOnly, autosave: autosaveState, saving: isSaving, lastSavedAt, hasRecord, now: 0 });
  const busy = indicator.tone === "busy";
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 max-lg:grid max-lg:w-full max-lg:grid-cols-1 max-lg:justify-stretch">
      <span aria-live="polite" className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
        <span aria-hidden="true" className={cn("h-2.5 w-2.5 shrink-0 rounded-full", saveDotClass[indicator.tone], busy && "animate-pulse")} />
        <span className={cn(indicator.tone === "error" && "font-medium text-destructive")}>{indicator.header}</span>
        {indicator.canRetry ? <button className="hp-accent-text rounded-sm text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-lg:min-h-11 max-lg:px-2" type="button" onClick={onRetry}><span className="font-semibold">Tentar novamente</span></button> : null}
      </span>
      <Button className="text-muted-foreground max-lg:justify-start" disabled={isSaving} variant="ghost" onClick={onBack}><ArrowLeft className="h-4 w-4" /><span className="text-sm font-medium">Voltar à avaliação clínica</span></Button>
      <Button className="max-lg:w-full" disabled={isSaving || finishing} variant="outline" onClick={onFinish}>{finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}<span className="text-sm font-semibold">{finishLabel}</span><ChevronRight className="h-4 w-4" /></Button>
    </div>
  );
}
