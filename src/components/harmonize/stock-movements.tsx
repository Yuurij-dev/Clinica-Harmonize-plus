"use client";

import { type FormEvent, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fieldClassName, FormField } from "@/components/ui/modal";
import { getCachedJson, readClientCache } from "@/lib/client-cache";
import { sendJson } from "@/lib/send-json";
import { formatQuantity, manualReasons, parseQuantity, type ManualReason } from "@/lib/stock-rules";

export const movementTypeLabels: Record<string, string> = {
  initial: "Saldo inicial",
  purchase: "Entrada por compra",
  attendance: "Saída em atendimento",
  manual_out: "Saída manual",
  count_adjustment: "Correção de contagem",
  reversal: "Estorno",
  purchase_cancel: "Cancelamento de compra",
};

type Movement = { id: string; type: string; quantity: number; reason: string | null; notes: string; userName: string; createdAt: string; lotCode: string };
type LotOption = { id: string; code: string; balance: number };

export function ManualMovementForm<T>({ productId, unit, lots, initial, onSaved, onCancel }: { productId: string; unit: string; lots: LotOption[]; initial: { lotId: string; reason: ManualReason; quantity?: number }; onSaved: (product: T) => void; onCancel: () => void }) {
  const [reason, setReason] = useState<ManualReason>(initial.reason);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    const { ok, data } = await sendJson<{ product?: T }>(`/api/products/${productId}/movements`, "POST", {
      lotId: String(form.get("lotId") ?? ""),
      reason,
      direction: String(form.get("direction") ?? "out"),
      quantity: parseQuantity(String(form.get("quantity") ?? "")),
      notes: String(form.get("notes") ?? ""),
    });
    setSaving(false);
    if (!ok || !data?.product) return setError(data?.message ?? "Não foi possível registrar a movimentação.");
    onSaved(data.product);
  }

  return (
    <form className="grid gap-3 rounded-[8px] border border-border bg-muted/30 p-3 sm:grid-cols-2" onSubmit={submit}>
      <p className="text-xs font-bold text-foreground sm:col-span-2">Saída manual ou correção de contagem</p>
      <FormField label="Lote"><select className={fieldClassName} name="lotId" defaultValue={initial.lotId}>{lots.map((lot) => <option key={lot.id} value={lot.id}>{lot.code} · saldo {formatQuantity(lot.balance, unit)}</option>)}</select></FormField>
      <FormField label="Motivo"><select className={fieldClassName} value={reason} onChange={(event) => setReason(event.target.value as ManualReason)}>{(Object.keys(manualReasons) as ManualReason[]).map((key) => <option key={key} value={key}>{manualReasons[key]}</option>)}</select></FormField>
      {reason === "count" ? <FormField label="Ajuste"><select className={fieldClassName} name="direction" defaultValue="out"><option value="out">Tirar do saldo</option><option value="in">Somar ao saldo</option></select></FormField> : null}
      <FormField label={`Quantidade (${unit})`}><input className={fieldClassName} name="quantity" inputMode="decimal" defaultValue={initial.quantity === undefined ? "" : String(initial.quantity).replace(".", ",")} required /></FormField>
      <div className="sm:col-span-2"><FormField label="Observação"><input className={fieldClassName} name="notes" placeholder="Obrigatória: explique o motivo" required /></FormField></div>
      {error ? <p className="rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318] sm:col-span-2">{error}</p> : null}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={onCancel}>Cancelar</Button>
        <Button type="submit" size="sm" disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Registrar</Button>
      </div>
    </form>
  );
}

export function MovementHistory({ productId, unit, lotId, lotCode }: { productId: string; unit: string; lotId?: string; lotCode?: string }) {
  const key = `/api/products/${productId}/movements${lotId ? `?lotId=${lotId}` : ""}`;
  const [movements, setMovements] = useState<Movement[] | null>(() => readClientCache<{ movements: Movement[] }>(key)?.movements ?? null);

  useEffect(() => {
    let active = true;
    getCachedJson<{ movements: Movement[] }>(key).then((data) => { if (active) setMovements(data.movements); }).catch(() => { if (active) setMovements([]); });
    return () => { active = false; };
  }, [key]);

  return (
    <div>
      <h3 className="mb-2 text-sm font-bold text-foreground">Histórico{lotCode ? ` do lote ${lotCode}` : " de movimentações"}</h3>
      {!movements ? <div className="grid place-items-center py-6"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div> : movements.length ? (
        <div className="max-h-72 divide-y divide-border overflow-y-auto rounded-[8px] border border-border">
          {movements.map((movement) => (
            <div className="flex items-start justify-between gap-3 px-3 py-2 text-xs" key={movement.id}>
              <div className="min-w-0">
                <p className="font-bold text-foreground">{movementTypeLabels[movement.type] ?? movement.type}{movement.reason && movement.reason in manualReasons ? ` · ${manualReasons[movement.reason as ManualReason]}` : ""}</p>
                <p className="text-muted-foreground">Lote {movement.lotCode} · {new Date(movement.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}{movement.userName ? ` · ${movement.userName}` : ""}</p>
                {movement.notes ? <p className="text-muted-foreground">{movement.notes}</p> : null}
              </div>
              <strong className={movement.quantity < 0 ? "text-destructive" : "text-success"}>{movement.quantity > 0 ? "+" : ""}{formatQuantity(movement.quantity, unit)}</strong>
            </div>
          ))}
        </div>
      ) : <p className="text-xs text-muted-foreground">Nenhuma movimentação ainda.</p>}
    </div>
  );
}
