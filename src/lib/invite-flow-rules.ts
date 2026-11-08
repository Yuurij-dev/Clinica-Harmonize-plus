// Regras puras da página pública do convite (transições de passo e mensagens).

export type InviteStep = "choose" | "register" | "signin" | "change-password" | "done-other-clinic" | "google-complete";

export const PASSWORD_UPDATED_MESSAGE = "Senha atualizada. Entre com a nova senha para aceitar o convite.";
export const NO_CLINIC_MESSAGE = "Esta conta ainda não tem acesso a nenhuma clínica e não pode aceitar convites por aqui. Peça um novo convite com outro e-mail ou fale com o suporte.";

// Depois de tentar trocar a senha provisória e aceitar: se a senha JÁ mudou mas o aceite falhou, voltar ao
// login (reenviar a troca daria 403 enganoso, porque a senha provisória deixou de existir).
export function stepAfterPasswordChange(input: { changed: boolean; accepted: boolean }): { step: InviteStep | "done"; message: string } {
  if (!input.changed) return { step: "change-password", message: "" };
  if (input.accepted) return { step: "done", message: "" };
  return { step: "signin", message: PASSWORD_UPDATED_MESSAGE };
}

// O login por senha recusa quem não tem clínica com 403 "ainda não está vinculado a uma clínica".
export function loginMessageFor(status: number, message: string | undefined): string {
  if (status === 403 && /vinculado a uma cl[ií]nica/i.test(message ?? "")) return NO_CLINIC_MESSAGE;
  return message ?? "Usuário ou senha inválidos.";
}

const googleInviteMessages: Record<string, string> = {
  account_exists: "Já existe uma conta com este e-mail. Entre com sua senha para aceitar o convite.",
  invite_email_mismatch: "A conta Google precisa ter o mesmo e-mail do convite.",
};

// ?google=<código> vindo do callback do Google para a página do convite.
export function inviteGoogleNotice(code: string | undefined): { message: string; step: InviteStep } | null {
  // `complete`: o Google ja provou a identidade; falta o formulario de dados pessoais (passo normal, sem erro).
  if (code === "complete") return { message: "", step: "google-complete" };
  if (!code || !Object.hasOwn(googleInviteMessages, code)) return null;
  return { message: googleInviteMessages[code], step: code === "account_exists" ? "signin" : "choose" };
}
