"use client";

import { type FormEvent, useEffect, useState } from "react";
import { Archive, ArchiveRestore, Loader2, PackagePlus, PencilLine, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MaskedInput } from "@/components/ui/masked-input";
import { fieldClassName, FormField, Modal } from "@/components/ui/modal";
import { procedureCategories } from "@/data/categories";
import { sendJson } from "@/lib/send-json";
import { CLIENT_CACHE_INVALIDATED_EVENT, getCachedJson, readClientCache } from "@/lib/client-cache";
import { formatCurrency, parseCurrency } from "@/lib/input-masks";
import { formatQuantity, parseQuantity, stockUnits, validateQuantity, type LotStatus, type ManualReason } from "@/lib/stock-rules";
import { LotUsage, ManualMovementForm, MovementHistory } from "./stock-movements";
import { PurchasesPanel } from "./purchases-panel";
import { EmptyState, LoadingTable, MiniTable, SectionIntro } from "./shared";
import { formatDateOnly, invalidateStockCache, type StockMaterial } from "./stock-shared";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

type StockLotRow = { id: string; code: string; expiresOn: string; balance: number; status: LotStatus };
type StockMaterialDetail = StockMaterial & { lots: StockLotRow[]; warningDays: number };

const lotStatusBadge: Record<LotStatus, { label: string; variant: "green" | "amber" | "red" }> = {
  valid: { label: "Válido", variant: "green" },
  expiring: { label: "Vencendo", variant: "amber" },
  expired: { label: "Vencido", variant: "red" },
};

