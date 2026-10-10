"use client";

import { type FormEvent, useEffect, useState } from "react";
import { AlertTriangle, Loader2, PackageX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fieldClassName, FormField } from "@/components/ui/modal";
import { CLIENT_CACHE_INVALIDATED_EVENT, getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { sendJson } from "@/lib/send-json";
import type { StockAlert } from "@/lib/stock-rules";

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

export function StockAlertItem({ alert, onOpen }: { alert: StockAlert; onOpen?: () => void }) {
  const Icon = alert.kind === "below_minimum" ? PackageX : AlertTriangle;
  const tone = alert.kind === "expired" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning";
  return (
    <button type="button" className={`flex w-full items-start gap-2 rounded-md p-3 text-left text-[11px] font-semibold leading-5 ${tone}`} onClick={onOpen}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{alert.message}</span>
    </button>
  );
}

export function StockAlertsCard({ onOpen }: { onOpen: () => void }) {
  const alerts = useStockAlerts(true);
  if (!alerts.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Avisos de estoque</CardTitle>
        <span className="text-xs font-bold text-muted-foreground">{alerts.length}</span>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {alerts.map((alert) => <StockAlertItem alert={alert} key={`${alert.kind}-${alert.lotId ?? alert.productId}`} onOpen={onOpen} />)}
      </CardContent>
    </Card>
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
