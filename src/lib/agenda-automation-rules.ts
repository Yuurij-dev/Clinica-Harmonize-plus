// A rotina automática da agenda (POST /api/appointments/auto-process) só é aceita com acesso completo e o recurso
// `agendaAutomations`. O servidor continua recusando (403); isto só evita a chamada que já se sabe que seria recusada.
export function canRunAgendaAutomation(access: { mode?: string; features?: readonly string[] } | null | undefined) {
  return access?.mode === "full" && (access.features?.includes("agendaAutomations") ?? false);
}
