// Regras puras de documentos clínicos e fotos: categorias, permissões por papel, validação de upload (assinatura de bytes) e nomes.

export const documentCategories = ["TERMOS", "EXAMES", "RECEITAS", "ORIENTACOES", "DECLARACOES", "OUTROS"] as const;
export type DocumentCategory = typeof documentCategories[number];

export const documentCategoryLabels: Record<DocumentCategory, string> = {
  TERMOS: "Termos e consentimentos",
  EXAMES: "Exames e laudos",
  RECEITAS: "Receitas e prescrições",
  ORIENTACOES: "Orientações",
  DECLARACOES: "Declarações",
  OUTROS: "Outros",
};

export const signatureStatuses = ["NAO_APLICAVEL", "PENDENTE", "ASSINADO"] as const;
export type SignatureStatus = typeof signatureStatuses[number];
export const signatureLabels: Record<SignatureStatus, string> = { NAO_APLICAVEL: "Não se aplica", PENDENTE: "Pendente", ASSINADO: "Assinado" };

export const photoPhases = ["ANTES", "DEPOIS", "EVOLUCAO", "OUTRA"] as const;
export type PhotoPhase = typeof photoPhases[number];
export const photoCategoryNames = ["Frontal", "Perfil direito", "Perfil esquerdo", "Sorriso", "Outra"] as const;

export const maxUploadBytes = 4 * 1024 * 1024;
export const maxNameLength = 160;

export function isDocumentCategory(value: unknown): value is DocumentCategory {
  return typeof value === "string" && (documentCategories as readonly string[]).includes(value);
}
export function isSignatureStatus(value: unknown): value is SignatureStatus {
  return typeof value === "string" && (signatureStatuses as readonly string[]).includes(value);
}
export function isPhotoPhase(value: unknown): value is PhotoPhase {
  return typeof value === "string" && (photoPhases as readonly string[]).includes(value);
}

// Papéis clínicos (espelha clinical:read/write de permissions.ts; um teste garante a equivalência). Sem import para o módulo seguir carregável por node:test.
const clinicalRole = (role: string | null | undefined) => role === "ADMIN" || role === "PROFESSIONAL";

// STAFF só lida com documentos administrativos; o restante é clínico e exige clinical:read.
const administrativeCategories: readonly DocumentCategory[] = ["TERMOS", "DECLARACOES", "ORIENTACOES"];

export function visibleDocumentCategories(role: string | null | undefined): DocumentCategory[] {
  if (clinicalRole(role)) return [...documentCategories];
  if (role === "STAFF") return [...administrativeCategories];
  return [];
}
export function canViewDocumentCategory(role: string | null | undefined, category: string) {
  return (visibleDocumentCategories(role) as string[]).includes(category);
}
// Enviar, renomear, categorizar e vincular: mesma regra de visibilidade (a categoria de destino também precisa ser permitida).
export const canWriteDocumentCategory = canViewDocumentCategory;
// Marcar um termo como Assinado é ato clínico: STAFF envia termos, mas só como Pendente/Não se aplica.
export function canAssignSignatureStatus(role: string | null | undefined, category: string, status: string) {
  return !(category === "TERMOS" && status === "ASSINADO") || clinicalRole(role);
}
type SignedTermFields = { category: string; signatureStatus?: string | null; journeyId: string | null; encounterType: string | null; encounterId: string | null };
// Termo TERMOS já ASSINADO: papel não clínico (STAFF) só pode renomear. Status, categoria e vínculos (inclusive remover) ficam travados,
// senão o termo sairia da jornada/categoria que libera o início do procedimento. Mudar de dono de jornada liberaria o gate de outra.
export function canModifySignedTerm(role: string | null | undefined, current: SignedTermFields, next: SignedTermFields) {
  if (clinicalRole(role)) return true;
  if (current.category !== "TERMOS" || current.signatureStatus !== "ASSINADO") return true;
  return current.category === next.category && current.signatureStatus === next.signatureStatus && current.journeyId === next.journeyId
    && current.encounterType === next.encounterType && current.encounterId === next.encounterId;
}
export function signatureStatusesFor(role: string | null | undefined, category = "TERMOS"): SignatureStatus[] {
  return signatureStatuses.filter((status) => canAssignSignatureStatus(role, category, status));
}
export const canArchiveFiles = (role: string | null | undefined) => clinicalRole(role);
export const canDeleteFiles = (role: string | null | undefined) => role === "ADMIN";
export const canUsePhotos = (role: string | null | undefined) => clinicalRole(role);
export const canWritePhotos = (role: string | null | undefined) => clinicalRole(role);
// Itens de sistema por referência seguem a permissão da origem.
export function canSeeSystemDocument(role: string | null | undefined, kind: "anamnesis" | "evaluation") {
  return clinicalRole(role) && (kind === "anamnesis" || kind === "evaluation");
}

