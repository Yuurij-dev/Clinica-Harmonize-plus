// Regras puras do consentimento para iniciar um procedimento. Sem imports para seguir carregável por node:test.

export const consentRequiredCode = "CONSENT_REQUIRED";

export type ConsentCounts = { signed: number; pending: number };

export const consentMessages = {
  none: "Para iniciar o procedimento, anexe o termo de consentimento assinado.",
  pending: "Há termo anexado, mas ainda não assinado. Marque como assinado ou colete a assinatura.",
} as const;

// Só termo da jornada marcado como ASSINADO (e não arquivado, filtrado na consulta) libera o início.
export function consentGate(counts: ConsentCounts): { ok: true; reason: "" } | { ok: false; reason: string } {
  if (counts.signed > 0) return { ok: true, reason: "" };
  return { ok: false, reason: counts.pending > 0 ? consentMessages.pending : consentMessages.none };
}

// Resposta do GET de sessões: contagens reais e o motivo já escrito (vazio quando liberado).
export function consentSummary(counts: ConsentCounts) {
  const gate = consentGate(counts);
  return { signed: gate.ok, signedCount: counts.signed, pendingCount: counts.pending, message: gate.reason };
}
