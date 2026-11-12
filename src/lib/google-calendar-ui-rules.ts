// Textos e apresentação do card Google Agenda (Configurações > Integrações). Regras puras, sem React.

export const GOOGLE_CALENDAR_STATUS_KEY = "/api/integrations/google-calendar/status";

export type GcalToast = { kind: "success" | "error" | "info"; message: string };

const outcomes: Record<string, GcalToast> = {
  connected: { kind: "success", message: "Google Agenda conectado." },
  denied: { kind: "info", message: "Autorização cancelada." },
  already_central: { kind: "error", message: "A clínica já tem uma agenda central conectada por outro administrador." },
  no_scope: { kind: "error", message: "Permissão de agenda não concedida. Autorize o acesso ao calendário e tente de novo." },
  no_refresh: { kind: "error", message: "Não recebemos permissão offline; tente conectar novamente." },
  forbidden: { kind: "error", message: "Seu cargo não permite conectar o Google Agenda." },
  unavailable: { kind: "error", message: "A integração com o Google Agenda não está disponível neste ambiente." },
  error: { kind: "error", message: "Não foi possível conectar o Google Agenda. Tente novamente." },
};

/** Mensagem para o código `?gcal=`; códigos desconhecidos viram erro genérico. */
export function gcalOutcomeToast(code: string): GcalToast {
  return outcomes[code] ?? outcomes.error;
}

export type StatusPresentation = { label: string; variant: "green" | "amber" | "slate" };

export function gcalStatusPresentation(status: string): StatusPresentation {
  if (status === "CONNECTED") return { label: "Conectado", variant: "green" };
  if (status === "ERROR") return { label: "Erro na conexão", variant: "amber" };
  if (status === "DISCONNECTED") return { label: "Desconectado", variant: "slate" };
  return { label: "Não conectado", variant: "slate" };
}

/** Resumo do resultado de "Sincronizar agora". */
export function gcalSyncSummary(result: { enqueued?: number; processed?: { completed?: number; retried?: number; failed?: number } | null } | null) {
  const enqueued = result?.enqueued ?? 0;
  const failed = result?.processed?.failed ?? 0;
  if (failed > 0) return `Sincronização iniciada, mas ${failed} ${failed === 1 ? "evento falhou" : "eventos falharam"}. Novas tentativas serão feitas automaticamente.`;
  if (enqueued === 0) return "Tudo já está sincronizado.";
  return `Sincronização iniciada: ${enqueued} ${enqueued === 1 ? "agendamento enviado" : "agendamentos enviados"} ao Google.`;
}
