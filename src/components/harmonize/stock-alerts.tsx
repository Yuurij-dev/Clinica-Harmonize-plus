"use client";

import { type FormEvent, useEffect, useState } from "react";
import { AlertTriangle, Loader2, PackageX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fieldClassName, FormField } from "@/components/ui/modal";
import { CLIENT_CACHE_INVALIDATED_EVENT, getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { sendJson } from "@/lib/send-json";
import type { StockAlert } from "@/lib/stock-rules";
import { StockKindBadge } from "./stock-kind";

const alertsKey = "/api/stock/alerts";

// Avisos de estoque para administradores: carregados ao entrar e recarregados quando
// uma movimentação invalida a chave. Sem consulta periódica e sem som.
export function useStockAlerts(enabled: boolean) {
  const [alerts, setAlerts] = useState<StockAlert[]>(() => (enabled ? readClientCache<{ alerts: StockAlert[] }>(alertsKey)?.alerts : undefined) ?? []);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    getCachedJson<{ alerts: StockAlert[] }>(alertsKey).then((data) => { if (active) setAlerts(data.alerts); }).catch(() => undefined);
    return () => { active = false; };
  }, [enabled, version]);

  useEffect(() => {
    if (!enabled) return;
    const handle = (event: Event) => { if ((event as CustomEvent<string[]>).detail?.includes(alertsKey)) setVersion((current) => current + 1); };
    window.addEventListener(CLIENT_CACHE_INVALIDATED_EVENT, handle);
    return () => window.removeEventListener(CLIENT_CACHE_INVALIDATED_EVENT, handle);
  }, [enabled]);

  return enabled ? alerts : [];
}

export function StockAlertItem({ alert, onOpen, variant = "boxed" }: { alert: StockAlert; onOpen?: () => void; variant?: "boxed" | "plain" }) {
  const Icon = alert.kind === "below_minimum" ? PackageX : AlertTriangle;
  const tone = alert.kind === "expired" ? "text-destructive" : "text-warning";
  const boxTone = alert.kind === "expired" ? "bg-destructive/10" : "bg-warning/10";
  return (
    <button type="button" className={`flex items-start gap-2 text-left text-[11px] font-semibold leading-5 ${tone} ${variant === "boxed" ? `w-full rounded-md p-3 ${boxTone}` : "w-fit"}`} onClick={onOpen}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{alert.productKind ? <StockKindBadge className="mr-1.5 align-middle" kind={alert.productKind} /> : null}{alert.message}</span>
    </button>
  );
}

export function StockAlertsCard({ onOpen }: { onOpen: (alert: StockAlert) => void }) {
  const alerts = useStockAlerts(true);
  if (!alerts.length) return null;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center" aria-label={`${alerts.length} ${alerts.length === 1 ? "aviso de estoque" : "avisos de estoque"}`}>
      <span className="text-xs font-bold text-muted-foreground">{alerts.length} {alerts.length === 1 ? "aviso" : "avisos"}</span>
      {alerts.map((alert) => <StockAlertItem alert={alert} key={`${alert.kind}-${alert.lotId ?? alert.productId}-${alert.message}`} onOpen={() => onOpen(alert)} variant="plain" />)}
    </div>
  );
}

export function StockSettingsCard({ onSaved }: { onSaved?: (message: string) => void }) {
  const settingsKey = "/api/clinic/stock-settings";
  const [days, setDays] = useState(() => String(readClientCache<{ settings: { expiryWarningDays: number } }>(settingsKey)?.settings.expiryWarningDays ?? 30));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getCachedJson<{ settings: { expiryWarningDays: number } }>(settingsKey).then((data) => { if (active) setDays(String(data.settings.expiryWarningDays)); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const { ok, data } = await sendJson(settingsKey, "PATCH", { expiryWarningDays: Number(days) });
    setSaving(false);
    if (!ok) return setError(data?.message ?? "Não foi possível salvar.");
    invalidateClientCache(settingsKey, alertsKey, "/api/products");
    onSaved?.("Prazo do aviso de vencimento atualizado.");
  }

  return (
    <Card className="mt-6">
      <CardHeader><CardTitle>Estoque</CardTitle></CardHeader>
      <CardContent>
        <form className="flex flex-wrap items-end gap-3" onSubmit={save}>
          <FormField label="Avisar vencimento com quantos dias de antecedência" description="Lotes com saldo que vencem dentro desse prazo aparecem nos avisos.">
            <input className={`${fieldClassName} w-32`} type="number" min="0" max="365" value={days} onChange={(event) => setDays(event.target.value)} required />
          </FormField>
          <Button type="submit" disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Salvar</Button>
        </form>
        {error ? <p className="mt-3 rounded-[7px] bg-[#fff4f4] px-3 py-2 text-xs font-semibold text-[#b42318]">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
