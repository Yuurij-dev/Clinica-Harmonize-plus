"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Check, Copy, Download, Loader2, Printer, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fieldClassName, Modal } from "@/components/ui/modal";
import { AuthShell } from "./login-screen";
import { OtpInput } from "./otp-input";
import { invalidateClientCache } from "@/lib/client-cache";
import { SECURITY_OVERVIEW_KEY, securityRequest } from "@/lib/security-client";
import { emptyOtp, qrSvgDataUrl, recoveryCodesFileText } from "@/lib/security-ui-rules";

type Step = "password" | "scan" | "code" | "codes";
const stepNumber: Record<Step, number> = { password: 1, scan: 2, code: 3, codes: 4 };
const stepTitle: Record<Step, string> = {
  password: "Confirme sua identidade",
  scan: "Escaneie o QR code",
  code: "Digite o código do aplicativo",
  codes: "Guarde seus códigos de recuperação",
};

// Impressão só dos códigos: o resto da página (inclusive o modal em volta) fica invisível.
const printStyles = "@media print { body * { visibility: hidden !important; } #mfa-recovery-print, #mfa-recovery-print * { visibility: visible !important; } #mfa-recovery-print { position: fixed; left: 0; top: 0; width: 100%; padding: 32px; background: #fff; color: #000; } }";

type WizardProps = {
  /** Chamado quando o usuário confirma que guardou os códigos (fim do assistente). */
  onDone: () => void;
  /** Modal: fechar sem concluir. Ausente no modo obrigatório. */
  onCancel?: () => void;
  /** Informa se fechar agora perderia os códigos (passo 4): o container deve bloquear o fechamento. */
  onLockChange?: (locked: boolean) => void;
  /** Ativação obrigatória logo após o login: pula a senha (a sessão acabou de ser autenticada) e abre direto no QR. */
  autoStart?: boolean;
};

