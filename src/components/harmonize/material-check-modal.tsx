"use client";

import { useEffect, useState } from "react";
import { CirclePlus, Loader2, Split, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fieldClassName, Modal } from "@/components/ui/modal";
import { invalidateClientCache } from "@/lib/client-cache";
import { clinicToday } from "@/lib/clinic-time";
import { sendJson } from "@/lib/send-json";
import { allocateLots, attendanceKindLabels, formatQuantity, parseQuantity, roundQuantity, validateQuantity, type AttendanceKind } from "@/lib/stock-rules";
import { formatDateOnly, invalidateStockCache } from "./stock-shared";

type Lot = { id: string; code: string; expiresOn: string; balance: number };
type Material = { id: string; name: string; unit: string; lots: Lot[] };
type CheckData = {
  appointment: { id: string; kind: AttendanceKind; name: string; date: string; status: string; materialsCheck: string | null; patientName: string };
  suggestions: Array<{ productId: string; quantity: number }>;
  materials: Material[];
};
type AllocationRow = { key: number; lotId: string; quantity: string };
type ItemRow = { key: number; productId: string; quantity: string; allocations: AllocationRow[] };

let rowKey = 0;
const nextKey = () => ++rowKey;
const quantityText = (value: number) => String(roundQuantity(value)).replace(".", ",");

function suggestAllocations(material: Material | undefined, quantity: number): AllocationRow[] {
  if (!material || !Number.isFinite(quantity) || quantity <= 0) return [];
  return allocateLots(quantity, material.lots, clinicToday()).allocations.map((allocation) => ({ key: nextKey(), lotId: allocation.lotId, quantity: quantityText(allocation.quantity) }));
}

