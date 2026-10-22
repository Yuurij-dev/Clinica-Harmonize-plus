// Regras puras do cadastro de procedimentos: busca no catálogo e validação do payload de criação/edição.
// Preço, duração, margem, ficha técnica e nome são sempre por clínica; o catálogo só fornece nome inicial e imagem.

export const maxProcedureNameLength = 120;
export const maxCategoryLength = 60;
// Tetos do domínio (e abaixo do Int32 do banco): preço em reais inteiros até R$ 100.000.000; duração até 24 h.
export const maxPriceReais = 100_000_000;
export const maxDurationMinutes = 1440;

// Formato aceito para ids de procedimento/imagem/catálogo (cuid, uuid sem hífen, "cat_<slug>"). Qualquer outra coisa nem chega ao Prisma.
export const isValidId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);

// Minúsculas, sem acento, espaços colapsados: base da busca e da comparação de nomes.
export function normalizeSearch(value: unknown) {
  return (typeof value === "string" ? value : "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
}

export function filterCatalog<T extends { name: string; slug: string }>(items: readonly T[], query: unknown): T[] {
  const terms = normalizeSearch(query).split(" ").filter(Boolean);
  if (!terms.length) return [...items];
  return items.filter((item) => {
    const haystack = `${normalizeSearch(item.name)} ${item.slug.replace(/-/g, " ")}`;
    return terms.every((term) => haystack.includes(term));
  });
}

export function parseCatalogListParams(params: URLSearchParams) {
  const limit = Number(params.get("limit"));
  const offset = Number(params.get("offset"));
  return {
    q: (params.get("q") ?? "").slice(0, 100),
    limit: Number.isInteger(limit) && limit >= 1 ? Math.min(limit, 100) : 100,
    offset: Number.isInteger(offset) && offset >= 0 ? Math.min(offset, 10_000) : 0,
  };
}

type Common = { category: string; price: number; durationMinutes: number; margin: number };
export type CreateProcedureInput =
  | ({ mode: "catalog"; catalogItemId: string } & Common)
  | ({ mode: "custom"; name: string; imageAssetId: string | null; catalogImageId: string | null } & Common);
export type ParseResult<T> = { ok: true; data: T } | { ok: false; message: string };

const idOf = (value: unknown) => isValidId(value) ? value : null;
const categoryOf = (value: unknown) => typeof value === "string" ? value.trim().slice(0, maxCategoryLength) : "";

// Número vindo do JSON: número finito ou texto decimal simples ("12", "12.5"). Rejeita " ", "0x10", "1e3", booleanos, listas e objetos.
export function parseNumeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && /^\s*[+-]?\d+(\.\d+)?\s*$/.test(value)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

// Preço em reais inteiros (centavos arredondam), nunca negativo.
export function parsePrice(value: unknown): ParseResult<number> {
  const number = parseNumeric(value);
  if (number === null) return { ok: false, message: "Informe um preço válido." };
  const price = Math.max(0, Math.round(number));
  if (price > maxPriceReais) return { ok: false, message: `O preço máximo é R$ ${maxPriceReais.toLocaleString("pt-BR")}.` };
  return { ok: true, data: price };
}
// Minutos inteiros, mínimo 1.
export function parseDuration(value: unknown): ParseResult<number> {
  const number = parseNumeric(value);
  if (number === null || !Number.isInteger(number)) return { ok: false, message: "Informe a duração em minutos inteiros." };
  if (number > maxDurationMinutes) return { ok: false, message: `A duração máxima é ${maxDurationMinutes} minutos.` };
  return { ok: true, data: Math.max(1, number) };
}
// Margem em %, ajustada para 0–100 (valor numérico fora da faixa é limitado, não recusado).
export function parseMargin(value: unknown): ParseResult<number> {
  const number = parseNumeric(value);
  if (number === null) return { ok: false, message: "Informe uma margem válida." };
  return { ok: true, data: Math.max(0, Math.min(100, number)) };
}

// Nome: texto, espaços/quebras internas colapsam; recusa NUL e demais caracteres de controle e substitutos Unicode soltos.
export function parseName(value: unknown): ParseResult<string> {
  if (typeof value !== "string") return { ok: false, message: "Informe o nome do procedimento." };
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, message: "Informe o nome do procedimento." };
  if (name.length > maxProcedureNameLength) return { ok: false, message: `O nome deve ter até ${maxProcedureNameLength} caracteres.` };
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name) || !name.isWellFormed()) return { ok: false, message: "O nome contém caracteres inválidos." };
  return { ok: true, data: name };
}

