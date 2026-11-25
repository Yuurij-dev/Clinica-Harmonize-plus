// Parte da recuperação de senha que roda no navegador (as regras do servidor usam node:crypto).

/** Token do link `/redefinir-senha#token=...`; vazio se ausente. */
export function readResetTokenFromHash(hash: string): string {
  return new URLSearchParams(hash.replace(/^#/, "")).get("token")?.trim() ?? "";
}

/** E-mail normalizado ou vazio se o formato for inválido. */
export function normalizeResetEmailInput(raw: string): string {
  const email = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}