// ---- Validação de arquivo ----

export type DetectedFile = { mime: "application/pdf" | "image/jpeg" | "image/png" | "image/webp"; ext: "pdf" | "jpg" | "png" | "webp"; isImage: boolean };

// Detecta o tipo pelos primeiros bytes (nunca confia na extensão nem no MIME enviado).
export function detectFileType(bytes: Uint8Array): DetectedFile | null {
  const at = (index: number) => bytes[index];
  if (bytes.length >= 5 && at(0) === 0x25 && at(1) === 0x50 && at(2) === 0x44 && at(3) === 0x46 && at(4) === 0x2d) return { mime: "application/pdf", ext: "pdf", isImage: false };
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return { mime: "image/jpeg", ext: "jpg", isImage: true };
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => at(index) === value)) return { mime: "image/png", ext: "png", isImage: true };
  if (bytes.length >= 12 && at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return { mime: "image/webp", ext: "webp", isImage: true };
  return null;
}

export type UploadCheck = { ok: true; file: DetectedFile } | { ok: false; message: string; status: 400 | 413 | 415 };

export function checkUpload(bytes: Uint8Array, declaredMime: string | undefined, options: { imageOnly?: boolean } = {}): UploadCheck {
  if (bytes.length === 0) return { ok: false, status: 400, message: "O arquivo está vazio." };
  if (bytes.length > maxUploadBytes) return { ok: false, status: 413, message: "O arquivo excede 4 MB." };
  const file = detectFileType(bytes);
  if (!file) return { ok: false, status: 415, message: "Formato não permitido. Envie PDF, JPG, PNG ou WEBP." };
  if (options.imageOnly && !file.isImage) return { ok: false, status: 415, message: "Fotos precisam ser imagens JPG, PNG ou WEBP." };
  // O MIME declarado, quando existe e é um dos permitidos, precisa concordar com o conteúdo.
  const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  if (declaredMime && allowed.includes(declaredMime) && declaredMime !== file.mime) return { ok: false, status: 415, message: "O conteúdo do arquivo não corresponde ao tipo informado." };
  return { ok: true, file };
}

// Remove caminhos, caracteres de controle e separadores; limita o tamanho. Nunca devolve vazio.
export function sanitizeFileName(value: unknown, fallback = "arquivo") {
  const text = typeof value === "string" ? value : "";
  const base = text.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/\s+/g, " ").replace(/^\.+/, "").trim();
  return (cleaned || fallback).slice(0, maxNameLength);
}

// Nome exibido: sem a extensão, editável pelo usuário (a extensão real vem do conteúdo).
export function displayNameFromFile(fileName: string) {
  const clean = sanitizeFileName(fileName);
  return clean.replace(/\.(pdf|jpe?g|png|webp)$/i, "") || clean;
}
export function cleanDisplayName(value: unknown) {
  const name = sanitizeFileName(value, "");
  return name || null;
}

