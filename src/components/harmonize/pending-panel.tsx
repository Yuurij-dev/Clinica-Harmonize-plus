"use client";

import { useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fieldClassName } from "@/components/ui/modal";
import { CLIENT_CACHE_INVALIDATED_EVENT, getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { sendJson } from "@/lib/send-json";
import { attendanceKindLabels, formatQuantity, type AttendanceKind, type StockKind } from "@/lib/stock-rules";
import { MaterialCheckModal } from "./material-check-modal";
import { EmptyState } from "./shared";
import { StockKindBadge } from "./stock-kind";
import { formatDateOnly, invalidateStockCache } from "./stock-shared";

const pendingKey = "/api/stock/pending";

type PendingOutput = { id: string; quantity: number; attendanceKind: AttendanceKind; attendanceName: string; attendanceDate: string; patientName: string | null; product: { id: string; name: string; kind: StockKind; unit: string }; lots: Array<{ id: string; code: string; expiresOn: string; balance: number }> };
type PendingCheck = { id: string; procedure: string; date: string; time: string; patientName: string };

export function PendingPanel({ onSaved }: { onSaved?: (message: string) => void }) {
  const [data, setData] = useState<{ outputs: PendingOutput[]; checks: PendingCheck[] } | null>(() => readClientCache(pendingKey) ?? null);
  const [version, setVersion] = useState(0);
  const [checkId, setCheckId] = useState<string | null>(null);
  const [selectedLots, setSelectedLots] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pendingFilter, setPendingFilter] = useState<"all" | "checks" | "outputs" | AttendanceKind>("all");

  useEffect(() => {
    let active = true;
    getCachedJson<{ outputs: PendingOutput[]; checks: PendingCheck[] }>(pendingKey).then((result) => { if (active) setData(result); }).catch(() => { if (active) setData({ outputs: [], checks: [] }); });
    return () => { active = false; };
  }, [version]);

  useEffect(() => {
    const handle = (event: Event) => { if ((event as CustomEvent<string[]>).detail?.some((key) => key === pendingKey || key === "/api/products")) setVersion((current) => current + 1); };
    window.addEventListener(CLIENT_CACHE_INVALIDATED_EVENT, handle);
    return () => window.removeEventListener(CLIENT_CACHE_INVALIDATED_EVENT, handle);
  }, []);

  async function conclude(output: PendingOutput) {
    setBusyId(output.id);
    setError("");
    const { ok, data: result } = await sendJson(`${pendingKey}/${output.id}`, "POST", { lotId: selectedLots[output.id] || undefined });
    setBusyId(null);
    if (!ok) return setError(result?.message ?? "Não foi possível concluir a saída.");
    invalidateStockCache(output.product.id);
    onSaved?.(`Saída de ${output.product.name} concluída.`);
  }

  if (!data) return <div className="grid place-items-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  const showChecks = pendingFilter === "all" || pendingFilter === "checks";
  const showOutputs = pendingFilter === "all" || pendingFilter === "outputs" || pendingFilter === "procedure" || pendingFilter === "return" || pendingFilter === "evaluation";
  const visibleOutputs = data.outputs.filter((output) => pendingFilter === "all" || pendingFilter === "outputs" || output.attendanceKind === pendingFilter);
  return (
    <div className="space-y-6">
      <label className="flex w-fit flex-col gap-1 text-[11px] font-semibold text-muted-foreground">Tipo de pendência
        <select className={`${fieldClassName} h-9 min-w-[220px] py-1 text-xs`} value={pendingFilter} onChange={(event) => setPendingFilter(event.target.value as typeof pendingFilter)}>
          <option value="all">Todas as pendências</option><option value="checks">Conferências de materiais e produtos</option><option value="outputs">Saídas pendentes</option><option value="procedure">Saídas · Procedimentos</option><option value="return">Saídas · Retornos</option><option value="evaluation">Saídas · Avaliações</option>
        </select>
      </label>
      {error ? <p className="rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318]">{error}</p> : null}
      {showChecks ? <section>
        <h3 className="mb-2 text-sm font-bold text-foreground">Conferências de materiais e produtos pendentes</h3>
        <p className="mb-3 text-xs text-muted-foreground">Atendimentos finalizados (inclusive automaticamente pela agenda) cujos materiais e produtos ainda não foram conferidos.</p>
        {data.checks.length ? (
          <div className="divide-y divide-border rounded-lg border border-border bg-card">
            {data.checks.map((check) => (
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm" key={check.id}>
                <div><p className="font-bold text-foreground">{check.patientName}</p><p className="text-xs text-muted-foreground">{check.procedure} · {new Date(check.date).toLocaleDateString("pt-BR")} às {check.time}</p></div>
                <Button size="sm" onClick={() => setCheckId(check.id)}>Conferir</Button>
              </div>
            ))}
          </div>
        ) : <EmptyState title="Nenhuma conferência pendente" description="Todos os atendimentos finalizados já tiveram os materiais e produtos conferidos." />}
      </section> : null}

      {showOutputs ? <section>
        <h3 className="mb-2 text-sm font-bold text-foreground">Saídas pendentes</h3>
        <p className="mb-3 text-xs text-muted-foreground">Materiais e produtos usados em atendimentos quando não havia saldo. Registre a compra ou o ajuste e conclua a saída aqui.</p>
        {visibleOutputs.length ? (
          <div className="divide-y divide-border rounded-lg border border-border bg-card">
            {visibleOutputs.map((output) => (
              <div className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between" key={output.id}>
                <div className="min-w-0">
                  <p className="font-bold text-foreground">{formatQuantity(output.quantity, output.product.unit)} {output.product.name} <StockKindBadge className="ml-1 align-middle" kind={output.product.kind} /></p>
                  <p className="text-xs text-muted-foreground">{[output.patientName, attendanceKindLabels[output.attendanceKind], output.attendanceName, new Date(output.attendanceDate).toLocaleDateString("pt-BR")].filter(Boolean).join(" · ")}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select className={`${fieldClassName} h-9 w-auto text-xs`} aria-label="Lote" value={selectedLots[output.id] ?? ""} onChange={(event) => setSelectedLots((current) => ({ ...current, [output.id]: event.target.value }))}>
                    <option value="">Lote que vence primeiro</option>
                    {output.lots.map((lot) => <option key={lot.id} value={lot.id}>Lote {lot.code} · val. {formatDateOnly(lot.expiresOn)} · saldo {formatQuantity(lot.balance, output.product.unit)}</option>)}
                  </select>
                  <Button size="sm" disabled={busyId === output.id || !output.lots.length} onClick={() => void conclude(output)}>{busyId === output.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Concluir saída</Button>
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyState title={pendingFilter === "all" || pendingFilter === "outputs" ? "Nenhuma saída pendente" : `Nenhuma saída pendente de ${attendanceKindLabels[pendingFilter]}`} description="Quando faltar saldo numa conferência, a saída aparece aqui para ser concluída depois." />}
      </section> : null}
      {checkId ? <MaterialCheckModal appointmentId={checkId} onClose={() => setCheckId(null)} onDone={(message) => { setCheckId(null); invalidateClientCache(pendingKey); onSaved?.(message); }} /> : null}
    </div>
  );
}

// Estorno de uma saída de atendimento registrada errada, com motivo obrigatório.
export function ReverseMovementButton({ movementId, productId, onReversed }: { movementId: string; productId: string; onReversed?: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!open) return <Button size="sm" variant="ghost" onClick={() => setOpen(true)}><RotateCcw className="h-3 w-3" />Estornar</Button>;
  return (
    <div className="mt-1 flex w-full flex-wrap items-center gap-2">
      <input className={`${fieldClassName} h-8 flex-1 text-xs`} placeholder="Motivo do estorno" value={reason} onChange={(event) => setReason(event.target.value)} />
      <Button size="sm" variant="secondary" disabled={saving} onClick={() => setOpen(false)}>Cancelar</Button>
      <Button size="sm" disabled={saving || !reason.trim()} onClick={async () => {
        setSaving(true);
        setError("");
        const { ok, data } = await sendJson(`/api/stock/movements/${movementId}/reverse`, "POST", { reason });
        setSaving(false);
        if (!ok) return setError(data?.message ?? "Não foi possível estornar.");
        invalidateStockCache(productId);
        invalidateClientCache("/api/patients");
        setOpen(false);
        onReversed?.();
      }}>{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}Confirmar estorno</Button>
      {error ? <p className="w-full text-[11px] font-semibold text-destructive">{error}</p> : null}
    </div>
  );
}
