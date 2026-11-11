// Catálogo padrão de materiais e produtos (global, somente leitura, em código). Cada clínica escolhe o que usa:
// ao escolher, o item é criado no estoque dela (ver /api/stock-catalog). Nomes genéricos, sem marcas.
import { normalizeSearch } from "./procedure-catalog-rules.ts";
import type { StockKind, StockUnit } from "./stock-rules";

export type StockCatalogItem = { slug: string; name: string; kind: StockKind; unit: StockUnit; category: string };

type Entry = [slug: string, name: string, unit: StockUnit];

function group(kind: StockKind, category: string, entries: Entry[]): StockCatalogItem[] {
  return entries.map(([slug, name, unit]) => ({ slug, name, kind, unit, category }));
}

export const STOCK_CATALOG: readonly StockCatalogItem[] = [
  ...group("material", "Descartáveis", [
    ["luvas-de-procedimento", "Luvas de procedimento", "unidade"],
    ["mascara-descartavel", "Máscara descartável", "unidade"],
    ["touca-descartavel", "Touca descartável", "unidade"],
    ["avental-descartavel", "Avental descartável", "unidade"],
    ["campo-descartavel", "Campo descartável", "unidade"],
    ["babador-descartavel", "Babador descartável", "unidade"],
    ["lencol-descartavel-maca", "Lençol descartável para maca", "unidade"],
  ]),
  ...group("material", "Perfurocortantes", [
    ["agulha-30g", "Agulha 30G (13 mm)", "unidade"],
    ["agulha-27g", "Agulha 27G", "unidade"],
    ["agulha-25g", "Agulha 25G", "unidade"],
    ["agulha-18g-aspiracao", "Agulha 18G (aspiração)", "unidade"],
    ["canula-22g", "Cânula 22G", "unidade"],
    ["canula-25g", "Cânula 25G", "unidade"],
    ["seringa-1-ml", "Seringa 1 ml", "unidade"],
    ["seringa-3-ml", "Seringa 3 ml", "unidade"],
    ["seringa-5-ml", "Seringa 5 ml", "unidade"],
    ["seringa-10-ml", "Seringa 10 ml", "unidade"],
    ["seringa-de-insulina", "Seringa de insulina", "unidade"],
  ]),
  ...group("material", "Curativo e limpeza", [
    ["gaze-esteril", "Gaze estéril", "unidade"],
    ["algodao", "Algodão", "unidade"],
    ["cotonete-swab", "Cotonete (swab)", "unidade"],
    ["fita-micropore", "Fita micropore", "unidade"],
    ["curativo-adesivo", "Curativo adesivo", "unidade"],
    ["esparadrapo-hipoalergenico", "Esparadrapo hipoalergênico", "unidade"],
  ]),
  ...group("material", "Procedimentos", [
    ["fio-de-pdo", "Fio de PDO", "unidade"],
    ["cartucho-microagulhamento", "Cartucho de microagulhamento", "unidade"],
    ["ponteira-descartavel-caneta", "Ponteira descartável (caneta)", "unidade"],
    ["lamina-de-bisturi", "Lâmina de bisturi", "unidade"],
    ["lamina-de-dermaplaning", "Lâmina de dermaplaning", "unidade"],
  ]),
  ...group("produto", "Injetáveis", [
    ["toxina-botulinica", "Toxina botulínica", "frasco"],
    ["acido-hialuronico-preenchedor", "Ácido hialurônico – preenchedor", "ml"],
    ["acido-hialuronico-skinbooster", "Ácido hialurônico – skinbooster", "ml"],
    ["bioestimulador-de-colageno", "Bioestimulador de colágeno", "frasco"],
    ["hialuronidase", "Hialuronidase", "frasco"],
    ["pdrn", "PDRN", "ml"],
    ["polinucleotideos", "Polinucleotídeos", "ml"],
    ["enzimas-e-lipoliticos", "Enzimas e lipolíticos", "ml"],
    ["lidocaina-injetavel", "Lidocaína injetável", "ml"],
    ["soro-fisiologico-0-9", "Soro fisiológico 0,9%", "frasco"],
    ["agua-para-injecao", "Água para injeção", "ml"],
  ]),
  ...group("produto", "Tópicos e assepsia", [
    ["anestesico-topico", "Anestésico tópico", "frasco"],
    ["alcool-70", "Álcool 70%", "frasco"],
    ["clorexidina-alcoolica", "Clorexidina alcoólica", "frasco"],
    ["clorexidina-degermante", "Clorexidina degermante", "frasco"],
    ["protetor-solar", "Protetor solar", "frasco"],
    ["pomada-cicatrizante", "Pomada cicatrizante", "frasco"],
    ["acido-para-peeling", "Ácido para peeling", "frasco"],
    ["mascara-facial-pos-procedimento", "Máscara facial pós-procedimento", "unidade"],
    ["ampola-de-serum", "Ampola de sérum", "unidade"],
  ]),
];

export const catalogCategories: readonly string[] = [...new Set(STOCK_CATALOG.map((item) => item.category))];

export function findCatalogItem(slug: unknown): StockCatalogItem | undefined {
  return typeof slug === "string" ? STOCK_CATALOG.find((item) => item.slug === slug) : undefined;
}

// Busca sem acento/caixa por nome, categoria e slug; `kind` opcional restringe a material ou produto.
export function filterStockCatalog<T extends StockCatalogItem>(items: readonly T[], query: unknown, kind?: StockKind): T[] {
  const terms = normalizeSearch(query).split(" ").filter(Boolean);
  return items.filter((item) => {
    if (kind && item.kind !== kind) return false;
    if (!terms.length) return true;
    const haystack = `${normalizeSearch(item.name)} ${normalizeSearch(item.category)} ${item.slug.replace(/-/g, " ")}`;
    return terms.every((term) => haystack.includes(term));
  });
}
