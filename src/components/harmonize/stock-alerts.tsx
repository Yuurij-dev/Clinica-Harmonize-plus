"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fieldClassName, FormField } from "@/components/ui/modal";
import { CLIENT_CACHE_INVALIDATED_EVENT, getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { sendJson } from "@/lib/send-json";
import type { StockAlert, StockKind } from "@/lib/stock-rules";
import { cn } from "@/lib/utils";
import { StockKindBadge } from "./stock-kind";

const alertsKey = "/api/stock/alerts";

// Avisos de estoque para administradores: carregados ao entrar e recarregados quando
// uma movimentação invalida a chave.
export function useStockAlerts(enabled: boolean, onAlertsLoaded?: (alerts: StockAlert[], isInitialLoad: boolean) => void) {
  const [alerts, setAlerts] = useState<StockAlert[]>(() => (enabled ? readClientCache<{ alerts: StockAlert[] }>(alertsKey)?.alerts : undefined) ?? []);
  const [version, setVersion] = useState(0);
  const hasLoadedRef = useRef(false);
  const onAlertsLoadedRef = useRef(onAlertsLoaded);
  onAlertsLoadedRef.current = onAlertsLoaded;

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    getCachedJson<{ alerts: StockAlert[] }>(alertsKey).then((data) => {
      if (!active) return;
      setAlerts(data.alerts);
      onAlertsLoadedRef.current?.(data.alerts, !hasLoadedRef.current);
      hasLoadedRef.current = true;
    }).catch(() => undefined);
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

// Sem onOpen o aviso é só texto (span), para caber dentro de outros botões.
export function StockAlertItem({ alert, onOpen, variant = "boxed" }: { alert: StockAlert; onOpen?: () => void; variant?: "boxed" | "plain" }) {
  const tone = alert.kind === "expired" ? "text-destructive" : "text-warning";
  const boxTone = alert.kind === "expired" ? "bg-destructive/10" : "bg-warning/10";
  const Tag = onOpen ? "button" : "span";
  return (
    <Tag type={onOpen ? "button" : undefined} className={`flex items-start gap-2 text-left text-[11px] font-semibold leading-5 ${tone} ${variant === "boxed" ? `w-full rounded-md p-3 ${boxTone}` : "w-fit"}`} onClick={onOpen}>
      <span aria-hidden="true" className="stock-alert-dot mt-1.5 h-2 w-2 shrink-0 rounded-full" />
      <span>{alert.message}</span>
    </Tag>
  );
}

type StockAlertGroup = { key: string; productKind?: StockKind; alerts: StockAlert[] };

function groupStockAlerts(alerts: StockAlert[]): StockAlertGroup[] {
  const groups = new Map<string, StockAlertGroup>();
  for (const alert of alerts) {
    const key = alert.productKind ?? `other:${alert.kind}`;
    const group = groups.get(key);
    if (group) group.alerts.push(alert);
    else groups.set(key, { key, productKind: alert.productKind, alerts: [alert] });
  }
  return Array.from(groups.values());
}

export function StockAlertGroups({ alerts, onOpen, variant = "boxed" }: { alerts: StockAlert[]; onOpen?: (alert: StockAlert) => void; variant?: "boxed" | "plain" | "list" }) {
  return (
    <>
      {groupStockAlerts(alerts).map((group) => {
        const badge = group.productKind ? <StockKindBadge kind={group.productKind} /> : null;
        const items = group.alerts.map((alert) => <StockAlertItem alert={alert} key={`${alert.kind}-${alert.lotId ?? alert.productId}-${alert.message}`} onOpen={onOpen ? () => onOpen(alert) : undefined} variant={variant === "boxed" ? "boxed" : "plain"} />);
        if (variant === "plain") return <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1" key={group.key}>{badge}{items}</span>;
        if (variant === "list") return <span className="inline-flex flex-col items-start gap-2" key={group.key}>{badge}{items}</span>;
        return <div className="space-y-2" key={group.key}>{badge}{items}</div>;
      })}
    </>
  );
}

// Seção onde o aviso se resolve: pendências em Compras; lotes e saldo no Estoque.
export function stockAlertSection(alert: StockAlert): "estoque" | "compras" {
  return alert.kind === "pending" ? "compras" : "estoque";
}

// Borda amarela na aba que tem aviso, no mesmo tom do card de procedimento em andamento.
export function warningTabClass(hasWarning: boolean, active: boolean) {
  if (!hasWarning) return undefined;
  return active ? "border border-amber-300" : "border-amber-300 bg-amber-50/70 hover:border-amber-400 hover:bg-amber-50";
}

// Indicador de aviso da seção; a lista continua aparecendo ao passar o mouse ou focar.
// No menu lateral ele fica dentro do botão do item, então o trigger é um span.
export function SectionWarning({ section, enabled, inMenu = false }: { section: "estoque" | "compras"; enabled: boolean; inMenu?: boolean }) {
  const alerts = useStockAlerts(enabled).filter((alert) => stockAlertSection(alert) === section);
  if (!alerts.length) return null;
  const label = alerts.length === 1 ? "1 aviso" : `${alerts.length} avisos`;
  const Trigger = inMenu ? "span" : "button";
  return (
    <span className="group/warning relative inline-flex">
      <Trigger type={inMenu ? undefined : "button"} aria-label={label} className={cn("grid place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", inMenu ? "h-6 w-6" : "h-8 w-8 max-lg:h-11 max-lg:w-11")}>
        <span aria-hidden="true" className={cn("stock-alert-dot block rounded-full", inMenu ? "h-1.5 w-1.5" : "h-2 w-2")} />
      </Trigger>
      <span role="tooltip" className={cn("pointer-events-none invisible absolute z-50 w-72 rounded-md border border-border bg-card p-3 text-left opacity-0 shadow-lg transition-opacity duration-150 group-hover/warning:visible group-hover/warning:opacity-100 group-focus-within/warning:visible group-focus-within/warning:opacity-100", inMenu ? "left-full top-1/2 ml-2 -translate-y-1/2" : "left-0 top-full mt-2")}>
        <span className="block text-xs font-semibold text-foreground">{label}</span>
        <span className="mt-2 flex flex-col gap-3"><StockAlertGroups alerts={alerts} variant="list" /></span>
      </span>
    </span>
  );
}

export function StockAlertsCard({ onOpen }: { onOpen: (alert: StockAlert) => void }) {
  const alerts = useStockAlerts(true);
  if (!alerts.length) return null;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center" aria-label={`${alerts.length} ${alerts.length === 1 ? "aviso de estoque" : "avisos de estoque"}`}>
      <span className="text-xs font-bold text-muted-foreground">{alerts.length} {alerts.length === 1 ? "aviso" : "avisos"}</span>
      <StockAlertGroups alerts={alerts} onOpen={onOpen} variant="plain" />
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
