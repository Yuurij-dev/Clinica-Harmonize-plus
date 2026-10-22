// Resolução da imagem de um procedimento POR ID (nunca pelo nome). Regras puras, sem acesso a banco.
// Precedência: imagem personalizada enviada (assetId) > imagem escolhida da biblioteca > imagem do item do catálogo habilitado > nenhuma (placeholder).

// Mesma normalização de procedure-catalog-rules.normalizeSearch (sem import para os testes node rodarem sem resolver extensões; um teste garante a igualdade).
export const procedureNameKey = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();

export type ProcedureImageKind = "custom" | "catalog" | "none";
export type ProcedureImageRef = { kind: ProcedureImageKind; url: string | null };

export const catalogImagePrefix = "/images/procedimentos/";
export const procedureImageApiPath = "/api/procedures/images";
export const maxProcedureImagesPerClinic = 100;
// Imagem enviada e nunca vinculada a um procedimento é descartada no próximo upload após este prazo (até o lote abaixo por requisição).
export const orphanImageMaxAgeMs = 24 * 60 * 60 * 1000;
export const orphanPurgeBatch = 50;
export const orphanCutoff = (now = Date.now()) => new Date(now - orphanImageMaxAgeMs);

export const procedureImageUrl = (assetId: string) => `${procedureImageApiPath}/${encodeURIComponent(assetId)}`;

// Só aceita arquivos estáticos do catálogo (sem "..", sem protocolo), para o banco nunca apontar para fora de public/images/procedimentos.
export function isSafeCatalogImageFile(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(catalogImagePrefix) && /^[a-z0-9-]+\.(webp|png|jpg)$/.test(value.slice(catalogImagePrefix.length));
}

// Só aceita as duas origens conhecidas (catálogo estático e imagens da clínica servidas pela API), nunca URL arbitrária.
export function safeProcedureImageSrc(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.startsWith(`${procedureImageApiPath}/`) && /^[A-Za-z0-9_%-]+$/.test(value.slice(procedureImageApiPath.length + 1))) return value;
  return isSafeCatalogImageFile(value) ? value : null;
}

// Pré-visualização LOCAL do upload: aceita apenas blob: criado pelo próprio navegador (URL.createObjectURL de um File já validado).
// Nunca usar para dados vindos da API; para eles vale safeProcedureImageSrc.
export function localPreviewSrc(value: unknown): string | null {
  return typeof value === "string" && /^blob:[A-Za-z0-9:/._-]+$/.test(value) ? value : null;
}

// Mapa nome normalizado -> URL da imagem, para telas que só guardam o TEXTO do procedimento (agenda, jornadas).
// Usa apenas os procedimentos da própria clínica; nome sem correspondência exata fica sem imagem (placeholder).
export function indexProcedureImagesByName(procedures: ReadonlyArray<{ name: string; image?: { url: string | null } | null }>): Map<string, string> {
  const index = new Map<string, string>();
  for (const procedure of procedures) {
    const url = safeProcedureImageSrc(procedure.image?.url);
    const key = procedureNameKey(procedure.name);
    if (url && key && !index.has(key)) index.set(key, url);
  }
  return index;
}

export function resolveProcedureImageRef(input: { assetId?: string | null; libraryImageFile?: string | null; catalogImageFile?: string | null }): ProcedureImageRef {
  if (input.assetId) return { kind: "custom", url: procedureImageUrl(input.assetId) };
  const file = [input.libraryImageFile, input.catalogImageFile].find(isSafeCatalogImageFile);
  return file ? { kind: "catalog", url: file } : { kind: "none", url: null };
}
