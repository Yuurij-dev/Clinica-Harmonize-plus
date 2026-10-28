import { ChevronRight } from "lucide-react";

export type EncounterBreadcrumbActions = {
  onClients: () => void;
  onPatient: () => void;
  onJourney: () => void;
};

export function EncounterBreadcrumb({
  patientName,
  journeyName,
  stage,
  onClients,
  onPatient,
  onJourney,
}: EncounterBreadcrumbActions & {
  patientName: string;
  journeyName: string;
  stage: string;
}) {
  const buttonClass = "rounded-sm transition-colors max-lg:min-h-11 max-lg:px-1 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  return (
    <nav aria-label="Navegação do atendimento" className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <button type="button" className={buttonClass} onClick={onClients}>Clientes</button>
      <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
      <button type="button" className={`${buttonClass} max-w-[12rem] truncate`} onClick={onPatient}>{patientName}</button>
      <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
      <button type="button" className={`${buttonClass} max-w-[12rem] truncate`} onClick={onJourney}>{journeyName}</button>
      <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span aria-current="page" className="font-semibold text-foreground">{stage}</span>
    </nav>
  );
}
