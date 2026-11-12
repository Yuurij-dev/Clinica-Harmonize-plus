"use client";

import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { KeyRound, Laptop, Loader2, LogOut, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fieldClassName, Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { Feedback, MfaSetupModal, RecoveryCodesPanel } from "./mfa-setup-wizard";
import { OtpInput } from "./otp-input";
import { getCachedJson, invalidateClientCache, readClientCache, setClientCacheScope } from "@/lib/client-cache";
import {
  SECURITY_OVERVIEW_KEY,
  securityEventsKey,
  securityRequest,
  type SecurityEventRow,
  type SecurityEventsPage,
  type SecurityOverview,
} from "@/lib/security-client";
import { emptyOtp, formatRecoveryInput, isLowOnRecoveryCodes, isRecoveryInputComplete, securityEventLabel } from "@/lib/security-ui-rules";

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

// Depois de qualquer mudança de segurança o estado em cache (e o histórico) deixam de valer.
function invalidateSecurityCache() {
  invalidateClientCache(SECURITY_OVERVIEW_KEY, "/api/security/events");
}

type ConfirmState = { title: string; description: string; confirmLabel: string; run: () => Promise<{ error?: string }> } | null;

export function SecuritySettings() {
  const [overview, setOverview] = useState<SecurityOverview | null>(() => readClientCache<SecurityOverview>(SECURITY_OVERVIEW_KEY) ?? null);
  const [loading, setLoading] = useState(overview === null);
  const [loadError, setLoadError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const [setupOpen, setSetupOpen] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>(null);

  useEffect(() => {
    let active = true;
    getCachedJson<SecurityOverview>(SECURITY_OVERVIEW_KEY)
      .then((data) => { if (active) { setOverview(data); setLoadError(""); } })
      .catch((error: unknown) => { if (active && !(error instanceof DOMException)) setLoadError("Não foi possível carregar as informações de segurança."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadTick]);

  const refresh = useCallback(() => {
    invalidateSecurityCache();
    setReloadTick((tick) => tick + 1);
  }, []);

  if (loading && !overview) return <SecuritySkeleton />;
  if (!overview) {
    return (
      <Card className="border-border/70"><CardContent className="space-y-3 py-6">
        <p className="text-sm text-destructive" role="alert">{loadError || "Não foi possível carregar as informações de segurança."}</p>
        <Button onClick={() => { setLoading(true); refresh(); }} size="sm" variant="outline">Tentar novamente</Button>
      </CardContent></Card>
    );
  }

  const { mfa } = overview;
  const others = overview.sessions.filter((session) => !session.current);

  return (
    <div className="space-y-4">
      <Card className="border-border/70">
        <CardHeader className="border-b border-border/70">
          <div>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Verificação em duas etapas</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Exige um código do aplicativo autenticador, além da senha, ao entrar em um dispositivo novo.</p>
          </div>
          {mfa.enabled ? <Badge variant="green">Ativada</Badge> : mfa.setupPending ? <Badge variant="amber">Configuração pendente</Badge> : <Badge variant="slate">Desativada</Badge>}
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-xs font-semibold text-muted-foreground">Método</dt><dd className="mt-0.5 font-semibold text-foreground">Aplicativo autenticador (TOTP)</dd></div>
            <div><dt className="text-xs font-semibold text-muted-foreground">Ativada em</dt><dd className="mt-0.5 font-semibold text-foreground">{mfa.enabled ? formatDateTime(mfa.enabledAt) : "—"}</dd></div>
            <div><dt className="text-xs font-semibold text-muted-foreground">Códigos de recuperação restantes</dt><dd className="mt-0.5 flex items-center gap-2 font-semibold text-foreground">{mfa.enabled ? mfa.recoveryCodesRemaining : "—"}{mfa.enabled && isLowOnRecoveryCodes(mfa.recoveryCodesRemaining) ? <Badge variant="amber">Poucos códigos</Badge> : null}</dd></div>
          </dl>
          <div className="flex flex-wrap gap-2">
            {!mfa.enabled ? <Button onClick={() => setSetupOpen(true)}><ShieldCheck />{mfa.setupPending ? "Configurar" : "Ativar"}</Button> : (
              <>
                <Button onClick={() => setRegenerateOpen(true)} variant="outline"><KeyRound />Gerar novos códigos</Button>
                <Button disabled={mfa.required} onClick={() => setDisableOpen(true)} variant="outline"><ShieldOff />Desativar</Button>
              </>
            )}
          </div>
          {mfa.required ? <p className="text-xs leading-5 text-muted-foreground">A verificação em duas etapas é obrigatória para proprietários e administradores da clínica e não pode ser desativada.</p> : null}
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader className="border-b border-border/70">
          <div>
            <CardTitle>Dispositivos confiáveis</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Nestes dispositivos o código de verificação não é pedido por 30 dias.</p>
          </div>
          {overview.trustedDevices.length > 1 ? <Button onClick={() => setConfirm({ title: "Remover todos os dispositivos confiáveis", description: "O código de verificação voltará a ser solicitado em todos os dispositivos no próximo login.", confirmLabel: "Remover todos", run: async () => runDelete("/api/security/trusted-devices", "Dispositivos confiáveis removidos.", refresh) })} size="sm" variant="outline">Remover todos</Button> : null}
        </CardHeader>
        <CardContent className="pt-2">
          {overview.trustedDevices.length === 0 ? <p className="py-4 text-sm text-muted-foreground">Nenhum dispositivo confiável.</p> : (
            <ul className="divide-y divide-border/70">
              {overview.trustedDevices.map((device) => (
                <ListRow
                  action={<Button aria-label={`Remover dispositivo ${device.label}`} onClick={() => setConfirm({ title: "Remover dispositivo confiável", description: `O código de verificação voltará a ser solicitado em ${device.label}.`, confirmLabel: "Remover", run: async () => runDelete(`/api/security/trusted-devices/${encodeURIComponent(device.id)}`, "Dispositivo removido.", refresh) })} size="sm" variant="outline"><Trash2 />Remover</Button>}
                  badge={device.current ? <Badge variant="blue">Este dispositivo</Badge> : null}
                  key={device.id}
                  lines={[`Último acesso: ${formatDateTime(device.lastUsedAt)}`, `Expira em: ${formatDateTime(device.expiresAt)}`]}
                  title={device.label}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader className="border-b border-border/70">
          <div>
            <CardTitle>Sessões ativas</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Dispositivos e navegadores com acesso à sua conta agora.</p>
          </div>
          {others.length > 0 ? <Button onClick={() => setConfirm({ title: "Encerrar as outras sessões", description: "Todos os outros dispositivos serão desconectados. Esta sessão continua ativa.", confirmLabel: "Encerrar outras sessões", run: async () => runDelete("/api/security/sessions", "Outras sessões encerradas.", refresh) })} size="sm" variant="outline"><LogOut />Encerrar todas as outras</Button> : null}
        </CardHeader>
        <CardContent className="pt-2">
          {overview.sessions.length === 0 ? <p className="py-4 text-sm text-muted-foreground">Nenhuma sessão ativa.</p> : (
            <ul className="divide-y divide-border/70">
              {overview.sessions.map((session) => (
                <ListRow
                  action={session.current ? null : <Button aria-label={`Encerrar sessão em ${session.label}`} onClick={() => setConfirm({ title: "Encerrar sessão", description: `${session.label} será desconectado.`, confirmLabel: "Encerrar", run: async () => runDelete(`/api/security/sessions/${encodeURIComponent(session.id)}`, "Sessão encerrada.", refresh) })} size="sm" variant="outline"><LogOut />Encerrar</Button>}
                  badge={session.current ? <Badge variant="green">Sessão atual</Badge> : null}
                  key={session.id}
                  lines={[`Último acesso: ${formatDateTime(session.lastSeenAt)}`, `Criada em: ${formatDateTime(session.createdAt)}`, `IP: ${session.ipMasked}`]}
                  title={session.label}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <SecurityHistory reloadTick={reloadTick} />

      <MfaSetupModal onActivated={refresh} onClose={() => setSetupOpen(false)} open={setupOpen} />
      <ReauthModal
        description="Informe sua senha e um código atual do aplicativo autenticador. Os códigos antigos deixarão de valer."
        onClose={() => setRegenerateOpen(false)}
        onSuccess={refresh}
        open={regenerateOpen}
        submitLabel="Gerar novos códigos"
        title="Gerar novos códigos de recuperação"
        url="/api/security/mfa/recovery/regenerate"
      />
      <ReauthModal
        allowRecovery
        description="Informe sua senha e um código do aplicativo autenticador (ou um código de recuperação). As outras sessões serão encerradas."
        destructive
        onClose={() => setDisableOpen(false)}
        onSuccess={refresh}
        open={disableOpen}
        submitLabel="Desativar verificação"
        title="Desativar verificação em duas etapas"
        url="/api/security/mfa/disable"
      />
      <ConfirmModal confirm={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

// DELETE em /api/security/*; sucesso invalida o cache e recarrega. Sessão encerrada era a atual: volta ao login.
async function runDelete(url: string, successMessage: string, refresh: () => void): Promise<{ error?: string }> {
  const result = await securityRequest<{ loggedOut?: boolean }>("DELETE", url);
  if (!result.ok) {
    // 404: já foi removido (outra aba/dispositivo); só atualiza a lista.
    if (result.status === 404) refresh();
    return { error: result.message };
  }
  if (result.data?.loggedOut) {
    setClientCacheScope(null);
    window.localStorage.setItem("harmonize-session-change", String(Date.now()));
    // Rota de página fora do app (a sessão acabou): navegação completa limpa o estado em memória.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
    return {};
  }
  toast.success(successMessage);
  refresh();
  return {};
}

function ListRow({ title, badge, lines, action }: { title: string; badge: ReactNode; lines: string[]; action: ReactNode }) {
  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <Laptop aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-foreground"><span className="break-words">{title}</span>{badge}</p>
          <p className="mt-1 space-x-3 text-xs leading-5 text-muted-foreground">{lines.map((line) => <span className="inline-block" key={line}>{line}</span>)}</p>
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </li>
  );
}

function SecuritySkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando segurança" className="space-y-4">
      {[0, 1, 2].map((item) => <Card className="border-border/70" key={item}><CardContent className="space-y-3 py-5"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-72 max-w-full" /><Skeleton className="h-10 w-full" /></CardContent></Card>)}
    </div>
  );
}

// Confirmação genérica (remover dispositivo, encerrar sessão). Botões travados durante a requisição.
function ConfirmModal({ confirm, onClose }: { confirm: ConfirmState; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const feedbackId = useId();

  async function run() {
    if (!confirm) return;
    setBusy(true);
    setError("");
    const result = await confirm.run();
    setBusy(false);
    if (result.error) { setError(result.error); return; }
    onClose();
  }

  return (
    <Modal closeOnOverlayClick={!busy} description={confirm?.description} mascot={false} onClose={() => { if (!busy) { setError(""); onClose(); } }} open={Boolean(confirm)} panelClassName="max-w-md" title={confirm?.title ?? "Confirmar"}>
      <div className="space-y-4">
        <Feedback id={feedbackId} message={error} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button disabled={busy} onClick={() => { setError(""); onClose(); }} variant="outline">Cancelar</Button>
          <Button disabled={busy} onClick={() => void run()} variant="destructive">{busy ? <Loader2 className="animate-spin" /> : null}{confirm?.confirmLabel ?? "Confirmar"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// Operações que pedem senha + código: gerar novos códigos de recuperação e desativar o 2FA.
function ReauthModal({ open, onClose, onSuccess, title, description, submitLabel, url, destructive = false, allowRecovery = false }: { open: boolean; onClose: () => void; onSuccess: () => void; title: string; description: string; submitLabel: string; url: string; destructive?: boolean; allowRecovery?: boolean }) {
  const [password, setPassword] = useState("");
  const [cells, setCells] = useState(emptyOtp);
  const [useRecovery, setUseRecovery] = useState(false);
  const [recovery, setRecovery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [focusSignal, setFocusSignal] = useState(0);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const feedbackId = useId();
  const passwordId = useId();

  function reset() {
    setPassword("");
    setCells(emptyOtp());
    setUseRecovery(false);
    setRecovery("");
    setError("");
    setNewCodes(null);
  }

  const code = cells.join("");
  const ready = useRecovery ? isRecoveryInputComplete(recovery) : code.length === cells.length;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    const result = await securityRequest<{ recoveryCodes?: string[] }>("POST", url, {
      ...(password ? { password } : {}),
      ...(useRecovery ? { recoveryCode: recovery } : { code }),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      setCells(emptyOtp());
      setRecovery("");
      setFocusSignal((tick) => tick + 1);
      return;
    }
    invalidateSecurityCache();
    if (result.data?.recoveryCodes) {
      setNewCodes(result.data.recoveryCodes); // mostrados uma única vez; o fechamento fica por conta do painel
      return;
    }
    toast.success("Verificação em duas etapas desativada.");
    onSuccess();
    reset();
    onClose();
  }

  const locked = newCodes !== null;
  function close() {
    if (busy || locked) return;
    reset();
    onClose();
  }

  return (
    <Modal closeOnOverlayClick={false} description={description} mascot={false} onClose={close} open={open} panelClassName="max-w-md" title={title}>
      {newCodes ? (
        <RecoveryCodesPanel codes={newCodes} intro="Os códigos antigos deixaram de valer." onDone={() => { onSuccess(); reset(); onClose(); }} />
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground" htmlFor={passwordId}>Senha atual</label>
            <input aria-describedby={`${passwordId}-help`} autoComplete="current-password" className={fieldClassName} disabled={busy} id={passwordId} onChange={(event) => { setPassword(event.target.value); setError(""); }} type="password" value={password} />
            <p className="text-xs text-muted-foreground" id={`${passwordId}-help`}>Se você entra apenas com o Google e não tem senha, deixe em branco (é preciso ter entrado há menos de 10 minutos).</p>
          </div>
          <div className="space-y-2">
            <span className="block text-xs font-medium text-foreground">{useRecovery ? "Código de recuperação" : "Código do aplicativo autenticador"}</span>
            {useRecovery ? (
              <input aria-describedby={feedbackId} autoCapitalize="none" autoComplete="off" autoCorrect="off" className={fieldClassName} disabled={busy} maxLength={11} onChange={(event) => { setRecovery(formatRecoveryInput(event.target.value)); setError(""); }} placeholder="xxxxx-xxxxx" spellCheck={false} type="text" value={recovery} />
            ) : (
              <OtpInput describedBy={feedbackId} disabled={busy} focusSignal={focusSignal} invalid={Boolean(error)} onChange={(next) => { setCells(next); setError(""); }} value={cells} />
            )}
            {allowRecovery ? <button className="min-h-11 text-xs font-medium text-primary hover:underline disabled:opacity-50" disabled={busy} onClick={() => { setUseRecovery((current) => !current); setError(""); setCells(emptyOtp()); setRecovery(""); }} type="button">{useRecovery ? "Usar código do aplicativo" : "Usar código de recuperação"}</button> : null}
          </div>
          <Feedback id={feedbackId} message={error} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button disabled={busy} onClick={close} type="button" variant="outline">Cancelar</Button>
            <Button disabled={busy || !ready} type="submit" variant={destructive ? "destructive" : "primary"}>{busy ? <Loader2 className="animate-spin" /> : null}{submitLabel}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// Histórico do próprio usuário, mais recentes primeiro; "Ver mais" segue o cursor do servidor.
function SecurityHistory({ reloadTick }: { reloadTick: number }) {
  const [events, setEvents] = useState<SecurityEventRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getCachedJson<SecurityEventsPage>(securityEventsKey())
      .then((page) => { if (active) { setEvents(page.events); setNextCursor(page.nextCursor); setError(""); } })
      .catch((failure: unknown) => { if (active && !(failure instanceof DOMException)) setError("Não foi possível carregar o histórico de segurança."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadTick]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const page = await getCachedJson<SecurityEventsPage>(securityEventsKey(nextCursor));
      setEvents((current) => [...current, ...page.events.filter((event) => !current.some((known) => known.id === event.id))]);
      setNextCursor(page.nextCursor);
    } catch {
      setError("Não foi possível carregar mais eventos.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <Card className="border-border/70">
      <CardHeader className="border-b border-border/70">
        <div>
          <CardTitle>Histórico de segurança</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Acessos e alterações de segurança da sua conta. O IP é exibido parcialmente.</p>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        {loading ? <div aria-busy="true" className="space-y-3 py-3">{[0, 1, 2, 3].map((item) => <Skeleton className="h-10 w-full" key={item} />)}</div> : events.length === 0 && !error ? <p className="py-4 text-sm text-muted-foreground">Nenhum evento registrado ainda.</p> : (
          <ul className="divide-y divide-border/70">
            {events.map((event) => (
              <li className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4" key={event.id}>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-foreground">{securityEventLabel(event.type)}<Badge variant={event.success ? "green" : "red"}>{event.success ? "Sucesso" : "Falha"}</Badge></p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{[event.device, `IP ${event.ipMasked}`, event.detail].filter(Boolean).join(" · ")}</p>
                </div>
                <time className="shrink-0 text-xs text-muted-foreground" dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
              </li>
            ))}
          </ul>
        )}
        {error ? <p className="py-2 text-sm text-destructive" role="alert">{error}</p> : null}
        {!loading && nextCursor ? <div className="flex justify-center pt-3"><Button disabled={loadingMore} onClick={() => void loadMore()} size="sm" variant="outline">{loadingMore ? <Loader2 className="animate-spin" /> : null}Ver mais</Button></div> : null}
      </CardContent>
    </Card>
  );
}
