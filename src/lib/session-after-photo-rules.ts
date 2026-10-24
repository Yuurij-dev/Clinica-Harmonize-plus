// Regras puras do envio de UMA foto "Imediatamente após" à sessão do procedimento (app mobile). Sem imports: carregável direto pelo node:test.
export const afterPhase = "Imediatamente após";
export const maxSessionPhotos = 20; // mesmo limite do PATCH da sessão (validateSessionPayload)
export const sessionNotStartedMessage = "O procedimento ainda não foi iniciado.";

export type SessionPhotoEntry = { id: string; phase: string; name: string; category: string; width: number; height: number; imageUrl: string };
export type AppendResult = { ok: true; json: string; count: number } | { ok: false; status: 409; message: string };

// Acrescenta a foto ao JSON gravado sem tocar nas existentes. JSON ilegível nunca é sobrescrito (não perde fotos), e o limite é o do PATCH.
export function appendAfterPhoto(stored: string, photo: SessionPhotoEntry): AppendResult {
  let list: unknown;
  try { list = JSON.parse(stored); } catch { list = null; }
  if (!Array.isArray(list)) return { ok: false, status: 409, message: "As fotos da sessão estão ilegíveis. Abra a sessão no sistema." };
  if (list.length >= maxSessionPhotos) return { ok: false, status: 409, message: `A sessão já tem o máximo de ${maxSessionPhotos} fotos.` };
  return { ok: true, json: JSON.stringify([...list, photo]), count: list.length + 1 };
}

// PATCH/PUT do web substituem a lista inteira. Com `knownIds` (fotos que o cliente já conhecia), qualquer foto armazenada que o cliente
// NÃO conhecia e que NÃO veio na lista (ex.: enviada pelo app depois do carregamento) é mantida; o que o cliente conhecia e omitiu foi removido por ele.
// Sem knownIds (cliente antigo), nada muda. Devolve as fotos armazenadas a preservar, na ordem do armazenamento.
export function unknownStoredPhotos<T extends { id?: unknown }>(stored: readonly T[], sentIds: Iterable<string>, knownIds: readonly string[] | undefined): T[] {
  if (!knownIds) return [];
  const skip = new Set<string>([...sentIds, ...knownIds]);
  return stored.filter((photo) => typeof photo?.id === "string" && photo.id !== "" && !skip.has(photo.id));
}

export const maxKnownPhotoIds = 500;
export const maxPhotoIdLength = 64;
// knownPhotoIds do corpo: ausente = undefined (cliente antigo); presente porém malformado = erro (400), nunca ignorado em silêncio.
export function parseKnownPhotoIds(value: unknown): { ok: true; ids: string[] | undefined } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, ids: undefined };
  if (!Array.isArray(value) || value.length > maxKnownPhotoIds || value.some((id) => typeof id !== "string" || id.length > maxPhotoIdLength)) return { ok: false, message: "Lista de fotos conhecidas inválida." };
  return { ok: true, ids: value as string[] };
}

// Total final (enviadas + mantidas) acima do teto: 409 em vez de descartar foto em silêncio.
export const photosOverLimit = (sent: number, kept: number, max: number) => sent + kept > max;
