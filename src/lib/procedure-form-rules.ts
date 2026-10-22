// Regras puras do formulário de procedimentos (interface): validação de arquivo e campos, e montagem dos corpos de POST/PATCH.
// Imagens sempre por referência (id do catálogo ou id do upload), nunca por nome nem em base64.
// Sem imports de outros módulos para os testes node rodarem direto; testes garantem que estes valores seguem iguais aos de procedure-catalog-rules.
const maxProcedureNameLength = 120;
export const procedureNameKey = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();

export const maxImageBytes = 4 * 1024 * 1024;
export const allowedImageTypes = ["image/jpeg", "image/png", "image/webp"] as const;

// Mensagem de erro (ou null se válido). O servidor valida de novo pelos bytes; aqui é só resposta rápida.
export function validateImageFile(file: { type: string; size: number }): string | null {
  if (!(allowedImageTypes as readonly string[]).includes(file.type)) return "Use uma imagem JPEG, PNG ou WebP.";
  if (file.size <= 0) return "O arquivo está vazio.";
  if (file.size > maxImageBytes) return "A imagem excede 4 MB. Escolha um arquivo menor.";
  return null;
}

export type ImageChoice =
  | { kind: "keep" }
  | { kind: "none" }
  | { kind: "library"; catalogImageId: string }
  | { kind: "upload"; assetId: string };

// Campos de imagem do corpo; "keep" não envia nada (no PATCH não mexe; no POST equivale a sem imagem).
export function imageFields(choice: ImageChoice): { imageAssetId?: string | null; catalogImageId?: string | null } {
  if (choice.kind === "none") return { imageAssetId: null, catalogImageId: null };
  if (choice.kind === "library") return { catalogImageId: choice.catalogImageId };
  if (choice.kind === "upload") return { imageAssetId: choice.assetId };
  return {};
}

export type ProcedureFields = {
  price: number;
  durationMinutes: number;
  margin: number;
  technicalSheet: Array<{ productId: string; quantity: number }>;
};

export const maxDurationMinutes = 1440;

export type FieldProblem = { field: "name" | "price" | "duration" | "margin"; message: string };

export function findFieldProblem(input: { name?: string; durationMinutes: number; margin: number; price: number }): FieldProblem | null {
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { field: "name", message: "Informe o nome do procedimento." };
    if (name.length > maxProcedureNameLength) return { field: "name", message: `O nome deve ter até ${maxProcedureNameLength} caracteres.` };
  }
  if (!Number.isFinite(input.price) || input.price < 0) return { field: "price", message: "Informe um valor sugerido válido." };
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 1) return { field: "duration", message: "A duração deve ser de pelo menos 1 minuto." };
  if (!Number.isFinite(input.margin) || input.margin < 0 || input.margin > 100) return { field: "margin", message: "A margem deve ficar entre 0% e 100%." };
  if (input.durationMinutes > maxDurationMinutes) return { field: "duration", message: "A duração máxima é 1440 minutos." };
  return null;
}

export function validateProcedureFields(input: { name?: string; durationMinutes: number; margin: number; price: number }): string | null {
  return findFieldProblem(input)?.message ?? null;
}

// Upload recusado por tipo/tamanho: mensagem própria do cliente (o texto do servidor pode citar outros formatos).
export function uploadErrorMessage(status: number, serverMessage?: string | null) {
  if (status === 413 || status === 415) return "Use uma imagem JPEG, PNG ou WebP de até 4 MB.";
  return serverMessage || "Não foi possível enviar a imagem.";
}

// Termos alternativos (sem acento) -> slugs REAIS do catálogo (public/images/procedimentos/manifest.json).
export const catalogSynonyms: Readonly<Record<string, readonly string[]>> = {
  toxina: ["botox"], "toxina botulinica": ["botox"], botulinica: ["botox"],
  olheira: ["preenchimento-de-olheiras"], olheiras: ["preenchimento-de-olheiras"],
  labio: ["preenchimento-labial"], labios: ["preenchimento-labial"],
  colageno: ["bioestimulador-de-colageno"],
  fio: ["fios-de-sustentacao"], fios: ["fios-de-sustentacao"],
  acne: ["tratamento-para-acne"], led: ["ledterapia"],
  peeling: ["peelings-quimicos"], peelings: ["peelings-quimicos"],
  celulite: ["tratamento-para-celulite"], flacidez: ["tratamento-para-flacidez"],
  mancha: ["tratamento-para-manchas"], manchas: ["tratamento-para-manchas"],
  cicatriz: ["tratamento-para-cicatrizes"], cicatrizes: ["tratamento-para-cicatrizes"],
  suor: ["tratamento-para-suor-excessivo"], capilar: ["tratamento-capilar"], cabelo: ["tratamento-capilar"],
};

// Busca local: termos por nome/slug (todos precisam casar) OU sinônimo; só devolve itens que existem na lista.
export function searchCatalog<T extends { name: string; slug: string }>(items: readonly T[], query: unknown): T[] {
  const key = procedureNameKey(typeof query === "string" ? query : "");
  if (!key) return [...items];
  const terms = key.split(" ");
  const synonymSlugs = new Set<string>();
  for (const [term, slugs] of Object.entries(catalogSynonyms)) {
    if (term === key || (key.length >= 3 && term.startsWith(key))) for (const slug of slugs) synonymSlugs.add(slug);
  }
  return items.filter((item) => {
    const haystack = `${procedureNameKey(item.name)} ${item.slug.replace(/-/g, " ")}`;
    return synonymSlugs.has(item.slug) || terms.every((term) => haystack.includes(term));
  });
}

export function nameAlreadyUsed(name: string, existing: ReadonlyArray<{ id?: string; name: string }>, exceptId?: string) {
  const target = procedureNameKey(name);
  return Boolean(target) && existing.some((item) => item.id !== exceptId && procedureNameKey(item.name) === target);
}

export function buildCatalogCreateBody(catalogItemId: string, fields: ProcedureFields) {
  return { catalogItemId, ...fields };
}

export function buildCustomCreateBody(name: string, image: ImageChoice, fields: ProcedureFields) {
  return { custom: true as const, name: name.trim().replace(/\s+/g, " "), ...imageFields(image), ...fields };
}

export function buildPatchBody(name: string, image: ImageChoice, fields: ProcedureFields) {
  return { name: name.trim().replace(/\s+/g, " "), ...imageFields(image), ...fields };
}