export function contentDisposition(name: string, ext: string, download: boolean) {
  const safe = `${sanitizeFileName(name).replace(/\.(pdf|jpe?g|png|webp)$/i, "")}.${ext}`;
  const ascii = safe.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_");
  return `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

// ---- Listagem ----

export type DocumentSort = "recent" | "oldest" | "name";
export type DocumentListQuery = {
  category: DocumentCategory | null; q: string; professional: string; from: Date | null; to: Date | null;
  journeyId: string; sort: DocumentSort; page: number; pageSize: number; archived: boolean;
};
export const documentPageSizes = [9, 18, 36];
export const photoPageSizes = [9, 18, 36];

export function parseDocumentQuery(params: URLSearchParams): DocumentListQuery {
  const category = params.get("category");
  const date = (value: string | null, endOfDay: boolean) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}-03:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const sort = params.get("sort");
  const pageSize = Number(params.get("pageSize"));
  const page = Number(params.get("page"));
  return {
    category: isDocumentCategory(category) ? category : null,
    q: (params.get("q") ?? "").trim().slice(0, 100),
    professional: (params.get("professional") ?? "").trim().slice(0, 120),
    from: date(params.get("from"), false), to: date(params.get("to"), true),
    journeyId: (params.get("journeyId") ?? "").slice(0, 60),
    sort: sort === "oldest" || sort === "name" ? sort : "recent",
    page: Number.isInteger(page) && page >= 1 ? Math.min(page, 10_000) : 1,
    pageSize: documentPageSizes.includes(pageSize) ? pageSize : 9,
    archived: params.get("archived") === "1",
  };
}

export type SystemDocumentItem = {
  id: string; system: true; kind: "anamnesis" | "evaluation"; name: string; category: DocumentCategory; date: string; professional: string; status: string; originRef: string;
};

// Itens de sistema entram na lista por referência: a mesma busca/filtro/ordem dos enviados, somente leitura.
export function filterSystemDocuments(items: SystemDocumentItem[], query: Pick<DocumentListQuery, "category" | "q" | "professional" | "from" | "to" | "journeyId">, allowedCategories: readonly string[]) {
  const text = query.q.toLocaleLowerCase("pt-BR");
  const professional = query.professional.toLocaleLowerCase("pt-BR");
  return items.filter((item) => {
    if (!allowedCategories.includes(item.category)) return false;
    if (query.journeyId) return false;
    if (query.category && item.category !== query.category) return false;
    if (text && !item.name.toLocaleLowerCase("pt-BR").includes(text)) return false;
    if (professional && !item.professional.toLocaleLowerCase("pt-BR").includes(professional)) return false;
    const time = new Date(item.date).getTime();
    if (query.from && time < query.from.getTime()) return false;
    if (query.to && time > query.to.getTime()) return false;
    return true;
  });
}

export function sortByDate<T extends { date: string; name: string }>(items: T[], sort: DocumentSort) {
  const copy = [...items];
  if (sort === "name") return copy.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return copy.sort((a, b) => sort === "oldest" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export type FileAuditAction = "UPLOAD" | "VIEW" | "DOWNLOAD" | "RENAME" | "RECATEGORIZE" | "LINK" | "SIGNATURE" | "ARCHIVE" | "UNARCHIVE" | "DELETE";

// Quais ações de edição um PATCH representa (para a trilha de auditoria).
export function editActions(before: { name: string; category: string; journeyId: string | null; encounterType: string | null; encounterId: string | null; signatureStatus?: string }, after: typeof before): FileAuditAction[] {
  const actions: FileAuditAction[] = [];
  if (before.name !== after.name) actions.push("RENAME");
  if (before.category !== after.category) actions.push("RECATEGORIZE");
  if (before.journeyId !== after.journeyId || before.encounterType !== after.encounterType || before.encounterId !== after.encounterId) actions.push("LINK");
  if (before.signatureStatus !== after.signatureStatus) actions.push("SIGNATURE");
  return actions;
}

// Resumo do consentimento da jornada a partir dos termos anexados. "Assinado" só quando algum termo está marcado assim.
export function summarizeConsent(terms: ReadonlyArray<{ signatureStatus?: string | null }>) {
  const signed = terms.filter((term) => term.signatureStatus === "ASSINADO").length;
  const label = !terms.length ? "Nenhum termo anexado"
    : signed === terms.length ? (terms.length === 1 ? "Assinado" : `Assinado (${terms.length} termos)`)
      : signed > 0 ? `${signed} de ${terms.length} termos assinados`
        : terms.length === 1 ? "1 termo anexado" : `${terms.length} termos anexados`;
  return { total: terms.length, signed, label };
}
