"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Library, Loader2, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fieldClassName, Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { sendJson } from "@/lib/send-json";
import { filterStockCatalog, type StockCatalogItem } from "@/lib/stock-catalog";
import { stockKindLabels, type StockKind } from "@/lib/stock-rules";
import { cn } from "@/lib/utils";
import { useCan } from "./current-user";
import { invalidateStockCache, stockCatalogCacheKey, type StockMaterial } from "./stock-shared";


type CatalogEntry = StockCatalogItem & { enabled: boolean; archived?: boolean; productId: string | null };
type CatalogResponse = { total: number; items: CatalogEntry[] };

function useStockCatalog() {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; items: CatalogEntry[] }>(() => {
    const cached = readClientCache<CatalogResponse>(stockCatalogCacheKey);
    return cached ? { status: "ready", items: cached.items } : { status: "loading", items: [] };
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    getCachedJson<CatalogResponse>(stockCatalogCacheKey)
      .then((data) => { if (active) setState({ status: "ready", items: data.items ?? [] }); })
      .catch(() => { if (active) setState((current) => current.items.length ? current : { status: "error", items: [] }); });
    return () => { active = false; };
  }, [attempt]);
  return { ...state, retry: () => { setState({ status: "loading", items: [] }); setAttempt((value) => value + 1); } };
}

// Lista pesquisável do catálogo de materiais e produtos. Escolher um item o cria no estoque da clínica
// (POST /api/stock-catalog, idempotente) e entrega o item pronto em `onChosen`.
export function StockCatalogPicker({ kind, onChosen, autoFocus = false }: { kind?: StockKind; onChosen: (product: StockMaterial, created: boolean) => void; autoFocus?: boolean }) {
  const catalog = useStockCatalog();
  const [query, setQuery] = useState("");
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [error, setError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => filterStockCatalog(catalog.items, query, kind), [catalog.items, query, kind]);
  const noun = kind ? stockKindLabels[kind].plural.toLocaleLowerCase("pt-BR") : "materiais e produtos";

  useEffect(() => {
    if (!autoFocus) return;
    // O Radix foca o primeiro item do diálogo (botão fechar); leva o foco para a busca.
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  async function choose(item: CatalogEntry) {
    if (busySlug) return;
    setBusySlug(item.slug);
    setError("");
    const { ok, data } = await sendJson<{ product?: StockMaterial; created?: boolean }>("/api/stock-catalog", "POST", { slug: item.slug });
    setBusySlug(null);
    if (!ok || !data?.product) { setError(data?.message ?? "Não foi possível adicionar o item. Tente novamente."); return; }
    invalidateClientCache(stockCatalogCacheKey);
    invalidateStockCache();
    onChosen(data.product, data.created ?? true);
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          ref={searchRef}
          className={cn(fieldClassName, "pl-9")}
          placeholder={`Pesquisar no catálogo (ex.: ${kind === "produto" ? "toxina, álcool" : "agulha, seringa"})`}
          aria-label={`Pesquisar ${noun} no catálogo`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={100}
        />
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {catalog.status === "ready" ? (results.length === 1 ? "1 item encontrado" : `${results.length} itens encontrados`) : catalog.status === "loading" ? "Carregando catálogo..." : ""}
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
      {catalog.status === "ready" && !results.length ? (
        <div className="rounded-lg border border-border bg-muted/40 p-5 text-center">
          <p className="text-sm font-semibold text-foreground">Nenhum item encontrado</p>
          <p className="mt-1 text-xs text-muted-foreground">Confira a grafia ou cadastre um item personalizado.</p>
        </div>
      ) : null}
      {catalog.status === "ready" && results.length ? (
        <ul className="grid max-h-[50vh] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2" aria-label="Itens do catálogo">
          {results.map((item) => (
            <li key={item.slug} className={cn("rounded-lg border bg-card", item.enabled ? "border-border opacity-90" : "border-border hover:border-primary/50")}>
              {item.enabled ? (
                <div className="flex h-full flex-col gap-1.5 p-2.5">
                  <strong className="text-sm leading-tight text-foreground">{item.name}</strong>
                  <span className="text-xs text-muted-foreground">{item.category} · {item.unit}</span>
                  <Badge variant="green" className="w-fit"><Check className="mr-1 h-3 w-3" aria-hidden="true" />Já no estoque</Badge>
                </div>
              ) : item.archived ? (
                <div className="flex h-full flex-col gap-1.5 p-2.5">
                  <strong className="text-sm leading-tight text-foreground">{item.name}</strong>
                  <span className="text-xs text-muted-foreground">{item.category} · {item.unit}</span>
                  <Badge variant="slate" className="w-fit">Arquivado no estoque</Badge>
                  <span className="text-xs text-muted-foreground">Desarquive no Estoque para usar.</span>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busySlug !== null}
                  className="flex h-full w-full flex-col gap-1.5 rounded-lg p-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60"
                  onClick={() => void choose(item)}
                  aria-label={`Selecionar ${item.name}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold leading-tight text-foreground">{item.name}</span>
                    {busySlug === item.slug ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" /> : null}
                  </span>
                  <span className="text-xs text-muted-foreground">{item.category} · {item.unit}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// Botão "Escolher do catálogo" que abre o seletor num diálogo. Só aparece para quem gerencia o estoque.
export function StockCatalogButton({ kind, onChosen, className }: { kind?: StockKind; onChosen: (product: StockMaterial, created: boolean) => void; className?: string }) {
  const canManage = useCan("stock:manage");
  const [open, setOpen] = useState(false);
  if (!canManage) return null;
  const noun = kind ? stockKindLabels[kind].singular.toLocaleLowerCase("pt-BR") : "item";
  return (
    <>
      <Button type="button" variant="secondary" size="sm" className={cn("h-8 px-2.5 text-xs [&_svg]:size-3.5", className)} onClick={() => setOpen(true)}>
        <Library className="h-3.5 w-3.5" />Escolher do catálogo
      </Button>
      {open ? (
        <Modal open onClose={() => setOpen(false)} panelClassName="max-w-2xl" title={`Catálogo de ${kind ? stockKindLabels[kind].plural.toLocaleLowerCase("pt-BR") : "materiais e produtos"}`} description={`Escolha um ${noun} para adicioná-lo ao estoque e usá-lo agora. Custo e fornecedor ficam em branco até a primeira compra.`}>
          <StockCatalogPicker kind={kind} autoFocus onChosen={(product, created) => { setOpen(false); onChosen(product, created); }} />
        </Modal>
      ) : null}
    </>
  );
}
