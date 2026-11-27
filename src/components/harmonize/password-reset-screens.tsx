"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CircleAlert, CircleCheck, KeyRound, Mail, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { normalizeResetEmailInput, readResetTokenFromHash } from "@/lib/password-reset-client";
import { authActionClass, AuthShell, ErrorMessage, PasswordField, PasswordStrength, SignupHeader, TextField } from "./login-screen";

const primaryButton = "h-[42px] w-full rounded-[10px] bg-[#4938f4] px-4 text-[13px] font-bold hover:bg-[#3d2de0]";
const textLink = "inline-flex min-h-11 w-full items-center justify-center gap-1.5 text-xs font-bold text-[#5147dc] hover:underline focus-visible:outline-2 focus-visible:outline-[#5147dc]";
const connectionError = "Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.";

type ApiReply = { ok: boolean; data: { message?: string; code?: string; valid?: boolean } | null };

// null = falha de rede.
async function post(path: "request" | "validate" | "confirm", body: Record<string, string>): Promise<ApiReply | null> {
  try {
    const response = await fetch(`/api/auth/password-reset/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    return { ok: response.ok, data: await response.json().catch(() => null) as ApiReply["data"] };
  } catch {
    return null;
  }
}

// Mesma casca do login, sempre no tema claro.
function ResetShell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.remove("dark");
  }, []);
  return (
    <AuthShell action={
      <Button asChild className={authActionClass} variant="secondary">
        <Link href="/login">Voltar ao login<ArrowRight className="h-4 w-4" /></Link>
      </Button>
    }>
      <div className="mx-auto w-full max-w-[360px]">{children}</div>
    </AuthShell>
  );
}

function BackToLogin() {
  return <Link className={`mt-3 ${textLink}`} href="/login"><ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />Voltar ao login</Link>;
}

export function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Autofill pode preencher sem disparar o onChange.
    const value = normalizeResetEmailInput(event.currentTarget.querySelector("input")?.value ?? email);
    if (!value) { setError("Digite um e-mail válido."); return; }
    setIsSubmitting(true);
    setError("");
    const reply = await post("request", { email: value });
    setIsSubmitting(false);
    if (!reply) { setError(connectionError); return; }
    if (!reply.ok) { setError(reply.data?.message ?? "Não foi possível processar o pedido agora. Tente novamente."); return; }
    setEmail(value);
    setSent(true);
  }

  if (sent) {
    return (
      <ResetShell>
        <div role="status">
          <SignupHeader icon={MailCheck} subtitle={<>Se houver uma conta para <strong className="break-all font-bold text-[#26305a]">{email}</strong>, você receberá um e-mail com as instruções. O link vale por 30 minutos.</>} title="Solicitação enviada" />
        </div>
        <ul className="space-y-2 rounded-[10px] border border-[#e6e8f1] bg-[#f8faff] px-4 py-3 text-xs leading-5 text-[#5c678c]">
          <li>Confira também a caixa de spam.</li>
          <li>Se sua conta usa o Google, entre com “Entrar com Google” na tela de login.</li>
          <li>Não chegou? Aguarde 1 minuto antes de pedir de novo.</li>
        </ul>
        <Button asChild className={`mt-5 ${primaryButton}`} size="lg"><Link href="/login">Voltar ao login</Link></Button>
        <button className={`mt-3 ${textLink}`} onClick={() => setSent(false)} type="button">Pedir novamente ou usar outro e-mail</button>
      </ResetShell>
    );
  }

  return (
    <ResetShell>
      <SignupHeader icon={KeyRound} subtitle="Informe o e-mail da sua conta para receber o link de redefinição." title="Recuperar senha" />
      <form data-autofill="allow" noValidate onSubmit={handleSubmit}>
        <TextField autoComplete="email" compact icon={Mail} invalid={Boolean(error) && !normalizeResetEmailInput(email)} label="seu e-mail" maxLength={254} onChange={(value) => { setEmail(value); setError(""); }} placeholder="nome@dominio.com" type="email" value={email} />
        {error ? <div className="mt-4" role="alert"><ErrorMessage>{error}</ErrorMessage></div> : null}
        <Button className={`mt-5 ${primaryButton}`} disabled={isSubmitting} size="lg" type="submit"><ArrowRight className="h-4 w-4" />{isSubmitting ? "Enviando..." : "Enviar link"}</Button>
      </form>
      <BackToLogin />
    </ResetShell>
  );
}

type ResetStep = "checking" | "form" | "invalid" | "unavailable" | "done";

export function ResetPasswordScreen() {
  // Em ref: sobrevive ao efeito duplo do StrictMode depois que o fragmento sai do endereço.
  const tokenRef = useRef("");
  const [step, setStep] = useState<ResetStep>("checking");
  const [attempt, setAttempt] = useState(0);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const strengthId = useId();

  // Outro link colado na mesma aba só muda o fragmento: confere de novo.
  useEffect(() => {
    const recheck = () => { if (readResetTokenFromHash(window.location.hash)) { setStep("checking"); setError(""); setPassword(""); setConfirmation(""); setShowPassword(false); setAttempt((n) => n + 1); } };
    window.addEventListener("hashchange", recheck);
    return () => window.removeEventListener("hashchange", recheck);
  }, []);

  useEffect(() => {
    const fromHash = readResetTokenFromHash(window.location.hash);
    if (fromHash) {
      tokenRef.current = fromHash;
      // Tira o token do endereço e do histórico. Adiado um tick: o roteador do Next só passa a acompanhar replaceState depois de montado.
      window.setTimeout(() => window.history.replaceState(null, "", window.location.pathname), 0);
    }
    let active = true;
    void (async () => {
      const reply = tokenRef.current ? await post("validate", { token: tokenRef.current }) : { ok: true, data: { valid: false } };
      if (!active) return;
      if (reply?.ok) { setStep(reply.data?.valid ? "form" : "invalid"); return; }
      setError(reply ? reply.data?.message ?? "Não foi possível conferir o link agora. Tente novamente." : connectionError);
      setStep("unavailable");
    })();
    return () => { active = false; };
  }, [attempt]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Os dois valores são digitados aqui pela mesma pessoa; o servidor valida de novo.
    if (password !== confirmation) { setError("As senhas não coincidem."); return; } // nosemgrep: rules.ajinabraham.njsscan.crypto.timing_attack_node.node_timing_attack
    setIsSubmitting(true);
    setError("");
    const reply = await post("confirm", { token: tokenRef.current, password, confirmation });
    setIsSubmitting(false);
    if (!reply) { setError(connectionError); return; }
    if (reply.ok) {
      tokenRef.current = ""; setPassword(""); setConfirmation(""); setStep("done");
      // As sessões caíram: as outras abas se atualizam (mesmo aviso do login, sem dado pessoal).
      try { window.localStorage.setItem("harmonize-session-change", String(Date.now())); } catch { /* ignora */ }
      return;
    }
    if (reply.data?.code === "invalid_token") { tokenRef.current = ""; setStep("invalid"); return; }
    setError(reply.data?.message ?? "Não foi possível redefinir a senha agora. Tente novamente.");
  }

  return (
    <ResetShell>
      {step === "checking" ? (
        <p aria-live="polite" className="text-center text-sm text-[#7783a8]" role="status">Conferindo o link...</p>
      ) : step === "unavailable" ? (
        <>
          <SignupHeader icon={CircleAlert} subtitle="O link não foi descartado. Não recarregue a página." title="Não foi possível conferir o link" />
          <div role="alert"><ErrorMessage>{error}</ErrorMessage></div>
          <Button className={`mt-5 ${primaryButton}`} onClick={() => { setError(""); setStep("checking"); setAttempt((n) => n + 1); }} size="lg" type="button">Tentar novamente</Button>
          <BackToLogin />
        </>
      ) : step === "invalid" ? (
        <>
          <div role="alert">
            <SignupHeader icon={CircleAlert} subtitle="Ele pode ter expirado, já ter sido usado ou ter sido substituído por um pedido mais novo. Se você recarregou a página, abra de novo o link do e-mail mais recente." title="Link inválido ou expirado" />
          </div>
          <Button asChild className={primaryButton} size="lg"><Link href="/recuperar-senha">Pedir um novo link</Link></Button>
          <BackToLogin />
        </>
      ) : step === "done" ? (
        <>
          <div role="status">
            <SignupHeader icon={CircleCheck} subtitle="Entre com a nova senha. Por segurança, encerramos as sessões abertas e os dispositivos confiáveis." title="Senha alterada" />
          </div>
          <Button asChild className={primaryButton} size="lg"><Link href="/login"><ArrowRight className="h-4 w-4" />Ir para o login</Link></Button>
        </>
      ) : (
        <>
          <SignupHeader icon={KeyRound} subtitle="Escolha uma senha que você ainda não use em outros lugares." title="Criar nova senha" />
          <form className="space-y-4" data-autofill="allow" noValidate onSubmit={handleSubmit}>
            <div>
              <PasswordField autoComplete="new-password" describedBy={strengthId} label="Nova senha" onChange={(value) => { setPassword(value); setError(""); }} password={password} placeholder="Crie uma senha segura" setShowPassword={setShowPassword} showPassword={showPassword} touch />
              <PasswordStrength id={strengthId} password={password} />
            </div>
            <PasswordField autoComplete="new-password" label="Confirmar nova senha" onChange={(value) => { setConfirmation(value); setError(""); }} password={confirmation} placeholder="Digite a senha novamente" setShowPassword={setShowPassword} showPassword={showPassword} touch />
            {error ? <div role="alert"><ErrorMessage>{error}</ErrorMessage></div> : null}
            <Button className={primaryButton} disabled={isSubmitting || !password || !confirmation} size="lg" type="submit"><ArrowRight className="h-4 w-4" />{isSubmitting ? "Salvando..." : "Salvar nova senha"}</Button>
          </form>
          <BackToLogin />
        </>
      )}
    </ResetShell>
  );
}
