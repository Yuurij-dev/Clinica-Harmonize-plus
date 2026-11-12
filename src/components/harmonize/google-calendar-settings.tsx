"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { CalendarStatus, ConnectionState } from "@/lib/google-calendar-connection-service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSkeleton } from "./shared";
import { Modal } from "@/components/ui/modal";
import { getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { securityRequest } from "@/lib/security-client";
import { GOOGLE_CALENDAR_STATUS_KEY, gcalStatusPresentation, gcalSyncSummary } from "@/lib/google-calendar-ui-rules";

type ConnectionType = "ADMIN" | "PROFESSIONAL";

const API = "/api/integrations/google-calendar";

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Ainda não sincronizou";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
}

export function GoogleCalendarSettings() {
  const [status, setStatus] = useState<CalendarStatus | null>(() => readClientCache<CalendarStatus>(GOOGLE_CALENDAR_STATUS_KEY) ?? null);
  const [loading, setLoading] = useState(status === null);
  const [loadError, setLoadError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  // `${tipo}:${ação}` em andamento; trava todos os botões do card enquanto houver requisição.
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmType, setConfirmType] = useState<ConnectionType | null>(null);
  const [message, setMessage] = useState<{ scope: ConnectionType; text: string; error: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    getCachedJson<CalendarStatus>(GOOGLE_CALENDAR_STATUS_KEY)
      .then((data) => { if (active) { setStatus(data); setLoadError(false); } })
      .catch((error: unknown) => { if (active && !(error instanceof DOMException)) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadTick]);

  const reload = useCallback(() => {
    invalidateClientCache(GOOGLE_CALENDAR_STATUS_KEY);
    setReloadTick((tick) => tick + 1);
  }, []);

  async function connect(type: ConnectionType) {
    setBusy(`${type}:connect`);
    setMessage(null);
    const result = await securityRequest<{ url?: string }>("POST", `${API}/connect`, { type });
    if (!result.ok || typeof result.data?.url !== "string") {
      setBusy(null);
      setMessage({ scope: type, text: result.ok ? "Não foi possível iniciar a conexão com o Google." : result.message, error: true });
      if (result.status === 409 || result.status === 503) reload();
      return;
    }
    // Sai para o consentimento do Google; o botão fica travado até a página trocar.
    window.location.assign(result.data.url);
  }

  async function disconnect(type: ConnectionType) {
    setBusy(`${type}:disconnect`);
    setMessage(null);
    const result = await securityRequest("POST", `${API}/disconnect`, { type });
    setBusy(null);
    if (!result.ok) { setMessage({ scope: type, text: result.message, error: true }); return; }
    setConfirmType(null);
    toast.success("Google Agenda desconectado.");
    reload();
  }

  async function sync(type: ConnectionType) {
    setBusy(`${type}:sync`);
    setMessage(null);
    const result = await securityRequest<{ enqueued?: number; processed?: { completed?: number; retried?: number; failed?: number } | null }>("POST", `${API}/sync`);
    setBusy(null);
    if (!result.ok) { setMessage({ scope: type, text: result.message, error: true }); return; }
    setMessage({ scope: type, text: gcalSyncSummary(result.data), error: false });
    reload();
  }

  if (loading && !status) {
    return <div aria-busy="true" aria-label="Carregando Google Agenda" className="space-y-3 rounded-md border border-border/70 p-4"><LoadingSkeleton className="h-5 w-40" /><LoadingSkeleton className="h-4 w-full" /><LoadingSkeleton className="h-9 w-48" /></div>;
  }
  if (!status) {
    return (
      <div className="space-y-3 rounded-md border border-border/70 p-4">
        <p className="text-sm font-bold text-foreground">Google Agenda</p>
        <p className="text-sm text-destructive" role="alert">{loadError ? "Não foi possível carregar o Google Agenda." : "Google Agenda indisponível."}</p>
        <Button onClick={() => { setLoading(true); reload(); }} size="sm" variant="outline">Tentar novamente</Button>
      </div>
    );
  }
  if (!status.canConnectCentral && !status.canConnectIndividual) return null;

  if (!status.configured) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-bold text-foreground">Google Agenda</p><p className="mt-1 text-xs text-muted-foreground">Integração ainda não configurada neste ambiente.</p></div>
        <Badge variant="amber">Indisponível</Badge>
      </div>
    );
  }

  const anyBusy = busy !== null;
  const block = (type: ConnectionType, state: ConnectionState, title: string, description: string, optional?: string) => (
    <ConnectionBlock
      key={type}
      anyBusy={anyBusy}
      busy={busy}
      description={description}
      message={message?.scope === type ? message : null}
      onConnect={() => void connect(type)}
      onDisconnect={() => setConfirmType(type)}
      onSync={() => void sync(type)}
      optional={optional}
      state={state}
      title={title}
      type={type}
    />
  );

  return (
    <Card className="border-border/70">
      <CardHeader className="border-b border-border/70">
        <div>
          <CardTitle className="flex items-center gap-2"><CalendarCheck className="h-4 w-4" aria-hidden="true" />Google Agenda</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Envie os agendamentos da clínica ao Google Agenda e avise os profissionais por convite.</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {status.canConnectCentral ? block("ADMIN", status.central, "Agenda central da clínica", "Esta conexão recebe todos os agendamentos da clínica e envia convites do Google aos profissionais responsáveis.") : null}
        {status.canConnectIndividual ? block("PROFESSIONAL", status.individual, "Minha agenda Google", "Conectar permite integrar a sua própria agenda sem duplicar eventos.", "Opcional. Mesmo sem conectar, você recebe os convites do Google pela agenda central da clínica.") : null}
      </CardContent>

      <Modal closeOnOverlayClick={busy === null} description="Os eventos já criados permanecem no Google; novos agendamentos deixam de ser sincronizados." mascot={false} onClose={() => { if (busy === null) setConfirmType(null); }} open={confirmType !== null} panelClassName="max-w-md" title="Desconectar Google Agenda">
        <div className="space-y-4">
          {confirmType && message?.scope === confirmType && message.error ? <p className="text-sm text-destructive" role="alert">{message.text}</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button disabled={anyBusy} onClick={() => setConfirmType(null)} variant="outline">Cancelar</Button>
            <Button disabled={anyBusy} onClick={() => confirmType && void disconnect(confirmType)} variant="destructive">{busy?.endsWith(":disconnect") ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}Desconectar</Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

function ConnectionBlock({ type, state, title, description, optional, busy, anyBusy, message, onConnect, onDisconnect, onSync }: {
  type: ConnectionType;
  state: ConnectionState;
  title: string;
  description: string;
  optional?: string;
  busy: string | null;
  anyBusy: boolean;
  message: { text: string; error: boolean } | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onSync: () => void;
}) {
  const presentation = gcalStatusPresentation(state.status);
  const active = state.status === "CONNECTED" || state.status === "ERROR";
  return (
    <section aria-label={title} className="space-y-3 rounded-md border border-border/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        <Badge variant={presentation.variant}>{presentation.label}</Badge>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      {optional ? <p className="text-xs leading-5 text-muted-foreground">{optional}</p> : null}
      {state.status === "ERROR" ? <p className="text-sm font-medium text-warning" role="alert">Reconecte sua conta Google para voltar a sincronizar.</p> : null}
      {type === "ADMIN" && state.connectedByOther && active ? <p className="text-xs text-muted-foreground">A agenda central foi conectada por outro administrador.</p> : null}
      {active ? (
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div className="min-w-0"><dt className="text-xs font-semibold text-muted-foreground">Conta Google</dt><dd className="mt-0.5 break-all font-semibold text-foreground">{state.googleEmail ?? "—"}</dd></div>
          <div><dt className="text-xs font-semibold text-muted-foreground">Última sincronização</dt><dd className="mt-0.5 font-semibold text-foreground">{formatDateTime(state.lastSyncAt)}</dd></div>
          <div><dt className="text-xs font-semibold text-muted-foreground">Eventos sincronizados</dt><dd className="mt-0.5 font-semibold text-foreground">{state.syncedEvents}</dd></div>
        </dl>
      ) : null}
      {active && ((state.pendingJobs ?? 0) > 0 || (state.failedJobs ?? 0) > 0) ? (
        <p className="text-xs text-muted-foreground">{(state.pendingJobs ?? 0) > 0 ? `${state.pendingJobs} na fila` : ""}{(state.pendingJobs ?? 0) > 0 && (state.failedJobs ?? 0) > 0 ? " · " : ""}{(state.failedJobs ?? 0) > 0 ? `${state.failedJobs} com falha` : ""}</p>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {state.status !== "CONNECTED" ? (
          <Button disabled={anyBusy} onClick={onConnect}>{busy === `${type}:connect` ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}{state.status === "ERROR" ? "Reconectar Google" : "Conectar Google"}</Button>
        ) : null}
        {state.status === "CONNECTED" ? (
          <Button disabled={anyBusy} onClick={onSync} variant="outline">{busy === `${type}:sync` ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}{busy === `${type}:sync` ? "Sincronizando..." : "Sincronizar agora"}</Button>
        ) : null}
        {active ? <Button disabled={anyBusy} onClick={onDisconnect} variant="outline">Desconectar</Button> : null}
      </div>
      <p aria-live="polite" className={message?.error ? "text-xs font-medium text-destructive" : "text-xs font-medium text-success"} role={message?.error ? "alert" : "status"}>{message?.text ?? ""}</p>
    </section>
  );
}
