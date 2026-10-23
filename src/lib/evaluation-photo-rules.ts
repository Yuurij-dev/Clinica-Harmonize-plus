// Regras puras do envio de UMA foto à avaliação (app mobile): validação do formulário e escolha da avaliação alvo.
// Sem imports: carregável direto pelo node:test (um teste confere a lista com photoCategoryNames).
export const evaluationPhotoCategories = ["Frontal", "Perfil direito", "Perfil esquerdo", "Sorriso", "Outra"] as const;
export const maxEvaluationPhotos = 20; // mesmo limite do PUT da avaliação
export const maxPhotoSide = 8000;
export const maxPhotoPixels = 25_000_000;
export const draftStatus = "Rascunho";

export type EvaluationPhotoInput = { category: string; width: number; height: number; name: string; evaluationId: string | null; journeyId: string | null };
export type FormResult = { ok: true; value: EvaluationPhotoInput } | { ok: false; status: 400; message: string };

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
// Inteiro decimal puro ("12"), sem "1e3", "0x10", "12.5" nem vazio.
const parseInteger = (value: unknown) => (typeof value === "string" && /^\d{1,5}$/.test(value.trim()) ? Number(value.trim()) : NaN);

export function parseEvaluationPhotoFields(fields: { category?: unknown; width?: unknown; height?: unknown; name?: unknown; evaluationId?: unknown; journeyId?: unknown }): FormResult {
  const category = text(fields.category) || "Outra";
  if (!(evaluationPhotoCategories as readonly string[]).includes(category)) return { ok: false, status: 400, message: "Categoria inválida." };
  const width = parseInteger(fields.width);
  const height = parseInteger(fields.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > maxPhotoSide || height > maxPhotoSide || width * height > maxPhotoPixels) {
    return { ok: false, status: 400, message: "Dimensões da imagem inválidas." };
  }
  return { ok: true, value: { category, width, height, name: text(fields.name), evaluationId: text(fields.evaluationId) || null, journeyId: text(fields.journeyId) || null } };
}

export type TargetDecision =
  | { action: "use"; evaluationId: string }
  | { action: "create" }
  | { action: "notFound" }
  | { action: "closed" };

// requestedId: avaliação pedida pelo app (já buscada, escopada por clínica/paciente); latestDraft: rascunho mais recente da jornada.
export function decideTargetEvaluation(input: { requestedId: string | null; requested: { id: string; status: string } | null; latestDraft: { id: string } | null }): TargetDecision {
  if (input.requestedId) {
    if (!input.requested) return { action: "notFound" };
    return input.requested.status === draftStatus ? { action: "use", evaluationId: input.requested.id } : { action: "closed" };
  }
  return input.latestDraft ? { action: "use", evaluationId: input.latestDraft.id } : { action: "create" };
}

export const evaluationPhotosFull = (count: number) => count >= maxEvaluationPhotos;

const tolerance = 0.1;
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(2, b * tolerance);

// Dimensões a gravar: as reais dos bytes quando conhecidas (rejeita fora dos limites ou muito diferentes das declaradas, aceitando a declarada
// com lados trocados por orientação EXIF); sem leitura dos bytes, mantém as declaradas.
export function resolvePhotoDimensions(declared: { width: number; height: number }, actual: { width: number; height: number } | null): { ok: true; width: number; height: number } | { ok: false; message: string } {
  if (!actual) return { ok: true, ...declared };
  if (actual.width < 1 || actual.height < 1 || actual.width > maxPhotoSide || actual.height > maxPhotoSide || actual.width * actual.height > maxPhotoPixels) {
    return { ok: false, message: "Dimensões da imagem inválidas." };
  }
  const matches = (close(declared.width, actual.width) && close(declared.height, actual.height)) || (close(declared.width, actual.height) && close(declared.height, actual.width));
  return matches ? { ok: true, width: actual.width, height: actual.height } : { ok: false, message: "As dimensões informadas não correspondem à imagem." };
}