// Duas formas de escolher imagem, mutuamente exclusivas: enviada (imageAssetId) ou da biblioteca do catálogo (catalogImageId).
function parseImageChoice(body: Record<string, unknown>): ParseResult<{ assetId: string | null; catalogImageId: string | null }> {
  const assetId = body.imageAssetId == null ? null : idOf(body.imageAssetId);
  const catalogImageId = body.catalogImageId == null ? null : idOf(body.catalogImageId);
  if ((body.imageAssetId != null && !assetId) || (body.catalogImageId != null && !catalogImageId)) return { ok: false, message: "Imagem inválida." };
  if (assetId && catalogImageId) return { ok: false, message: "Escolha só uma imagem: enviada ou da biblioteca." };
  return { ok: true, data: { assetId, catalogImageId } };
}

// Aceita { catalogItemId, ... } (habilitar do catálogo) OU { custom: true, name, imageAssetId? | catalogImageId?, ... }. "category" é opcional e legada.
// Sem catalogItemId o procedimento é sempre personalizado (compatível com clientes antigos que só enviam name).
// catalogItemId presente porém malformado (não texto, vazio, >100, caracteres estranhos) é recusado, nunca vira personalizado.
export function parseCreateProcedure(body: Record<string, unknown> | null): ParseResult<CreateProcedureInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, message: "Preencha os dados do procedimento." };
  const price = parsePrice(body.price);
  if (!price.ok) return price;
  const durationMinutes = parseDuration(body.durationMinutes);
  if (!durationMinutes.ok) return durationMinutes;
  const margin = parseMargin(body.margin);
  if (!margin.ok) return margin;
  const common: Common = { category: categoryOf(body.category), price: price.data, durationMinutes: durationMinutes.data, margin: margin.data };
  if (body.catalogItemId !== undefined && body.catalogItemId !== null) {
    const catalogItemId = idOf(body.catalogItemId);
    if (!catalogItemId) return { ok: false, message: "Procedimento do catálogo inválido." };
    return { ok: true, data: { mode: "catalog", catalogItemId, ...common } };
  }
  const name = parseName(body.name);
  if (!name.ok) return name;
  const image = parseImageChoice(body);
  if (!image.ok) return image;
  return { ok: true, data: { mode: "custom", name: name.data, imageAssetId: image.data.assetId, catalogImageId: image.data.catalogImageId, ...common } };
}

// undefined = não alterar. "image" só existe quando o corpo mexe na imagem: null/null remove a escolha da clínica
// (volta à imagem do catálogo habilitado, se houver, ou ao placeholder).
export type PatchProcedureInput = {
  name?: string; category?: string; price?: number; durationMinutes?: number; margin?: number;
  image?: { assetId: string | null; catalogImageId: string | null };
};

// Campo enviado (mesmo null ou vazio) e inválido → 400; só campo ausente (undefined) é ignorado.
export function parsePatchProcedure(body: Record<string, unknown> | null): ParseResult<PatchProcedureInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, message: "Dados inválidos." };
  const data: PatchProcedureInput = {};
  if (body.name !== undefined) {
    const name = parseName(body.name);
    if (!name.ok) return name;
    data.name = name.data;
  }
  if (body.category !== undefined) {
    if (typeof body.category !== "string") return { ok: false, message: "Categoria inválida." };
    data.category = categoryOf(body.category);
  }
  if (body.price !== undefined) {
    const price = parsePrice(body.price);
    if (!price.ok) return price;
    data.price = price.data;
  }
  if (body.durationMinutes !== undefined) {
    const duration = parseDuration(body.durationMinutes);
    if (!duration.ok) return duration;
    data.durationMinutes = duration.data;
  }
  if (body.margin !== undefined) {
    const margin = parseMargin(body.margin);
    if (!margin.ok) return margin;
    data.margin = margin.data;
  }
  if (body.imageAssetId !== undefined || body.catalogImageId !== undefined) {
    const image = parseImageChoice(body);
    if (!image.ok) return image;
    data.image = image.data;
  }
  return { ok: true, data };
}
