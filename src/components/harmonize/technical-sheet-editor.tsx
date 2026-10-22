"use client";

import { useState } from "react";
import { CirclePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fieldClassName } from "@/components/ui/modal";
import { parseQuantity, validateQuantity, type StockKind } from "@/lib/stock-rules";
import { KindOptionGroups } from "./stock-kind";

export type TechnicalSheetItem = { productId: string; name: string; unit: string; quantity: number; archived?: boolean };
type MaterialOption = { id: string; name: string; kind?: StockKind; unit: string; archivedAt?: string | null };
type Row = { key: number; productId: string; quantity: string };

// Lê a ficha técnica do formulário; devolve erro em texto quando algo está inválido.
export function readTechnicalSheet(form: FormData, materials: MaterialOption[]) {
  const rows = JSON.parse(String(form.get("technicalSheet") ?? "[]")) as Array<{ productId: string; quantity: string }>;
  const items: Array<{ productId: string; quantity: number }> = [];
  for (const row of rows) {
    if (!row.productId) continue;
    const material = materials.find((item) => item.id === row.productId);
    const quantity = parseQuantity(row.quantity);
    const error = validateQuantity(quantity, material?.unit ?? "unidade");
    if (error) return { error: `${material?.name ?? "Item"}: ${error}` };
    if (items.some((item) => item.productId === row.productId)) return { error: `${material?.name ?? "Item"} aparece mais de uma vez.` };
    items.push({ productId: row.productId, quantity });
  }
  return { items };
}

export function TechnicalSheetEditor({ materials, defaultValue = [] }: { materials: MaterialOption[]; defaultValue?: TechnicalSheetItem[] }) {
  const [rows, setRows] = useState<Row[]>(() => defaultValue.map((item, index) => ({ key: index, productId: item.productId, quantity: String(item.quantity).replace(".", ",") })));
  const [nextKey, setNextKey] = useState(defaultValue.length);
  const currentIds = defaultValue.map((item) => item.productId);
  const options = materials.filter((material) => !material.archivedAt || currentIds.includes(material.id));

  function update(key: number, patch: Partial<Row>) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
  }

  return (
    <div className="space-y-2">
      <input type="hidden" name="technicalSheet" value={JSON.stringify(rows.map(({ productId, quantity }) => ({ productId, quantity })))} />
      {rows.map((row) => {
        const unit = materials.find((material) => material.id === row.productId)?.unit;
        return (
          <div className="grid grid-cols-[1fr_110px_auto] items-center gap-2" key={row.key}>
            <select className={fieldClassName} aria-label="Item" value={row.productId} onChange={(event) => update(row.key, { productId: event.target.value })}>
              <option value="">Selecione um item</option>
              <KindOptionGroups items={options.map((material) => ({ ...material, kind: material.kind ?? "material" }))} label={(material) => `${material.name}${material.archivedAt ? " (arquivado)" : ""}`} />
            </select>
            <div className="relative">
              <input className={`${fieldClassName} pr-12`} aria-label="Quantidade" inputMode="decimal" value={row.quantity} onChange={(event) => update(row.key, { quantity: event.target.value })} placeholder="1" />
              <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-muted-foreground">{unit === "unidade" ? "un" : unit ?? ""}</span>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="Remover item" onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        );
      })}
      <Button type="button" variant="secondary" size="sm" disabled={!options.length} onClick={() => { setRows((current) => [...current, { key: nextKey, productId: "", quantity: "1" }]); setNextKey((current) => current + 1); }}>
        <CirclePlus className="h-3.5 w-3.5" />Adicionar material
      </Button>
      {!options.length ? <p className="text-[10px] text-muted-foreground">Cadastre materiais ou produtos no Estoque para montar a ficha técnica.</p> : null}
    </div>
  );
}
