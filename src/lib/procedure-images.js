import procedureManifest from "../../public/images/procedimentos/manifest.json" with { type: "json" };

/** @typedef {{ src: string | null, alt: string, slug?: string, custom: boolean }} ResolvedProcedureImage */

// LEGADO, resolução por NOME: usar só onde a tela tem apenas o texto do procedimento (agendamentos, sessões e orçamentos guardam o nome),
// e apenas com nomes de procedimentos da própria clínica. Procedimentos cadastrados resolvem a imagem por ID em procedure-image-rules.ts
// (catálogo/upload), que não quebra ao renomear. Não usar no cadastro nem em código novo com acesso ao id.

const entries = procedureManifest;
const normalize = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("pt-BR");
const imageByName = new Map(entries.map((entry) => [normalize(entry.name), entry]));
const imageBySlug = new Map(entries.map((entry) => [entry.slug, entry]));

const exactAliases = {
  "toxina botulinica": "botox",
  "preenchimento de olheira": "preenchimento-de-olheiras",
  "led terapia": "ledterapia",
};

function safeCustomImageUrl(value) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.startsWith("//") || candidate.includes("\\") || /[\u0000-\u001f]/.test(candidate)) return null;
  if (candidate.startsWith("/") && !candidate.startsWith("///")) return candidate;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** @param {string} name @param {string | null} [customImageUrl] @returns {ResolvedProcedureImage} */
export function resolveProcedureImage(name, customImageUrl) {
  const custom = safeCustomImageUrl(customImageUrl);
  if (custom) return { src: custom, alt: `Imagem ilustrativa de ${name.trim() || "procedimento"}`, custom: true };

  const normalizedName = normalize(name);
  const direct = imageByName.get(normalizedName);
  const aliasSlug = exactAliases[normalizedName];
  const entry = direct ?? (aliasSlug ? imageBySlug.get(aliasSlug) : undefined);
  if (entry) return { src: entry.file, alt: entry.alt, slug: entry.slug, custom: false };

  return { src: null, alt: `Imagem ilustrativa de ${name.trim() || "procedimento"}`, custom: false };
}
