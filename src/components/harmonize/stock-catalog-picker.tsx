"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CirclePlus, Library, Loader2, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fieldClassName, Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { sendJson } from "@/lib/send-json";
import { normalizeSearch } from "@/lib/procedure-catalog-rules";
import { STOCK_CATALOG, filterStockCatalog, type StockCatalogItem } from "@/lib/stock-catalog";
import { stockKindLabels, type StockKind } from "@/lib/stock-rules";
import { cn } from "@/lib/utils";
import { useCan } from "./current-user";
import { invalidateStockCache, stockCatalogCacheKey, type StockMaterial } from "./stock-shared";


type CatalogEntry = StockCatalogItem & { enabled: boolean; archived?: boolean; productId: string | null };
type CatalogResponse = { total: number; items: CatalogEntry[] };

function useStockCatalog(enabled = true) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; items: CatalogEntry[] }>(() => {
    if (!enabled) return { status: "ready", items: [] };
    const cached = readClientCache<CatalogResponse>(stockCatalogCacheKey);
    return cached ? { status: "ready", items: cached.items } : { status: "loading", items: [] };
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    getCachedJson<CatalogResponse>(stockCatalogCacheKey)
      .then((data) => { if (active) setState({ status: "ready", items: data.items ?? [] }); })
      .catch(() => { if (active) setState((current) => current.items.length ? current : { status: "error", items: [] }); });
    return () => { active = false; };
  }, [attempt, enabled]);
  return { ...state, retry: () => { setState({ status: "loading", items: [] }); setAttempt((value) => value + 1); } };
}

export type OwnStockItem = { id: string; name: string; unit: string; kind?: StockKind };
// Modo "ficha técnica": além do catálogo, lista os itens do estoque da clínica e permite escolher os que já existem.
type SheetMode = { ownItems: OwnStockItem[]; usedProductIds: string[]; onPickExisting: (productId: string) => void };

const tileClass = "flex h-full w-full flex-col gap-1.5 rounded-lg p-2.5 text-left";
const tileButtonClass = `${tileClass} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60`;

