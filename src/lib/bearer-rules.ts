// Extrai o JWT de "Authorization: Bearer <jwt>" (app mobile). Devolve null para qualquer formato fora do esperado.
const maxTokenLength = 4096;

export function parseBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer ([^\s]+)$/i.exec(header.trim());
  if (!match || match[1].length > maxTokenLength) return null;
  return match[1];
}
