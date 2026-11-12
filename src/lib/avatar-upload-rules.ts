// Regras puras do envio da foto de perfil (equipe e "Meu perfil"): sem Prisma, sem Next.

export const AVATAR_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
// Margem do multipart (fronteiras e cabeçalhos) acima do limite do arquivo.
export const AVATAR_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
export const AVATAR_ALLOWED_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/webp"]);

export type AvatarUploadIssue = { status: number; message: string };

// Exige Content-Length válido: sem ele (chunked) o corpo inteiro seria lido em memória antes do limite.
export function checkAvatarContentLength(header: string | null): AvatarUploadIssue | null {
  const declared = Number(header);
  if (!Number.isFinite(declared) || declared <= 0) return { status: 411, message: "Requisição inválida." };
  if (declared > AVATAR_MAX_UPLOAD_BYTES + AVATAR_MULTIPART_OVERHEAD_BYTES) return { status: 413, message: "A imagem deve ter até 5 MB." };
  return null;
}

export function checkAvatarFile(file: { type: string; size: number } | null | undefined): AvatarUploadIssue | null {
  if (!file || !AVATAR_ALLOWED_TYPES.has(file.type)) return { status: 400, message: "Envie uma imagem (JPG, PNG ou WebP)." };
  if (file.size > AVATAR_MAX_UPLOAD_BYTES) return { status: 413, message: "A imagem deve ter até 5 MB." };
  return null;
}
