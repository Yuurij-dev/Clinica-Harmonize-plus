import { Lock } from "lucide-react";

// Aviso das etapas já ultrapassadas pela jornada (procedimento concluído): abertas só para consulta.
export function ReadOnlyStageNotice() {
  return <p role="status" className="flex items-center gap-2 rounded-md border border-border bg-muted/60 px-3 py-2 text-xs font-semibold text-muted-foreground"><Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Etapa concluída — somente visualização</p>;
}