// Lista pesquisável do catálogo de materiais e produtos. Escolher um item novo o cria no estoque da clínica
// (POST /api/stock-catalog, idempotente) e entrega o item pronto em `onChosen`. Com `sheet`, itens já no estoque
// e itens personalizados também são selecionáveis (sem POST); `withCatalog=false` mostra só o estoque (sem stock:manage).
export function StockCatalogPicker({ kind, onChosen, autoFocus = false, sheet, withCatalog = true }: { kind?: StockKind; onChosen: (product: StockMaterial, created: boolean) => void; autoFocus?: boolean; sheet?: SheetMode; withCatalog?: boolean }) {
  const catalog = useStockCatalog(withCatalog);
  const [query, setQuery] = useState("");
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [error, setError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => filterStockCatalog(catalog.items, query, kind), [catalog.items, query, kind]);
  const ownIds = useMemo(() => new Set((sheet?.ownItems ?? []).map((item) => item.id)), [sheet?.ownItems]);
  // Itens do estoque que não são do catálogo (ou todos, quando o catálogo não está disponível).
  const ownResults = useMemo(() => {
    if (!sheet) return [];
    const catalogNames = new Set(withCatalog ? STOCK_CATALOG.map((item) => normalizeSearch(item.name)) : []);
    const terms = normalizeSearch(query).split(" ").filter(Boolean);
    return sheet.ownItems.filter((item) => !catalogNames.has(normalizeSearch(item.name)) && terms.every((term) => normalizeSearch(item.name).includes(term)));
  }, [sheet, withCatalog, query]);
  const used = new Set(sheet?.usedProductIds ?? []);
  const noun = kind ? stockKindLabels[kind].plural.toLocaleLowerCase("pt-BR") : "materiais e produtos";
  const total = results.length + ownResults.length;
  const hasCatalogList = withCatalog && catalog.status === "ready" && results.length > 0;

  useEffect(() => {
    if (!autoFocus) return;
    // O Radix foca o primeiro item do diálogo (botão fechar); leva o foco para a busca.
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  async function choose(item: CatalogEntry) {
    if (busySlug) return;
    if (sheet && item.productId && ownIds.has(item.productId)) { sheet.onPickExisting(item.productId); return; }
    setBusySlug(item.slug);
    setError("");
    const { ok, data } = await sendJson<{ product?: StockMaterial; created?: boolean }>("/api/stock-catalog", "POST", { slug: item.slug });
    setBusySlug(null);
    if (!ok || !data?.product) { setError(data?.message ?? "Não foi possível adicionar o item. Tente novamente."); return; }
    invalidateClientCache(stockCatalogCacheKey);
    invalidateStockCache();
    onChosen(data.product, data.created ?? true);
  }

  const tileInfo = (name: string, detail: string) => (
    <>
      <strong className="text-sm leading-tight text-foreground">{name}</strong>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </>
  );

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          ref={searchRef}
          className={cn(fieldClassName, "pl-9")}
          placeholder={withCatalog ? `Pesquisar no catálogo (ex.: ${kind === "produto" ? "toxina, álcool" : "agulha, seringa"})` : `Pesquisar ${noun} do estoque`}
          aria-label={withCatalog ? `Pesquisar ${noun} no catálogo` : `Pesquisar ${noun} do estoque`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={100}
        />
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {catalog.status === "ready" ? (total === 1 ? "1 item encontrado" : `${total} itens encontrados`) : catalog.status === "loading" ? "Carregando catálogo..." : ""}
      </p>
      {error ? <p role="alert" className="rounded-[7px] bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">{error}</p> : null}

      {catalog.status === "loading" ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-[64px] rounded-lg" />)}</div>
      ) : null}
      {catalog.status === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <p className="font-semibold">Não foi possível carregar o catálogo.</p>
          <Button type="button" size="sm" variant="secondary" onClick={catalog.retry}><RefreshCw className="h-3.5 w-3.5" />Tentar novamente</Button>
        </div>
      ) : null}
      {catalog.status === "ready" && !total ? (
        <div className="rounded-lg border border-border bg-muted/40 p-5 text-center">
          <p className="text-sm font-semibold text-foreground">Nenhum item encontrado</p>
          <p className="mt-1 text-xs text-muted-foreground">{withCatalog ? "Confira a grafia ou cadastre um item personalizado." : "Cadastre o item no Estoque para usá-lo aqui."}</p>
        </div>
      ) : null}
      <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
        {hasCatalogList ? (
          <section className="space-y-2">
            {sheet && ownResults.length ? <h4 className="text-xs font-semibold text-foreground">Catálogo</h4> : null}
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Itens do catálogo">
              {results.map((item) => {
                const inSheet = Boolean(item.productId && used.has(item.productId));
                return (
                  <li key={item.slug} className={cn("rounded-lg border bg-card", item.enabled && !sheet ? "border-border opacity-90" : "border-border hover:border-primary/50")}>
                    {item.archived ? (
                      <div className={tileClass}>
                        {tileInfo(item.name, `${item.category} · ${item.unit}`)}
                        <Badge variant="slate" className="w-fit">Arquivado no estoque</Badge>
                        <span className="text-xs text-muted-foreground">Desarquive no Estoque para usar.</span>
                      </div>
                    ) : inSheet ? (
                      <div className={cn(tileClass, "opacity-80")}>
                        {tileInfo(item.name, `${item.category} · ${item.unit}`)}
                        <Badge variant="green" className="w-fit"><Check className="mr-1 h-3 w-3" aria-hidden="true" />Já na ficha</Badge>
                      </div>
                    ) : item.enabled && !sheet ? (
                      <div className={tileClass}>
                        {tileInfo(item.name, `${item.category} · ${item.unit}`)}
                        <Badge variant="green" className="w-fit"><Check className="mr-1 h-3 w-3" aria-hidden="true" />Já no estoque</Badge>
                      </div>
                    ) : (
                      <button type="button" disabled={busySlug !== null} className={tileButtonClass} onClick={() => void choose(item)} aria-label={`Selecionar ${item.name}`}>
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold leading-tight text-foreground">{item.name}</span>
                          {busySlug === item.slug ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" /> : null}
                        </span>
                        <span className="text-xs text-muted-foreground">{item.category} · {item.unit}</span>
                        {item.enabled ? <Badge variant="green" className="w-fit"><Check className="mr-1 h-3 w-3" aria-hidden="true" />Já no estoque</Badge> : null}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        {ownResults.length ? (
          <section className="space-y-2">
            <h4 className="text-xs font-semibold text-foreground">Seus itens</h4>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Seus itens do estoque">
              {ownResults.map((item) => (
                <li key={item.id} className="rounded-lg border border-border bg-card hover:border-primary/50">
                  {used.has(item.id) ? (
                    <div className={cn(tileClass, "opacity-80")}>
                      {tileInfo(item.name, item.unit)}
                      <Badge variant="green" className="w-fit"><Check className="mr-1 h-3 w-3" aria-hidden="true" />Já na ficha</Badge>
                    </div>
                  ) : (
                    <button type="button" className={tileButtonClass} onClick={() => sheet?.onPickExisting(item.id)} aria-label={`Selecionar ${item.name}`}>
                      {tileInfo(item.name, item.unit)}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

type ButtonProps = {
  kind?: StockKind;
  onChosen: (product: StockMaterial, created: boolean) => void;
  className?: string;
  label?: string;
  icon?: "library" | "plus";
  /** Ficha técnica: o botão aparece mesmo sem stock:manage (lista só o estoque) e permite escolher itens já existentes. */
  sheet?: SheetMode;
};

// Botão que abre o seletor num diálogo. Sem `sheet`, só aparece para quem gerencia o estoque.
export function StockCatalogButton({ kind, onChosen, className, label = "Escolher do catálogo", icon = "library", sheet }: ButtonProps) {
  const canManage = useCan("stock:manage");
  const [open, setOpen] = useState(false);
  if (!canManage && !sheet) return null;
  const noun = kind ? stockKindLabels[kind].singular.toLocaleLowerCase("pt-BR") : "item";
  const plural = kind ? stockKindLabels[kind].plural.toLocaleLowerCase("pt-BR") : "materiais e produtos";
  const Icon = icon === "plus" ? CirclePlus : Library;
  const description = !canManage ? `Escolha um ${noun} já cadastrado no estoque.`
    : sheet ? `Escolha um ${noun} do catálogo ou do seu estoque. Itens novos do catálogo são adicionados ao estoque; custo e fornecedor ficam em branco até a primeira compra.`
    : `Escolha um ${noun} para adicioná-lo ao estoque e usá-lo agora. Custo e fornecedor ficam em branco até a primeira compra.`;
  return (
    <>
      <Button type="button" variant="secondary" size="sm" className={cn("h-8 px-2.5 text-xs [&_svg]:size-3.5", className)} onClick={() => setOpen(true)}>
        <Icon className="h-3.5 w-3.5" />{label}
      </Button>
      {open ? (
        <Modal open onClose={() => setOpen(false)} panelClassName="max-w-2xl" title={canManage ? `Catálogo de ${plural}` : `Adicionar ${noun}`} description={description}>
          <StockCatalogPicker
            kind={kind}
            autoFocus
            withCatalog={canManage}
            sheet={sheet ? { ...sheet, onPickExisting: (id) => { setOpen(false); sheet.onPickExisting(id); } } : undefined}
            onChosen={(product, created) => { setOpen(false); onChosen(product, created); }}
          />
        </Modal>
      ) : null}
    </>
  );
}
