"use client";

import { Badge } from "@/components/ui/badge";
import { groupByKind, stockKindLabels, type StockKind } from "@/lib/stock-rules";

// Etiqueta do tipo do item, para telas que mostram materiais e produtos juntos.
export function StockKindBadge({ kind, className }: { kind: StockKind; className?: string }) {
  return <Badge className={className} variant={kind === "produto" ? "blue" : "slate"}>{(stockKindLabels[kind] ?? stockKindLabels.material).singular}</Badge>;
}

// Opções de um <select> agrupadas em Materiais e Produtos.
export function KindOptionGroups<T extends { id: string; kind: StockKind }>({ items, label }: { items: T[]; label: (item: T) => string }) {
  return <>{groupByKind(items).map((group) => (
    <optgroup key={group.kind} label={group.label}>
      {group.items.map((item) => <option key={item.id} value={item.id}>{label(item)}</option>)}
    </optgroup>
  ))}</>;
}
