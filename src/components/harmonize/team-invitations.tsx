"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Copy, Loader2, MailPlus, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fieldClassName, FormField, Modal } from "@/components/ui/modal";
import { getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { LoadingSkeleton } from "./shared";

type InvitationStatus = "pending" | "accepted" | "expired" | "cancelled";
type InvitationItem = { id: string; email: string; role: string; status: InvitationStatus; expiresAt: string; createdAt: string; lastSentAt: string; sendCount: number; invitedBy: string | null };
type SendResult = { invitation?: InvitationItem; emailSent?: boolean; emailFailureReason?: string; inviteUrl?: string; message?: string };

const listKey = "/api/invitations";
const roleLabels: Record<string, string> = { PROFESSIONAL: "Profissional", STAFF: "Atendente" };
const statusView: Record<InvitationStatus, { label: string; variant: "amber" | "green" | "slate" | "red" }> = {
  pending: { label: "Pendente", variant: "amber" },
  accepted: { label: "Aceito", variant: "green" },
  expired: { label: "Expirado", variant: "slate" },
  cancelled: { label: "Cancelado", variant: "red" },
};
const formatDate = (value: string) => new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
// Mesmo critério do servidor (src/lib/invitation-rules.ts); o servidor continua sendo a fonte da verdade.
const emailPattern = /^[^\s@<>,;"()[\]\\\p{Cc}]+@[^\s@<>,;"()[\]\\\p{Cc}]+\.[^\s@<>,;"()[\]\\\p{Cc}]{2,}$/u;

// Código estável devolvido pelo servidor => mensagem em pt-BR. Código desconhecido cai no texto genérico.
const emailFailureMessages: Record<string, string> = {
  unverified_domain_or_test_recipient: "O envio de e-mail está em modo de teste: o provedor só entrega para o e-mail da conta dele. Verifique um domínio no provedor de e-mail (Resend) e use um remetente desse domínio.",
  invalid_api_key: "A chave do provedor de e-mail é inválida ou não tem permissão de envio.",
  invalid_from: "O remetente configurado (EMAIL_FROM) é inválido.",
  rate_limited: "O provedor de e-mail limitou os envios. Tente de novo em instantes.",
  timeout: "Não foi possível falar com o provedor de e-mail. Tente reenviar.",
  network: "Não foi possível falar com o provedor de e-mail. Tente reenviar.",
};
const emailFallbackMessage = "O convite foi criado, mas o e-mail não pôde ser enviado. Tente reenviar.";

const serverMessages: Record<number, string> = {
  409: "Já existe um convite pendente ou este e-mail já faz parte da equipe.",
  429: "Limite de envios atingido. Tente novamente mais tarde.",
  503: "O envio de e-mails ainda não está configurado.",
};

// Convites da clínica: lista, convidar, reenviar e cancelar. Só é montado para quem tem "settings:team".
export function TeamInvitations() {
  const cached = readClientCache<{ invitations?: InvitationItem[] }>(listKey);
  const [items, setItems] = useState<InvitationItem[]>(cached?.invitations ?? []);
  const [loading, setLoading] = useState(!cached);
  const [loadError, setLoadError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("STAFF");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "warning" | "success"; text: string; url?: string } | null>(null);
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toCancel, setToCancel] = useState<InvitationItem | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getCachedJson<{ invitations?: InvitationItem[] }>(listKey);
      setItems(data.invitations ?? []);
      setLoadError("");
    } catch {
      setLoadError("Não foi possível carregar os convites.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    getCachedJson<{ invitations?: InvitationItem[] }>(listKey)
      .then((data) => { if (active) setItems(data.invitations ?? []); })
      .catch(() => { if (active) setLoadError("Não foi possível carregar os convites."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function describeSend(data: SendResult | null) {
    // inviteUrl só vem fora de produção e sem provedor de e-mail; nunca é guardado fora deste estado de tela.
    if (data?.inviteUrl) setNotice({ tone: "warning", text: "O e-mail não foi enviado (provedor não configurado). Este link só aparece em desenvolvimento.", url: data.inviteUrl });
    else if (data?.emailSent === false) {
      const code = data.emailFailureReason;
      const detail = code && Object.hasOwn(emailFailureMessages, code) ? emailFailureMessages[code] : null;
      setNotice({ tone: "warning", text: detail ? `O convite foi criado, mas o e-mail não foi enviado. ${detail}` : emailFallbackMessage });
    }
    else setNotice({ tone: "success", text: "Convite enviado por e-mail." });
    setCopied(false);
    setActionError(""); // um aviso por vez: o mais recente
  }

  async function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = email.trim().toLowerCase();
    if (!emailPattern.test(value) || value.length > 254) { setFormError("Informe um e-mail válido."); return; }
    setSaving(true);
    setFormError("");
    try {
      const response = await fetch("/api/invitations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: value, role }) });
      const data = await response.json().catch(() => null) as SendResult | null;
      if (!response.ok) { setFormError(data?.message ?? serverMessages[response.status] ?? "Não foi possível criar o convite. Tente novamente."); return; }
      invalidateClientCache(listKey);
      setModalOpen(false);
      setEmail("");
      setRole("STAFF");
      describeSend(data);
      await load();
    } catch {
      setFormError("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  async function resend(item: InvitationItem) {
    setBusyId(item.id);
    setActionError("");
    try {
      const response = await fetch(`/api/invitations/${encodeURIComponent(item.id)}/resend`, { method: "POST" });
      const data = await response.json().catch(() => null) as SendResult | null;
      if (!response.ok) {
        setNotice(null); // um aviso por vez: o mais recente
        setActionError(data?.message ?? serverMessages[response.status] ?? "Não foi possível reenviar o convite.");
        // 404/409: a lista local ficou velha (convite cancelado, aceito ou removido); recarrega.
        if (response.status === 404 || response.status === 409) { invalidateClientCache(listKey); await load(); }
        return;
      }
      invalidateClientCache(listKey);
      describeSend(data);
      await load();
    } catch {
      setActionError("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.");
    } finally {
      setBusyId(null);
    }
  }

  async function cancel() {
    if (!toCancel) return;
    setBusyId(toCancel.id);
    setActionError("");
    try {
      const response = await fetch(`/api/invitations/${encodeURIComponent(toCancel.id)}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { message?: string } | null;
        setActionError(data?.message ?? "Não foi possível cancelar o convite.");
        if (response.status === 404 || response.status === 409) { invalidateClientCache(listKey); await load(); }
        return;
      }
      invalidateClientCache(listKey);
      setToCancel(null);
      setNotice(null);
      await load();
    } catch {
      setActionError("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.");
    } finally {
      setBusyId(null);
    }
  }

  async function copyLink(url: string) {
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); }
  }

  return (
    <>
      <Card className="mt-6 border-border/70">
        <CardHeader className="flex flex-col gap-3 border-b border-border/70 sm:flex-row sm:items-center sm:justify-between">
          <div><CardTitle>Convites</CardTitle><p className="mt-1 text-sm text-muted-foreground">Convide profissionais e atendentes por e-mail. O convite vale por 7 dias.</p></div>
          <Button size="sm" onClick={() => { setFormError(""); setModalOpen(true); }}><MailPlus className="h-4 w-4" />Convidar funcionário</Button>
        </CardHeader>
        <CardContent className="pt-4">
          <div aria-live="polite">
            {notice ? (
              <div className={`mb-4 rounded-md px-3 py-2 text-sm ${notice.tone === "warning" ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`} role={notice.tone === "warning" ? "alert" : "status"}>
                <p>{notice.text}</p>
                {notice.url ? (
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <code className="min-w-0 flex-1 break-all rounded bg-background/60 px-2 py-1 text-xs text-foreground">{notice.url}</code>
                    <Button type="button" variant="secondary" size="sm" onClick={() => void copyLink(notice.url as string)}><Copy className="h-3.5 w-3.5" />{copied ? "Copiado" : "Copiar link"}</Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {actionError && !toCancel ? <p className="mb-4 rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{actionError}</p> : null}
            {loadError ? <p className="mb-4 rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{loadError}</p> : null}
          </div>
          {loading ? (
            <div className="space-y-3 py-2">{[0, 1].map((n) => <LoadingSkeleton className="h-12 w-full" key={n} />)}</div>
          ) : items.length ? (
            <div className="divide-y divide-border/70">
              {items.map((item) => {
                const view = statusView[item.status] ?? statusView.expired;
                const busy = busyId === item.id;
                return (
                  <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" key={item.id}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-foreground">{item.email}</p>
                      <p className="text-xs text-muted-foreground">{roleLabels[item.role] ?? item.role} · enviado em {formatDate(item.lastSentAt)} · expira em {formatDate(item.expiresAt)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={view.variant}>{view.label}</Badge>
                      {item.status === "pending" || item.status === "expired" ? (
                        <Button type="button" variant="secondary" size="sm" className="h-7 px-2.5 text-xs" disabled={busy} onClick={() => void resend(item)}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Reenviar</Button>
                      ) : null}
                      {item.status === "pending" ? (
                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2.5 text-xs text-destructive" disabled={busy} onClick={() => { setActionError(""); setToCancel(item); }}><X className="h-3.5 w-3.5" />Cancelar</Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">Nenhum convite enviado ainda.</p>
          )}
        </CardContent>
      </Card>

      <Modal open={modalOpen} onClose={() => { if (!saving) setModalOpen(false); }} title="Convidar funcionário" description="Enviamos um link por e-mail. A pessoa cria o acesso ou entra com Google.">
        <form className="space-y-4" onSubmit={submitInvite} noValidate>
          <FormField label="E-mail" htmlFor="invite-email" required><input autoComplete="off" className={fieldClassName} id="invite-email" inputMode="email" maxLength={254} onChange={(event) => { setEmail(event.target.value); setFormError(""); }} placeholder="nome@dominio.com" required type="email" value={email} /></FormField>
          <FormField label="Cargo" htmlFor="invite-role" required>
            <select className={fieldClassName} id="invite-role" onChange={(event) => setRole(event.target.value)} value={role}>
              <option value="PROFESSIONAL">Profissional</option>
              <option value="STAFF">Atendente</option>
            </select>
          </FormField>
          <div aria-live="polite">{formError ? <p className="rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{formError}</p> : null}</div>
          <div className="flex justify-end gap-2"><Button disabled={saving} type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button><Button disabled={saving} type="submit">{saving ? "Enviando..." : "Enviar convite"}</Button></div>
        </form>
      </Modal>

      <Modal open={Boolean(toCancel)} onClose={() => { if (!busyId) setToCancel(null); }} title="Cancelar convite" description="O link enviado deixa de funcionar.">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Cancelar o convite para <strong>{toCancel?.email}</strong>?</p>
          {actionError ? <p className="rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{actionError}</p> : null}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={Boolean(busyId)} onClick={() => setToCancel(null)}>Voltar</Button><Button type="button" className="bg-destructive hover:bg-destructive/90" disabled={Boolean(busyId)} onClick={() => void cancel()}>{busyId ? "Cancelando..." : "Cancelar convite"}</Button></div>
        </div>
      </Modal>
    </>
  );
}