// Assistente de ativação do 2FA: senha, QR + chave, código de 6 dígitos e códigos de recuperação (mostrados uma única vez).
export function MfaSetupWizard({ onDone, onCancel, onLockChange, autoStart = false }: WizardProps) {
  const [step, setStep] = useState<Step>("password");
  const [password, setPassword] = useState("");
  const [qr, setQr] = useState<{ dataUrl: string | null; manualKey: string } | null>(null);
  const [cells, setCells] = useState(emptyOtp);
  const [focusSignal, setFocusSignal] = useState(0);
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [reauth, setReauth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const feedbackId = useId();
  const passwordId = useId();
  const autoStarted = useRef(false);
  const [starting, setStarting] = useState(autoStart);

  useEffect(() => { onLockChange?.(step === "codes"); }, [step, onLockChange]);
  useEffect(() => () => onLockChange?.(false), [onLockChange]);

  async function start(usePassword: boolean) {
    setBusy(true);
    setError("");
    setReauth(false);
    const result = await securityRequest<{ qrSvg?: string; manualKey?: string }>("POST", "/api/security/mfa/setup/start", usePassword ? { password } : {});
    setBusy(false);
    if (!result.ok || !result.data?.manualKey) {
      if (result.code === "reauth_required") setReauth(true);
      setError(result.message || "Não foi possível iniciar a configuração.");
      return;
    }
    setPassword("");
    setQr({ dataUrl: qrSvgDataUrl(result.data.qrSvg), manualKey: result.data.manualKey });
    setStep("scan");
  }

  // Sem senha: o servidor aceita porque a sessão é recente e o usuário está preso na ativação obrigatória.
  // Se recusar (sessão antiga), cai no passo da senha normalmente.
  useEffect(() => {
    if (!autoStart || autoStarted.current) return;
    autoStarted.current = true;
    void start(false).finally(() => setStarting(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  async function confirm(event: FormEvent) {
    event.preventDefault();
    const code = cells.join("");
    if (code.length !== cells.length || busy) return;
    setBusy(true);
    setError("");
    const result = await securityRequest<{ recoveryCodes?: string[] }>("POST", "/api/security/mfa/setup/confirm", { code });
    setBusy(false);
    if (!result.ok || !result.data?.recoveryCodes) {
      if (result.code === "setup_not_started") { setStep("password"); setQr(null); }
      setError(result.message || "Código inválido ou expirado.");
      setCells(emptyOtp());
      setFocusSignal((tick) => tick + 1);
      return;
    }
    // O servidor já ativou: o estado de segurança em cache ficou velho.
    invalidateClientCache(SECURITY_OVERVIEW_KEY, "/api/security/events");
    setCodes(result.data.recoveryCodes);
    setStep("codes");
  }

  async function copyKey(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Não foi possível copiar automaticamente. Selecione o texto e copie manualmente.");
    }
  }

  const number = stepNumber[step];
  return (
    <div className="space-y-5">
      <div>
        <div aria-hidden="true" className="flex gap-1.5">{[1, 2, 3, 4].map((item) => <span className={`h-1 flex-1 rounded-full ${item <= number ? "bg-primary" : "bg-muted"}`} key={item} />)}</div>
        <p className="mt-2 text-xs font-semibold text-muted-foreground">Passo {number} de 4</p>
        <h3 className="mt-1 text-base font-bold text-foreground">{stepTitle[step]}</h3>
      </div>

      {step === "password" && starting ? (
        <p aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />Preparando a verificação em duas etapas…</p>
      ) : null}

      {step === "password" && !starting ? (
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (password && !busy) void start(true); }}>
          <p className="text-sm leading-6 text-muted-foreground">Por segurança, informe sua senha atual para começar a configurar a verificação em duas etapas.</p>
          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground" htmlFor={passwordId}>Senha atual</label>
            <input aria-describedby={feedbackId} autoComplete="current-password" autoFocus className={fieldClassName} disabled={busy} id={passwordId} onChange={(event) => { setPassword(event.target.value); setError(""); }} type="password" value={password} />
          </div>
          <Feedback id={feedbackId} message={error} />
          {reauth ? <p className="text-xs leading-5 text-muted-foreground">Saia e entre novamente com o Google para continuar; a confirmação vale por poucos minutos após o login.</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {onCancel ? <Button disabled={busy} onClick={onCancel} type="button" variant="outline">Cancelar</Button> : null}
            <Button disabled={busy || !password} type="submit">{busy ? <Loader2 className="animate-spin" /> : null}Continuar</Button>
          </div>
          <button className="min-h-11 w-full text-center text-xs font-medium text-primary hover:underline disabled:opacity-50" disabled={busy} onClick={() => void start(false)} type="button">Entrei com o Google e não tenho senha</button>
        </form>
      ) : null}

      {step === "scan" && qr ? (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-muted-foreground">Abra seu aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy ou similar) e escaneie o QR code.</p>
          {qr.dataUrl ? (
            <div className="mx-auto w-fit rounded-lg border border-border bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- data URL local gerada pelo servidor; next/image não se aplica */}
              <img alt="QR code para configurar o aplicativo autenticador" className="h-48 w-48" height={192} src={qr.dataUrl} width={192} />
            </div>
          ) : null}
          <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
            <p className="text-xs font-semibold text-foreground">{qr.dataUrl ? "Ou digite a chave manualmente" : "Digite a chave no aplicativo"}</p>
            <div className="mt-2 flex items-center gap-2">
              <code aria-label="Chave de configuração" className="min-w-0 flex-1 break-all rounded-md bg-background px-2.5 py-2 text-sm font-bold tracking-wider text-foreground">{qr.manualKey}</code>
              <Button aria-label="Copiar chave" onClick={() => void copyKey(qr.manualKey.replace(/\s/g, ""))} size="icon" type="button" variant="outline">{copied ? <Check /> : <Copy />}</Button>
            </div>
            <p aria-live="polite" className="mt-1 h-4 text-[11px] text-muted-foreground">{copied ? "Chave copiada." : ""}</p>
          </div>
          <Feedback id={feedbackId} message={error} />
          <div className="flex justify-end"><Button onClick={() => { setError(""); setStep("code"); }} type="button">Já escaneei, continuar</Button></div>
        </div>
      ) : null}

      {step === "code" ? (
        <form className="space-y-4" onSubmit={confirm}>
          <p className="text-sm leading-6 text-muted-foreground">Digite o código de 6 dígitos que aparece agora no aplicativo autenticador.</p>
          <OtpInput autoFocus describedBy={feedbackId} disabled={busy} focusSignal={focusSignal} invalid={Boolean(error)} onChange={(next) => { setCells(next); setError(""); }} value={cells} />
          <Feedback id={feedbackId} message={error} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button disabled={busy} onClick={() => { setError(""); setStep("scan"); }} type="button" variant="outline">Voltar ao QR code</Button>
            <Button disabled={busy || cells.join("").length !== cells.length} type="submit">{busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}{busy ? "Verificando..." : "Ativar verificação"}</Button>
          </div>
        </form>
      ) : null}

      {step === "codes" ? (
        <RecoveryCodesPanel codes={codes} intro="A verificação em duas etapas está ativa. Se perder o acesso ao aplicativo, estes códigos permitem entrar." onDone={() => { setCodes([]); onDone(); }} />
      ) : null}
    </div>
  );
}

// Códigos de recuperação mostrados uma única vez: copiar, baixar .txt, imprimir e confirmar que foram guardados.
export function RecoveryCodesPanel({ codes, intro, onDone }: { codes: string[]; intro: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const feedbackId = useId();

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Não foi possível copiar automaticamente. Selecione os códigos e copie manualmente.");
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([recoveryCodesFileText(codes)], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "harmonize-codigos-de-recuperacao.txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted-foreground">{intro} <strong className="font-bold text-foreground">Eles aparecem apenas agora</strong> e cada um vale uma única vez.</p>
      <style>{printStyles}</style>
      <div className="rounded-lg border border-border/70 bg-muted/30 p-3" id="mfa-recovery-print">
        <p className="mb-2 hidden text-sm font-bold print:block">Harmonize+ - códigos de recuperação</p>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">{codes.map((code) => <li className="font-mono text-sm font-bold tracking-wide text-foreground" key={code}>{code}</li>)}</ul>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void copyCodes()} size="sm" type="button" variant="outline">{copied ? <Check /> : <Copy />}{copied ? "Copiados" : "Copiar"}</Button>
        <Button onClick={download} size="sm" type="button" variant="outline"><Download />Baixar .txt</Button>
        <Button onClick={() => window.print()} size="sm" type="button" variant="outline"><Printer />Imprimir</Button>
      </div>
      <Feedback id={feedbackId} message={error} />
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 p-3">
        <input checked={saved} className="mt-0.5 h-4 w-4 shrink-0 accent-[#4938f4]" onChange={(event) => setSaved(event.target.checked)} type="checkbox" />
        <span className="text-sm font-semibold text-foreground">Guardei meus códigos de recuperação em um local seguro</span>
      </label>
      <div className="flex justify-end"><Button disabled={!saved} onClick={onDone} type="button">Concluir</Button></div>
    </div>
  );
}

export function Feedback({ id, message }: { id: string; message: string }) {
  return <div aria-live="polite" id={id} role="status">{message ? <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-semibold text-destructive" role="alert">{message}</p> : null}</div>;
}

// Ativação a partir de Configurações > Segurança. Com os códigos na tela, fechar por Esc/overlay/X fica bloqueado.
export function MfaSetupModal({ open, onClose, onActivated }: { open: boolean; onClose: () => void; onActivated: () => void }) {
  const [locked, setLocked] = useState(false);
  return (
    <Modal closeOnOverlayClick={false} description="Proteja sua conta com um código gerado pelo aplicativo autenticador." onClose={() => { if (!locked) onClose(); }} open={open} panelClassName="max-w-md" title="Ativar verificação em duas etapas">
      <MfaSetupWizard onCancel={onClose} onDone={() => { onActivated(); onClose(); }} onLockChange={setLocked} />
    </Modal>
  );
}

// Tela cheia do assistente obrigatório (proprietário e administradores): nada do app abre antes da ativação.
export function MfaRequiredGate({ onDone, onLogout }: { onDone: () => void; onLogout: () => void }) {
  // Continua na própria tela de login (painel de marca + cartão), no lugar do formulário.
  return (
    <AuthShell action={<Button className="mt-8 h-11 rounded-full bg-white px-6 text-sm font-semibold text-[#4938f4] shadow-none hover:bg-white/90" onClick={onLogout} type="button">Sair</Button>}>
      <div aria-hidden="true" className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-[#eeecff] text-[#4938f4]"><ShieldCheck className="h-6 w-6" /></div>
      <h2 className="text-xl font-black tracking-tight text-[#17134d]">Ative a verificação em duas etapas</h2>
      <p className="mt-1 text-sm leading-6 text-[#6b7491]">Para o seu perfil de acesso, a verificação em duas etapas é obrigatória. Configure agora para entrar na clínica.</p>
      <div className="mt-5 border-t border-[#e9edf5] pt-5"><MfaSetupWizard autoStart onDone={onDone} /></div>
    </AuthShell>
  );
}
