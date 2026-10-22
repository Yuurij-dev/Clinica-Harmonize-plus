"use client";

import { useState } from "react";
import { CirclePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fieldClassName } from "@/components/ui/modal";
import { parseQuantity, validateQuantity, type StockKind } from "@/lib/stock-rules";

export type TechnicalSheetItem = { productId: string; name: string; unit: string; quantity: number; archived?: boolean };
type MaterialOption = { id: string; name: string; kind?: StockKind; unit: string; archivedAt?: string | null };
type Row = { key: number; productId: string; quantity: string; kind: StockKind };

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

export function TechnicalSheetEditor({ materials, defaultValue = [], materialsNeedReview = false }: { materials: MaterialOption[]; defaultValue?: TechnicalSheetItem[]; materialsNeedReview?: boolean }) {
  const [rows, setRows] = useState<Row[]>(() => defaultValue.map((item, index) => ({
    key: index,
    productId: item.productId,
    quantity: String(item.quantity).replace(".", ","),
    kind: materials.find((material) => material.id === item.productId)?.kind ?? "material",
  })));
  const [nextKey, setNextKey] = useState(defaultValue.length);
  const currentIds = defaultValue.map((item) => item.productId);
  const options = materials.filter((material) => !material.archivedAt || currentIds.includes(material.id));
  const sections: Array<{ kind: StockKind; title: string; description: string; addLabel: string; emptyMessage: string }> = [
    { kind: "material", title: "Ficha técnica de materiais", description: "Informe a quantidade aproximada de cada material usada por atendimento.", addLabel: "Adicionar material", emptyMessage: "Cadastre materiais no Estoque para adicioná-los à ficha técnica." },
    { kind: "produto", title: "Ficha técnica de produtos", description: "Informe a quantidade aproximada de cada produto usado por atendimento.", addLabel: "Adicionar produto", emptyMessage: "Cadastre produtos no Estoque para adicioná-los à ficha técnica." },
  ];

  function update(key: number, patch: Partial<Row>) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
  }

  return (
    <div className="space-y-4">
      <input type="hidden" name="technicalSheet" value={JSON.stringify(rows.map(({ productId, quantity }) => ({ productId, quantity })))} />
      {sections.map((section) => {
        const sectionRows = rows.filter((row) => row.kind === section.kind);
        const sectionOptions = options.filter((material) => (material.kind ?? "material") === section.kind);
        return (
          <section className={`space-y-2 ${section.kind === "produto" ? "border-t border-border pt-4" : ""}`} key={section.kind} aria-labelledby={`technical-sheet-${section.kind}-title`}>
            <div className="space-y-1">
              <h3 id={`technical-sheet-${section.kind}-title`} className="text-xs font-medium text-foreground">{section.title}</h3>
              <p className="text-xs text-muted-foreground">{section.description}</p>
            </div>
            {section.kind === "material" && materialsNeedReview ? <p className="rounded-[7px] bg-warning/10 px-3 py-2 text-[11px] font-semibold text-warning">Ficha convertida automaticamente do texto antigo com quantidade 1. Confira e salve para concluir a revisão.</p> : null}
            {sectionRows.map((row) => {
              const unit = materials.find((material) => material.id === row.productId)?.unit;
              const itemLabel = section.kind === "produto" ? "Produto" : "Material";
              return (
                <div className="grid grid-cols-[1fr_110px_auto] items-center gap-2" key={row.key}>
                  <select className={fieldClassName} aria-label={itemLabel} value={row.productId} onChange={(event) => update(row.key, { productId: event.target.value })}>
                    <option value="">Selecione um {section.kind}</option>
                    {sectionOptions.map((material) => <option key={material.id} value={material.id}>{material.name}{material.archivedAt ? " (arquivado)" : ""}</option>)}
                  </select>
                  <div className="relative">
                    <input className={`${fieldClassName} pr-12`} aria-label="Quantidade" inputMode="decimal" value={row.quantity} onChange={(event) => update(row.key, { quantity: event.target.value })} placeholder="1" />
                    <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-muted-foreground">{unit === "unidade" ? "un" : unit ?? ""}</span>
                  </div>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remover ${section.kind}`} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              );
            })}
            <Button type="button" variant="secondary" size="sm" className="h-8 px-2.5 text-xs [&_svg]:size-3.5" disabled={!sectionOptions.length} onClick={() => { setRows((current) => [...current, { key: nextKey, productId: "", quantity: "1", kind: section.kind }]); setNextKey((current) => current + 1); }}>
              <CirclePlus className="h-3.5 w-3.5" />{section.addLabel}
            </Button>
            {!sectionOptions.length ? <p className="text-[10px] text-muted-foreground">{section.emptyMessage}</p> : null}
          </section>
        );
      })}
    </div>
  );
}
