"use client";

import { useState } from "react";
import { FlaskConical, Syringe, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fieldClassName } from "@/components/ui/modal";
import { parseQuantity, validateQuantity, type StockKind } from "@/lib/stock-rules";
import { useCan } from "./current-user";
import { StockKindBadge } from "./stock-kind";
import { StockCatalogButton } from "./stock-catalog-picker";
import type { StockMaterial } from "./stock-shared";

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

// `onCatalogProduct`: o pai inclui o item criado a partir do catálogo em `materials` (também usado para validar a quantidade).
export function TechnicalSheetEditor({ materials, defaultValue = [], materialsNeedReview = false, onCatalogProduct }: { materials: MaterialOption[]; defaultValue?: TechnicalSheetItem[]; materialsNeedReview?: boolean; onCatalogProduct?: (product: StockMaterial) => void }) {
  const [rows, setRows] = useState<Row[]>(() => defaultValue.map((item, index) => ({
    key: index,
    productId: item.productId,
    quantity: String(item.quantity).replace(".", ","),
    kind: materials.find((material) => material.id === item.productId)?.kind ?? "material",
  })));
  const canManageStock = useCan("stock:manage");
  const [nextKey, setNextKey] = useState(defaultValue.length);
  const currentIds = defaultValue.map((item) => item.productId);
  const options = materials.filter((material) => !material.archivedAt || currentIds.includes(material.id));
  const sections: Array<{ kind: StockKind; title: string; description: string; addLabel: string; emptyMessage: string }> = [
    { kind: "material", title: "Ficha técnica de materiais", description: "Informe a quantidade aproximada de cada material usada por atendimento.", addLabel: "Adicionar material", emptyMessage: "Nenhum material no estoque ainda. Peça a um administrador para cadastrá-lo." },
    { kind: "produto", title: "Ficha técnica de produtos", description: "Informe a quantidade aproximada de cada produto usado por atendimento.", addLabel: "Adicionar produto", emptyMessage: "Nenhum produto no estoque ainda. Peça a um administrador para cadastrá-lo." },
  ];

  // A linha nasce já com o item escolhido e quantidade 1; item repetido não cria outra linha.
  function addRow(productId: string, kind: StockKind) {
    setRows((current) => current.some((row) => row.productId === productId) ? current : [...current, { key: nextKey, productId, quantity: "1", kind }]);
    setNextKey((current) => current + 1);
  }

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
          <section className={`space-y-3 ${section.kind === "produto" ? "border-t border-border pt-4" : ""}`} key={section.kind} aria-labelledby={`technical-sheet-${section.kind}-title`}>
            <div className="space-y-1 pb-1">
              <h3 id={`technical-sheet-${section.kind}-title`} className="text-xs font-medium text-foreground">{section.title}</h3>
              <p className="text-xs text-muted-foreground">{section.description}</p>
            </div>
            {section.kind === "material" && materialsNeedReview ? <p className="rounded-[7px] bg-warning/10 px-3 py-2 text-[11px] font-semibold text-warning">Ficha convertida automaticamente do texto antigo com quantidade 1. Confira e salve para concluir a revisão.</p> : null}
            {sectionRows.map((row) => {
              const material = materials.find((item) => item.id === row.productId);
              const unit = material?.unit;
              const name = material?.name ?? defaultValue.find((item) => item.productId === row.productId)?.name ?? "Item removido";
              return (
                <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-2.5" key={row.key}>
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${section.kind === "produto" ? "bg-accent text-accent-foreground" : "bg-primary/10 text-primary"}`} aria-hidden="true">
                    {section.kind === "produto" ? <FlaskConical className="h-5 w-5" /> : <Syringe className="h-5 w-5" />}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="break-words text-sm font-bold leading-tight text-foreground">{name}{material?.archivedAt ? " (arquivado)" : ""}</p>
                    <StockKindBadge kind={section.kind} />
                  </div>
                  <div className="relative w-[104px] shrink-0">
                    <input className={`${fieldClassName} pr-12`} aria-label={`Quantidade de ${name}`} inputMode="decimal" value={row.quantity} onChange={(event) => update(row.key, { quantity: event.target.value })} placeholder="1" />
                    <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-muted-foreground">{unit === "unidade" ? "un" : unit ?? ""}</span>
                  </div>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remover ${name}`} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              );
            })}
            <StockCatalogButton
              kind={section.kind}
              label={section.addLabel}
              icon="plus"
              sheet={{
                ownItems: sectionOptions.filter((material) => !material.archivedAt),
                usedProductIds: rows.map((row) => row.productId),
                onPickExisting: (productId) => addRow(productId, section.kind),
              }}
              onChosen={(product) => { onCatalogProduct?.(product); addRow(product.id, section.kind); }}
            />
            {!sectionOptions.length && !canManageStock ? <p className="text-[10px] text-muted-foreground">{section.emptyMessage}</p> : null}
          </section>
        );
      })}
    </div>
  );
}