// Conferência de materiais ao finalizar um atendimento. Num procedimento vem preenchida pela
// ficha técnica; em retorno e avaliação vem vazia e pode ser pulada. Nunca bloqueia o atendimento:
// o que faltar de saldo vira saída pendente.
export function MaterialCheckModal({ appointmentId, onClose, onDone }: { appointmentId: string; onClose: () => void; onDone: (message: string) => void }) {
  const [data, setData] = useState<CheckData | null>(null);
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    // Sem cache: os saldos precisam estar atualizados na hora da conferência.
    fetch(`/api/appointments/${appointmentId}/materials`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json().catch(() => null) as (CheckData & { message?: string }) | null;
        if (!active) return;
        if (!response.ok || !result) return setError(result?.message ?? "Não foi possível carregar a conferência.");
        setData(result);
        setRows(result.suggestions.map((suggestion) => ({ key: nextKey(), productId: suggestion.productId, quantity: quantityText(suggestion.quantity), allocations: suggestAllocations(result.materials.find((material) => material.id === suggestion.productId), suggestion.quantity) })));
      })
      .catch(() => { if (active) setError("Sem conexão com o servidor. Tente novamente."); });
    return () => { active = false; };
  }, [appointmentId]);

  const materialOf = (productId: string) => data?.materials.find((material) => material.id === productId);

  function updateRow(key: number, patch: Partial<ItemRow>) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
  }

  function changeProduct(row: ItemRow, productId: string) {
    updateRow(row.key, { productId, allocations: suggestAllocations(materialOf(productId), parseQuantity(row.quantity)) });
  }

  function changeQuantity(row: ItemRow, text: string) {
    updateRow(row.key, { quantity: text, allocations: suggestAllocations(materialOf(row.productId), parseQuantity(text)) });
  }

  function updateAllocation(row: ItemRow, key: number, patch: Partial<AllocationRow>) {
    updateRow(row.key, { allocations: row.allocations.map((allocation) => allocation.key === key ? { ...allocation, ...patch } : allocation) });
  }

  async function submit(skip = false) {
    if (!data) return;
    const items = [];
    if (!skip) {
      for (const row of rows) {
        const material = materialOf(row.productId);
        if (!material) return setError("Escolha o material de cada item.");
        const quantity = parseQuantity(row.quantity);
        const quantityError = validateQuantity(quantity, material.unit);
        if (quantityError) return setError(`${material.name}: ${quantityError}`);
        const allocations = [];
        for (const allocation of row.allocations) {
          const allocated = parseQuantity(allocation.quantity);
          const allocationError = validateQuantity(allocated, material.unit);
          if (allocationError) return setError(`${material.name}: ${allocationError}`);
          allocations.push({ lotId: allocation.lotId, quantity: allocated });
        }
        items.push({ productId: material.id, quantity, allocations });
      }
    }
    setSaving(true);
    setError("");
    const { ok, data: result } = await sendJson<{ pending?: Array<{ name: string; unit: string; quantity: number }> }>(`/api/appointments/${appointmentId}/materials`, "POST", skip ? { skip: true } : { items });
    setSaving(false);
    if (!ok) return setError(result?.message ?? "Não foi possível registrar a conferência.");
    invalidateStockCache();
    invalidateClientCache("/api/stock/pending");
    const pending = result?.pending ?? [];
    onDone(skip ? "Conferência pulada." : pending.length ? `Materiais registrados. Saída pendente por falta de saldo: ${pending.map((item) => `${formatQuantity(item.quantity, item.unit)} ${item.name}`).join(", ")}.` : "Materiais registrados no estoque.");
  }

  const kind = data?.appointment.kind;
  return (
    <Modal open onClose={onClose} closeOnOverlayClick={false} title="Conferência de materiais" description={data ? `${attendanceKindLabels[data.appointment.kind]} · ${data.appointment.name} · ${data.appointment.patientName}` : undefined}>
      {!data ? (error ? <p className="rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318]">{error}</p> : <div className="grid place-items-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>) : (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">{kind === "procedure" ? "Confira os materiais da ficha técnica: ajuste quantidades, lotes ou adicione o que mais foi usado." : "Se usou algum material (por exemplo, num retoque), adicione abaixo. Caso contrário, pule."}</p>
          {rows.map((row) => {
            const material = materialOf(row.productId);
            const quantity = parseQuantity(row.quantity);
            const allocated = roundQuantity(row.allocations.reduce((sum, allocation) => sum + (parseQuantity(allocation.quantity) || 0), 0));
            const missing = Number.isFinite(quantity) ? roundQuantity(quantity - allocated) : 0;
            return (
              <div className="space-y-2 rounded-[8px] border border-border p-3" key={row.key}>
                <div className="grid grid-cols-[1fr_110px_auto] items-center gap-2">
                  <select className={fieldClassName} aria-label="Material" value={row.productId} onChange={(event) => changeProduct(row, event.target.value)}>
                    <option value="">Selecione o material</option>
                    {data.materials.map((option) => <option key={option.id} value={option.id}>{option.name} ({option.unit})</option>)}
                  </select>
                  <input className={fieldClassName} aria-label="Quantidade usada" inputMode="decimal" value={row.quantity} onChange={(event) => changeQuantity(row, event.target.value)} />
                  <Button type="button" variant="ghost" size="icon" aria-label="Remover material" onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
                {material ? <div className="space-y-1.5 pl-2">
                  {row.allocations.map((allocation) => (
                    <div className="grid grid-cols-[1fr_100px_auto] items-center gap-2" key={allocation.key}>
                      <select className={`${fieldClassName} h-9 text-xs`} aria-label="Lote" value={allocation.lotId} onChange={(event) => updateAllocation(row, allocation.key, { lotId: event.target.value })}>
                        {material.lots.map((lot) => <option key={lot.id} value={lot.id}>Lote {lot.code} · val. {formatDateOnly(lot.expiresOn)} · saldo {formatQuantity(lot.balance, material.unit)}</option>)}
                      </select>
                      <input className={`${fieldClassName} h-9 text-xs`} aria-label="Quantidade do lote" inputMode="decimal" value={allocation.quantity} onChange={(event) => updateAllocation(row, allocation.key, { quantity: event.target.value })} />
                      <Button type="button" variant="ghost" size="icon" aria-label="Remover lote" onClick={() => updateRow(row.key, { allocations: row.allocations.filter((item) => item.key !== allocation.key) })}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  ))}
                  {material.lots.length ? <Button type="button" variant="ghost" size="sm" onClick={() => updateRow(row.key, { allocations: [...row.allocations, { key: nextKey(), lotId: material.lots[0].id, quantity: missing > 0 ? quantityText(missing) : "" }] })}><Split className="h-3.5 w-3.5" />Dividir em outro lote</Button> : <p className="text-[11px] font-semibold text-warning">Nenhum lote válido com saldo.</p>}
                  {missing > 0 ? <p className="text-[11px] font-semibold text-warning">Faltam {formatQuantity(missing, material.unit)}: ficarão como saída pendente.</p> : null}
                  {missing < 0 ? <p className="text-[11px] font-semibold text-destructive">Os lotes somam mais que a quantidade usada.</p> : null}
                </div> : null}
              </div>
            );
          })}
          <Button type="button" variant="secondary" size="sm" onClick={() => setRows((current) => [...current, { key: nextKey(), productId: "", quantity: "1", allocations: [] }])}><CirclePlus className="h-3.5 w-3.5" />Adicionar material</Button>
          {error ? <p className="rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318]">{error}</p> : null}
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Conferir depois</Button>
            {kind !== "procedure" ? <Button type="button" variant="secondary" disabled={saving} onClick={() => void submit(true)}>Pular</Button> : null}
            <Button type="button" disabled={saving} onClick={() => void submit()}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Confirmar materiais</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
