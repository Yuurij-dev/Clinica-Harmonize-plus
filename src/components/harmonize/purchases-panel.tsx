"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Ban, CirclePlus, Loader2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fieldClassName, FormField, Modal } from "@/components/ui/modal";
import { CLIENT_CACHE_INVALIDATED_EVENT, getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { clinicToday } from "@/lib/clinic-time";
import { formatCurrency, parseCurrency } from "@/lib/input-masks";
import { sendJson } from "@/lib/send-json";
import { formatQuantity, parseQuantity, validateQuantity } from "@/lib/stock-rules";
import { invalidateFinanceCache, paymentMethods } from "./finance-section";
import { EmptyState } from "./shared";
import { formatDateOnly, invalidateStockCache, type StockMaterial } from "./stock-shared";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

type PurchaseRow = {
  id: string;
  supplier: string;
  invoiceNumber: string | null;
  purchasedOn: string;
  paymentMethod: string;
  installments: number;
  status: "active" | "cancelled";
  totalCents: number;
  paidInstallments: number;
  items: Array<{ name: string; unit: string; lotCode: string; quantity: number; unitPriceCents: number }>;
};
type ItemRow = { key: number; productId: string; lotCode: string; expiresOn: string; quantity: string; price: string };

export function PurchasesPanel({ materials, creating, onCloseCreate, onSaved }: { materials: StockMaterial[]; creating: boolean; onCloseCreate: () => void; onSaved?: (message: string) => void }) {
  const [purchases, setPurchases] = useState<PurchaseRow[] | null>(() => readClientCache<{ purchases: PurchaseRow[] }>("/api/purchases")?.purchases ?? null);
  const [version, setVersion] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getCachedJson<{ purchases: PurchaseRow[] }>("/api/purchases").then((data) => { if (active) setPurchases(data.purchases); }).catch(() => { if (active) setPurchases([]); });
    return () => { active = false; };
  }, [version]);

  useEffect(() => {
    const handle = (event: Event) => { if ((event as CustomEvent<string[]>).detail?.includes("/api/purchases")) setVersion((current) => current + 1); };
    window.addEventListener(CLIENT_CACHE_INVALIDATED_EVENT, handle);
    return () => window.removeEventListener(CLIENT_CACHE_INVALIDATED_EVENT, handle);
  }, []);

  async function cancelPurchase(purchase: PurchaseRow) {
    if (!window.confirm(`Cancelar a compra de ${purchase.supplier}? As entradas serão desfeitas e as despesas canceladas.`)) return;
    setBusyId(purchase.id);
    setError("");
    const { ok, data } = await sendJson(`/api/purchases/${purchase.id}`, "PATCH", { action: "cancel" });
    setBusyId(null);
    if (!ok) {
      setError(data?.message ?? "Não foi possível cancelar a compra.");
      return;
    }
    invalidateClientCache("/api/purchases");
    invalidateStockCache();
    invalidateFinanceCache();
    onSaved?.(`Compra de ${purchase.supplier} cancelada.`);
  }

  return (
    <div>
      {error ? <p className="mb-3 rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318]">{error}</p> : null}
      {!purchases ? <div className="grid place-items-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div> : purchases.length ? (
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {purchases.map((purchase) => (
            <div className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between ${purchase.status === "cancelled" ? "opacity-60" : ""}`} key={purchase.id}>
              <div className="min-w-0">
                <p className="font-bold text-foreground">{purchase.supplier}{purchase.invoiceNumber ? <span className="font-medium text-muted-foreground"> · NF {purchase.invoiceNumber}</span> : null}</p>
                <p className="text-xs text-muted-foreground">{formatDateOnly(purchase.purchasedOn)} · {purchase.paymentMethod} · {purchase.installments > 1 ? `${purchase.paidInstallments}/${purchase.installments} parcelas pagas` : purchase.paidInstallments ? "Paga" : "A pagar"}</p>
                <ul className="mt-2 space-y-0.5 text-xs text-foreground">
                  {purchase.items.map((item, index) => <li key={index}>{formatQuantity(item.quantity, item.unit)} {item.name} · lote {item.lotCode} · {currency.format(item.unitPriceCents / 100)}/{item.unit}</li>)}
                </ul>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <strong className="text-foreground">{currency.format(purchase.totalCents / 100)}</strong>
                {purchase.status === "cancelled" ? <Badge variant="slate">Cancelada</Badge> : <Button size="sm" variant="secondary" disabled={busyId === purchase.id} onClick={() => void cancelPurchase(purchase)}>{busyId === purchase.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}Cancelar</Button>}
              </div>
            </div>
          ))}
        </div>
      ) : <EmptyState title="Nenhuma compra registrada" description="Registre as notas de compra para dar entrada nos lotes e lançar as despesas." />}
      {creating ? <PurchaseFormModal materials={materials.filter((material) => !material.archivedAt)} onClose={onCloseCreate} onSaved={(message) => { onCloseCreate(); invalidateClientCache("/api/purchases"); invalidateStockCache(); invalidateFinanceCache(); onSaved?.(message); }} /> : null}
    </div>
  );
}

function PurchaseFormModal({ materials, onClose, onSaved }: { materials: StockMaterial[]; onClose: () => void; onSaved: (message: string) => void }) {
  const today = clinicToday();
  const [rows, setRows] = useState<ItemRow[]>([{ key: 0, productId: "", lotCode: "", expiresOn: "", quantity: "", price: "" }]);
  const [nextKey, setNextKey] = useState(1);
  const [installments, setInstallments] = useState(1);
  const [paid, setPaid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const totalCents = useMemo(() => rows.reduce((sum, row) => {
    const quantity = parseQuantity(row.quantity);
    const price = Math.round(parseCurrency(row.price) * 100);
    return Number.isFinite(quantity) ? sum + Math.round(quantity * price) : sum;
  }, 0), [rows]);

  function update(key: number, patch: Partial<ItemRow>) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const items = [];
    for (const row of rows) {
      const material = materials.find((item) => item.id === row.productId);
      if (!material) return setError("Escolha o material de cada item.");
      const quantity = parseQuantity(row.quantity);
      const quantityError = validateQuantity(quantity, material.unit);
      if (quantityError) return setError(`${material.name}: ${quantityError}`);
      if (!row.lotCode.trim() || !row.expiresOn) return setError(`${material.name}: informe o lote e a validade.`);
      items.push({ productId: material.id, lotCode: row.lotCode.trim(), expiresOn: row.expiresOn, quantity, unitPriceCents: Math.round(parseCurrency(row.price) * 100) });
    }
    setSaving(true);
    setError("");
    const supplier = String(form.get("supplier") ?? "").trim();
    const { ok, data } = await sendJson("/api/purchases", "POST", {
      supplier,
      invoiceNumber: String(form.get("invoiceNumber") ?? ""),
      purchasedOn: String(form.get("purchasedOn") ?? ""),
      firstDueOn: String(form.get("firstDueOn") ?? ""),
      paymentMethod: String(form.get("paymentMethod") ?? ""),
      installments,
      paid,
      items,
    });
    setSaving(false);
    if (!ok) return setError(data?.message ?? "Não foi possível registrar a compra.");
    onSaved(`Compra de ${supplier} registrada.`);
  }

  return (
    <Modal open onClose={onClose} title="Nova compra" description="Cada item dá entrada no lote informado. A compra gera as despesas no Financeiro.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Fornecedor"><input className={fieldClassName} name="supplier" required /></FormField>
          <FormField label="Número da nota (opcional)"><input className={fieldClassName} name="invoiceNumber" /></FormField>
          <FormField label="Data da compra"><input className={fieldClassName} name="purchasedOn" type="date" defaultValue={today} required /></FormField>
          <FormField label="Forma de pagamento"><select className={fieldClassName} name="paymentMethod" defaultValue="Pix">{paymentMethods.map((method) => <option key={method}>{method}</option>)}</select></FormField>
          <FormField label="Parcelas"><select className={fieldClassName} value={installments} onChange={(event) => setInstallments(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count === 1 ? "À vista" : `${count}x`}</option>)}</select></FormField>
          <FormField label={installments > 1 ? "Vencimento da 1ª parcela" : "Vencimento"}><input className={fieldClassName} name="firstDueOn" type="date" defaultValue={today} required /></FormField>
          <label className="flex items-center gap-2 text-xs font-semibold text-foreground sm:col-span-2"><input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} />{installments > 1 ? "Parcelas já pagas (cada uma na data do seu vencimento)" : "Já está paga"}</label>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-bold text-foreground">Itens</p>
          {rows.map((row) => {
            const unit = materials.find((material) => material.id === row.productId)?.unit;
            return (
              <div className="grid gap-2 rounded-[8px] border border-border p-3 sm:grid-cols-[1.4fr_1fr_1fr_auto]" key={row.key}>
                <select className={`${fieldClassName} sm:col-span-3`} aria-label="Material" value={row.productId} onChange={(event) => update(row.key, { productId: event.target.value })}>
                  <option value="">Selecione o material</option>
                  {materials.map((material) => <option key={material.id} value={material.id}>{material.name} ({material.unit})</option>)}
                </select>
                <Button className="justify-self-end" type="button" variant="ghost" size="icon" aria-label="Remover item" disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}><Trash2 className="h-3.5 w-3.5" /></Button>
                <input className={fieldClassName} aria-label="Lote" placeholder="Lote" value={row.lotCode} onChange={(event) => update(row.key, { lotCode: event.target.value })} />
                <input className={fieldClassName} aria-label="Validade" type="date" value={row.expiresOn} onChange={(event) => update(row.key, { expiresOn: event.target.value })} />
                <input className={fieldClassName} aria-label="Quantidade" inputMode="decimal" placeholder={`Qtd.${unit ? ` (${unit})` : ""}`} value={row.quantity} onChange={(event) => update(row.key, { quantity: event.target.value })} />
                <input className={fieldClassName} aria-label="Preço unitário" inputMode="decimal" placeholder="R$ 0,00 / un." value={row.price} onChange={(event) => update(row.key, { price: formatCurrency(event.target.value) })} />
              </div>
            );
          })}
          <Button type="button" variant="secondary" size="sm" disabled={!materials.length} onClick={() => { setRows((current) => [...current, { key: nextKey, productId: "", lotCode: "", expiresOn: "", quantity: "", price: "" }]); setNextKey((current) => current + 1); }}><CirclePlus className="h-3.5 w-3.5" />Adicionar item</Button>
        </div>

        <div className="flex items-center justify-between rounded-[8px] bg-muted/60 px-3 py-2.5 text-sm">
          <span className="font-semibold text-muted-foreground">Total da compra{installments > 1 ? ` · ${installments}x de ~${currency.format(totalCents / installments / 100)}` : ""}</span>
          <strong className="text-foreground">{currency.format(totalCents / 100)}</strong>
        </div>
        {error ? <p className="rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318]">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{saving ? "Registrando..." : "Registrar compra"}</Button>
        </div>
      </form>
    </Modal>
  );
}
