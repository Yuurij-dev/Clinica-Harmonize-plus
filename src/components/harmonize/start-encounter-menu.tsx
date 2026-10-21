"use client";

import { CalendarDays, ChevronDown, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// Botão "Iniciar atendimento" com menu. Os handlers recebidos já passam pelo gate da anamnese (useAnamnesisStartGate).
export function StartEncounterMenu({ disabled, activeJourneyName, canRegisterReturn, onStart, onNewTreatment, onRegisterReturn, className }: {
  disabled?: boolean;
  activeJourneyName?: string | null;
  canRegisterReturn?: boolean;
  onStart: () => void;
  onNewTreatment: () => void;
  onRegisterReturn?: () => void;
  className?: string;
}) {
  return <div className={cn("inline-flex", className)}>
    <Button type="button" className="rounded-r-none" disabled={disabled} onClick={onStart}><Play className="h-4 w-4" />Iniciar atendimento</Button>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button type="button" size="icon" disabled={disabled} className="w-10 rounded-l-none border-l border-primary-foreground/25" aria-label="Mais opções para iniciar atendimento"><ChevronDown className="h-4 w-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {activeJourneyName ? <DropdownMenuItem onSelect={onStart}><Play className="h-4 w-4" /><span className="min-w-0 truncate">Continuar: {activeJourneyName}</span></DropdownMenuItem> : null}
        <DropdownMenuItem onSelect={onNewTreatment}><Plus className="h-4 w-4" />Novo tratamento (avaliação inicial)</DropdownMenuItem>
        {canRegisterReturn && onRegisterReturn ? <DropdownMenuItem onSelect={onRegisterReturn}><CalendarDays className="h-4 w-4" />Registrar retorno</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