export function StockSection({ onSaved }: { onSaved?: (message: string) => void }) {
  const [showArchived, setShowArchived] = useState(false);
  const listKey = showArchived ? "/api/products?archived=1" : "/api/products";
  const [materials, setMaterials] = useState<StockMaterial[]>(() => readClientCache<{ products?: StockMaterial[] }>(listKey)?.products ?? []);
  const [loading, setLoading] = useState(!readClientCache(listKey));
  const [refreshKey, setRefreshKey] = useState(0);
  const [editing, setEditing] = useState<StockMaterial | "new" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<"materials" | "purchases">("materials");
  const [creatingPurchase, setCreatingPurchase] = useState(false);

  useEffect(() => {
    // Compras, saídas e conferências mudam saldos: recarrega quando o cache de materiais é invalidado.
    const handle = (event: Event) => { if ((event as CustomEvent<string[]>).detail?.includes("/api/products")) setRefreshKey((current) => current + 1); };
    window.addEventListener(CLIENT_CACHE_INVALIDATED_EVENT, handle);
    return () => window.removeEventListener(CLIENT_CACHE_INVALIDATED_EVENT, handle);
  }, []);

  useEffect(() => {
    let active = true;
    getCachedJson<{ products?: StockMaterial[] }>(listKey)
      .then((data) => { if (active) setMaterials(data.products ?? []); })
      .catch(() => undefined)
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [listKey, refreshKey]);

  function refresh(productId?: string) {
    invalidateStockCache(productId);
  }

  return (
    <div>
      <SectionIntro title="Estoque" description="Materiais, lotes, validades, compras e saldo disponível da clínica." action={tab === "materials" ? "Novo material" : "Nova compra"} onAction={() => tab === "materials" ? setEditing("new") : setCreatingPurchase(true)} />
      <div className="mb-4 flex gap-2">
        <Button variant={tab === "materials" ? "primary" : "secondary"} size="sm" onClick={() => setTab("materials")}>Materiais</Button>
        <Button variant={tab === "purchases" ? "primary" : "secondary"} size="sm" onClick={() => setTab("purchases")}>Compras</Button>
      </div>
      {tab === "purchases" ? <PurchasesPanel materials={materials} creating={creatingPurchase} onCloseCreate={() => setCreatingPurchase(false)} onSaved={onSaved} /> : <>
      <label className="mb-4 flex w-fit items-center gap-2 text-xs font-semibold text-muted-foreground">
        <input type="checkbox" checked={showArchived} onChange={(event) => { setLoading(true); setShowArchived(event.target.checked); }} />
        Mostrar arquivados
      </label>
      {loading ? <LoadingTable columns={7} /> : materials.length ? (
        <div className="overflow-x-auto">
          <MiniTable
            columns={["Material", "Unidade", "Saldo", "Mínimo", "Custo", "Situação", "Ação"]}
            rows={materials.map((material) => [
              <div key="name"><p className="font-bold text-foreground">{material.name}</p><p className="text-xs text-muted-foreground">{material.category} · {material.supplier}</p></div>,
              material.unit,
              <strong key="balance">{formatQuantity(material.balance, material.unit)}</strong>,
              formatQuantity(material.minStock, material.unit),
              `${currency.format(material.costCents / 100)} / ${material.unit}`,
              material.archivedAt ? <Badge key="status" variant="slate">Arquivado</Badge> : material.belowMinimum ? <Badge key="status" variant="amber">Abaixo do mínimo</Badge> : <Badge key="status" variant="green">OK</Badge>,
              <Button key="open" size="sm" variant="secondary" onClick={() => setOpenId(material.id)}>Abrir</Button>,
            ])}
          />
        </div>
      ) : <EmptyState title="Nenhum material cadastrado" description="Cadastre os materiais da clínica para controlar saldo, lotes e validades." />}
      </>}

      {editing ? <MaterialFormModal material={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(material, created) => {
        setEditing(null);
        refresh(material.id);
        onSaved?.(created ? `${material.name} foi adicionado ao estoque.` : `${material.name} foi atualizado.`);
      }} /> : null}
      {openId ? <MaterialDetailModal productId={openId} onClose={() => setOpenId(null)} onEdit={(material) => { setOpenId(null); setEditing(material); }} onChanged={(message) => { refresh(openId); if (message) onSaved?.(message); }} onRemoved={(message) => { setOpenId(null); refresh(); onSaved?.(message); }} /> : null}
    </div>
  );
}

function MaterialFormModal({ material, onClose, onSaved }: { material: StockMaterial | null; onClose: () => void; onSaved: (material: StockMaterial, created: boolean) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const minStock = parseQuantity(String(form.get("minStock") ?? "0") || "0");
    if (!Number.isFinite(minStock) || minStock < 0) {
      setError("Informe um estoque mínimo válido.");
      return;
    }
    const payload = {
      name: String(form.get("name") ?? "").trim(),
      category: String(form.get("category") ?? ""),
      supplier: String(form.get("supplier") ?? "").trim(),
      unit: String(form.get("unit") ?? ""),
      costCents: Math.round(parseCurrency(form.get("cost")) * 100),
      minStock,
    };
    setSaving(true);
    setError("");
    const { ok, data } = await sendJson<{ product?: StockMaterial }>(material ? `/api/products/${material.id}` : "/api/products", material ? "PATCH" : "POST", payload);
    setSaving(false);
    if (!ok || !data?.product) {
      setError(data?.message ?? "Não foi possível salvar o material.");
      return;
    }
    onSaved(data.product, !material);
  }

  return (
    <Modal open onClose={onClose} title={material ? "Editar material" : "Novo material"} description="O custo é atualizado sozinho a cada compra, mas pode ser editado aqui.">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <div className="sm:col-span-2"><FormField label="Nome"><input className={fieldClassName} name="name" defaultValue={material?.name ?? ""} required /></FormField></div>
        <FormField label="Categoria"><select className={fieldClassName} name="category" defaultValue={material?.category ?? ""} required><option value="">Selecione uma categoria</option>{procedureCategories.map((category) => <option key={category}>{category}</option>)}</select></FormField>
        <FormField label="Fornecedor"><input className={fieldClassName} name="supplier" defaultValue={material?.supplier ?? ""} required /></FormField>
        <FormField label="Unidade" description={material?.hasMovements ? "Não pode ser trocada: o material já teve movimentações." : undefined}>
          <select className={fieldClassName} name="unit" defaultValue={material?.unit ?? "ml"} disabled={material?.hasMovements}>{stockUnits.map((unit) => <option key={unit}>{unit}</option>)}</select>
          {material?.hasMovements ? <input type="hidden" name="unit" value={material.unit} /> : null}
        </FormField>
        <FormField label="Custo unitário"><MaskedInput className={fieldClassName} formatter={formatCurrency} name="cost" inputMode="decimal" placeholder="R$ 0,00" defaultValue={material ? currency.format(material.costCents / 100) : ""} required /></FormField>
        <FormField label="Estoque mínimo" description="Abaixo disso o material aparece nos avisos."><input className={fieldClassName} name="minStock" inputMode="decimal" placeholder="0" defaultValue={material ? String(material.minStock).replace(".", ",") : ""} /></FormField>
        {error ? <p className="rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318] sm:col-span-2">{error}</p> : null}
        <div className="mt-2 flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{saving ? "Salvando..." : "Salvar material"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function MaterialDetailModal({ productId, onClose, onEdit, onChanged, onRemoved }: { productId: string; onClose: () => void; onEdit: (material: StockMaterial) => void; onChanged: (message?: string) => void; onRemoved: (message: string) => void }) {
  const detailKey = `/api/products/${productId}`;
  const [detail, setDetail] = useState<StockMaterialDetail | null>(() => readClientCache<{ product?: StockMaterialDetail }>(detailKey)?.product ?? null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"initial" | "archive" | "delete" | null>(null);
  const [movementForm, setMovementForm] = useState<{ lotId: string; reason: ManualReason; quantity?: number } | null>(null);
  const [history, setHistory] = useState<{ lotId?: string; lotCode?: string } | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [usageLot, setUsageLot] = useState<{ id: string; code: string } | null>(null);

  useEffect(() => {
    let active = true;
    getCachedJson<{ product?: StockMaterialDetail }>(detailKey)
      .then((data) => { if (active) setDetail(data.product ?? null); })
      .catch(() => { if (active) setError("Não foi possível carregar o material."); });
    return () => { active = false; };
  }, [detailKey]);

  async function addInitialBalance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const quantity = parseQuantity(String(form.get("quantity") ?? ""));
    const quantityError = validateQuantity(quantity, detail.unit);
    if (quantityError) {
      setError(quantityError);
      return;
    }
    setBusy("initial");
    setError("");
    const { ok, data } = await sendJson<{ product?: StockMaterialDetail }>(`${detailKey}/initial-balance`, "POST", { lotCode: String(form.get("lotCode") ?? ""), expiresOn: String(form.get("expiresOn") ?? ""), quantity });
    setBusy(null);
    if (!ok || !data?.product) {
      setError(data?.message ?? "Não foi possível lançar o saldo.");
      return;
    }
    setDetail(data.product);
    formElement.reset();
    setHistoryVersion((current) => current + 1);
    onChanged(`Saldo inicial lançado em ${data.product.name}.`);
  }

  async function toggleArchive() {
    if (!detail) return;
    setBusy("archive");
    setError("");
    const { ok, data } = await sendJson<{ product?: StockMaterialDetail }>(detailKey, "PATCH", { archived: !detail.archivedAt });
    setBusy(null);
    if (!ok || !data?.product) {
      setError(data?.message ?? "Não foi possível atualizar o material.");
      return;
    }
    setDetail(data.product);
    onChanged(data.product.archivedAt ? `${data.product.name} foi arquivado.` : `${data.product.name} voltou para a lista.`);
  }

  async function remove() {
    if (!detail) return;
    setBusy("delete");
    setError("");
    const { ok, data } = await sendJson<{ message?: string }>(detailKey, "DELETE");
    setBusy(null);
    if (!ok) {
      setError(data?.message ?? "Não foi possível apagar o material.");
      return;
    }
    onRemoved(`${detail.name} foi apagado.`);
  }

  return (
    <Modal open onClose={onClose} title={detail?.name ?? "Material"} description={detail ? `${detail.category} · ${detail.supplier}` : undefined}>
      {!detail ? <div className="grid place-items-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div> : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="p-3"><p className="text-[10px] font-bold uppercase text-muted-foreground">Saldo</p><p className="mt-1 text-lg font-black text-foreground">{formatQuantity(detail.balance, detail.unit)}</p></Card>
            <Card className="p-3"><p className="text-[10px] font-bold uppercase text-muted-foreground">Mínimo</p><p className="mt-1 text-lg font-black text-foreground">{formatQuantity(detail.minStock, detail.unit)}</p></Card>
            <Card className="p-3"><p className="text-[10px] font-bold uppercase text-muted-foreground">Custo</p><p className="mt-1 text-lg font-black text-foreground">{currency.format(detail.costCents / 100)}</p></Card>
          </div>
          {detail.belowMinimum && !detail.archivedAt ? <p className="rounded-[7px] bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">Saldo abaixo do estoque mínimo.</p> : null}

          <div>
            <h3 className="mb-2 text-sm font-bold text-foreground">Lotes</h3>
            {detail.lots.length ? (
              <div className="divide-y divide-border rounded-[8px] border border-border">
                {detail.lots.map((lot) => (
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm" key={lot.id}>
                    <div><p className="font-bold text-foreground">Lote {lot.code}</p><p className="text-xs text-muted-foreground">Validade {formatDateOnly(lot.expiresOn)}</p></div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <strong>{formatQuantity(lot.balance, detail.unit)}</strong><Badge variant={lotStatusBadge[lot.status].variant}>{lotStatusBadge[lot.status].label}</Badge>
                      {lot.status === "expired" && lot.balance > 0 ? <Button size="sm" variant="secondary" onClick={() => setMovementForm({ lotId: lot.id, reason: "expired", quantity: lot.balance })}>Descartar</Button> : null}
                      {!detail.archivedAt ? <Button size="sm" variant="secondary" onClick={() => setMovementForm({ lotId: lot.id, reason: "loss" })}>Saída</Button> : null}
                      <Button size="sm" variant="ghost" onClick={() => setHistory({ lotId: lot.id, lotCode: lot.code })}>Histórico</Button>
                      <Button size="sm" variant="ghost" onClick={() => setUsageLot({ id: lot.id, code: lot.code })}>Pacientes</Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-muted-foreground">Nenhum lote lançado ainda.</p>}
            {detail.lots.length ? <div className="mt-2 flex justify-end"><Button size="sm" variant="ghost" onClick={() => setHistory({})}>Ver histórico do material</Button></div> : null}
          </div>

          {movementForm ? <ManualMovementForm<StockMaterialDetail> key={`${movementForm.lotId}-${movementForm.reason}`} productId={detail.id} unit={detail.unit} lots={detail.lots} initial={movementForm} onCancel={() => setMovementForm(null)} onSaved={(product) => { setDetail(product); setMovementForm(null); setHistoryVersion((current) => current + 1); onChanged(`Movimentação registrada em ${product.name}.`); }} /> : null}
          {usageLot ? <LotUsage key={`${usageLot.id}-${historyVersion}`} productId={detail.id} unit={detail.unit} lotId={usageLot.id} lotCode={usageLot.code} /> : null}
          {history ? <MovementHistory key={`${history.lotId ?? "all"}-${historyVersion}`} productId={detail.id} unit={detail.unit} lotId={history.lotId} lotCode={history.lotCode} /> : null}

          {!detail.archivedAt ? (
            <form className="grid gap-3 rounded-[8px] border border-dashed border-border p-3 sm:grid-cols-3" onSubmit={addInitialBalance}>
              <p className="text-xs font-bold text-foreground sm:col-span-3">Lançar saldo inicial <span className="font-medium text-muted-foreground">(o que já está na prateleira, sem gerar despesa)</span></p>
              <FormField label="Lote"><input className={fieldClassName} name="lotCode" required /></FormField>
              <FormField label="Validade"><input className={fieldClassName} name="expiresOn" type="date" required /></FormField>
              <FormField label={`Quantidade (${detail.unit})`}><input className={fieldClassName} name="quantity" inputMode="decimal" required /></FormField>
              <div className="flex justify-end sm:col-span-3"><Button type="submit" size="sm" disabled={busy !== null}>{busy === "initial" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackagePlus className="h-3.5 w-3.5" />}Lançar saldo</Button></div>
            </form>
          ) : null}

          {error ? <p className="rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318]">{error}</p> : null}
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            {!detail.hasMovements ? <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void remove()}>{busy === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}Apagar</Button> : null}
            <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void toggleArchive()}>{busy === "archive" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : detail.archivedAt ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}{detail.archivedAt ? "Desarquivar" : "Arquivar"}</Button>
            <Button type="button" disabled={busy !== null} onClick={() => onEdit(detail)}><PencilLine className="h-3.5 w-3.5" />Editar</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
