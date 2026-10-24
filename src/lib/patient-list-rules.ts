// Parâmetros de paginação de listas do servidor. Valores inválidos viram valores seguros (sem 400): a lista sempre responde.
export const maxPageNumber = 100_000;

export type PageParams = { page: number; pageSize: number };

function positiveInteger(value: string | null | undefined) {
  if (value === null || value === undefined || !/^\s*\d+\s*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

// page < 1 ou não numérica => 1; pageSize não numérico/< 1 => padrão; pageSize acima do limite => limite.
export function parsePageParams(params: { get(name: string): string | null }, options: { defaultPageSize?: number; maxPageSize?: number } = {}): PageParams {
  const maxPageSize = options.maxPageSize ?? 100;
  const defaultPageSize = Math.min(options.defaultPageSize ?? 20, maxPageSize);
  const page = Math.min(maxPageNumber, positiveInteger(params.get("page")) ?? 1);
  const pageSize = Math.min(maxPageSize, positiveInteger(params.get("pageSize")) ?? defaultPageSize);
  return { page, pageSize };
}

export function paginationMeta(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, pageCount: Math.ceil(total / pageSize) };
}

// Lista de clientes paginada no servidor. Campos pesquisáveis (iguais aos da tela antiga): nome, telefone e status.
export const patientPageSizes = [10, 20, 50, 100];
export const defaultPatientPageSize = 20;
export const maxPatientPageSize = 100;
export const patientSorts = ["name", "recent"] as const;
export type PatientSort = (typeof patientSorts)[number];
export const maxPatientSearchLength = 100;
export const patientLookupDefaultLimit = 8;
export const patientLookupMaxLimit = 20;
// Seletores só pesquisam com 2+ caracteres (1 letra devolve quase a clínica inteira).
export const patientLookupMinLength = 2;

export type PatientListQuery = PageParams & { q: string; status: string; sort: PatientSort };

// Mesmo mapeamento usado no SQL (translate) para busca sem acento nem caixa.
export const accentFrom = "áàâãäåÁÀÂÃÄÅéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇñÑ";
export const accentTo = "aaaaaaAAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcCnN";

export function normalizeSearchText(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
}

// Texto digitado -> termo enviado ao servidor (sem espaços nas pontas, limitado).
// Remove caracteres de controle (inclui o byte nulo, que o Postgres recusa) antes de qualquer uso no SQL.
export function stripControlChars(value: string) {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
}

export function cleanSearchQuery(value: string | null | undefined) {
  return stripControlChars(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxPatientSearchLength);
}

// Dígitos da busca quando ela é só número/pontuação (CPF, telefone) e tem 3+ dígitos; senão "" (busca por texto).
export function searchDigits(value: string) {
  // Só dígitos e a pontuação de CPF/telefone; qualquer outro símbolo (%, _, letras) mantém a busca por texto.
  if (!/^[\d\s().+\-/]+$/.test(value)) return "";
  const digits = value.replace(/\D/g, "");
  return digits.length >= 3 ? digits : "";
}

// Busca por CPF no lookup. ADMIN/PROFESSIONAL: trecho de 3+ dígitos. STAFF (vê o CPF mascarado): só o CPF inteiro (11 dígitos,
// comparação exata), para a busca parcial não revelar o CPF dígito a dígito; abaixo disso, só nome. Sem limite de tentativas
// (residual aceito por ora): quem já sabe o CPF completo só confirma se o cliente existe.
export function cpfSearchPlan(query: string, fullAccess: boolean): { digits: string; exact: boolean } | null {
  const digits = searchDigits(query);
  if (!digits) return null;
  if (fullAccess) return { digits, exact: false };
  return digits.length === 11 ? { digits, exact: true } : null;
}

// Ids de paciente são cuid; qualquer outra forma (byte nulo, "../", 5000 letras) nem chega ao banco.
export function isPatientIdFormat(value: string) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function parsePatientListQuery(params: { get(name: string): string | null }): PatientListQuery {
  const sort = params.get("sort");
  return {
    ...parsePageParams(params, { defaultPageSize: defaultPatientPageSize, maxPageSize: maxPatientPageSize }),
    q: cleanSearchQuery(params.get("q")),
    status: stripControlChars(params.get("status") ?? "").trim().slice(0, 40),
    sort: (patientSorts as readonly string[]).includes(sort ?? "") ? sort as PatientSort : "name",
  };
}

export function parsePatientLookupLimit(value: string | null) {
  const parsed = /^\d+$/.test(value ?? "") ? Number(value) : patientLookupDefaultLimit;
  return Math.min(patientLookupMaxLimit, Math.max(1, parsed || patientLookupDefaultLimit));
}

// Chave estável do cache cliente: mesma consulta => mesma chave, ordem fixa dos parâmetros.
export function patientListKey(query: Partial<PatientListQuery> = {}) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? defaultPatientPageSize;
  const q = cleanSearchQuery(query.q);
  const status = (query.status ?? "").trim();
  return `/api/patients?page=${page}&pageSize=${pageSize}${q ? `&q=${encodeURIComponent(q)}` : ""}${status ? `&status=${encodeURIComponent(status)}` : ""}&sort=${query.sort ?? "name"}`;
}

export function patientLookupKey(q: string, limit = patientLookupDefaultLimit) {
  return `/api/patients/lookup?q=${encodeURIComponent(cleanSearchQuery(q))}&limit=${limit}`;
}
