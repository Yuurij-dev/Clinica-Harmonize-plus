// Regras puras do aviso "salvamento pendente" ao concluir a avaliação facial.
import { assessmentFieldErrors } from "./evaluation-rules.ts";
export type AutosaveStateLike = "saved" | "pending" | "saving" | "error";

/**
 * - proceed: nada a salvar, conclui direto.
 * - settle: há uma gravação em andamento; espera terminar e reavalia.
 * - ask: há alterações não salvas (aguardando ou com falha); o usuário decide.
 */
export function pendingSaveAction(state: AutosaveStateLike): "proceed" | "settle" | "ask" {
  if (state === "saved") return "proceed";
  if (state === "saving") return "settle";
  return "ask";
}

export const pendingSaveCopy = {
  title: "Há um salvamento pendente",
  intro: "Existem alterações (marcações e/ou observações) desta avaliação que ainda não foram salvas. Antes de ir ao orçamento, escolha o que fazer com elas:",
  save: { label: "Salvar e continuar", effect: "grava as alterações e conclui a avaliação com elas." },
  discard: { label: "Descartar e continuar", effect: "perde as alterações não salvas e conclui a avaliação com a última versão já salva." },
  cancel: { label: "Cancelar", effect: "volta para a avaliação, sem mudar nada." },
  saveFailed: "Não foi possível salvar as alterações. Tente novamente ou descarte-as.",
  discardFailed: "Não foi possível recuperar a última versão salva. As alterações continuam na tela; tente novamente.",
  savedIncomplete: "A última versão salva está incompleta para concluir. Salve as alterações ou cancele.",
  concludeFailed: "Não foi possível concluir a avaliação. Verifique a conexão e tente novamente.",
  discardConcludeFailed: "Não foi possível concluir a avaliação. As alterações já foram descartadas e a última versão salva está na tela; tente novamente.",
  noSavedVersion: "Esta avaliação ainda não tem uma versão salva para recuperar. Salve as alterações ou cancele.",
} as const;

/** A última versão salva só pode ser usada para concluir se passar a mesma regra de campos obrigatórios que o servidor aplica no PUT "Concluída". */
export function savedVersionCanConclude(saved: Parameters<typeof assessmentFieldErrors>[0] & { status?: string }) {
  const baseline = saved.status === "Concluída" ? saved : null;
  return Object.keys(assessmentFieldErrors(saved, baseline)).length === 0;
}
