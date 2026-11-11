"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoginScreen, type GoogleSignupValues, type MfaVerifyInput, type MfaVerifyResult, type RegisterResult, type RegisterValues, type VerifyResult } from "./login-screen";
import { setClientCacheScope } from "@/lib/client-cache";

export function LoginPageClient({ initialMode, googleStatus }: { initialMode: "login" | "register" | "mfa"; googleStatus?: string }) {
  const router = useRouter();

  useEffect(() => {
    document.documentElement.classList.remove("dark");
  }, []);

  async function handleLogin(credentials: { login: string; password: string }) {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });

    const data = await response.json().catch(() => null) as { message?: string; passwordChangeRequired?: boolean; mfaRequired?: boolean; user?: { id?: string; clinic?: { id?: string; name?: string } } } | null;
    if (!response.ok) return { error: data?.message ?? "Usuário ou senha inválidos." };
    // 2FA ativo: ainda não há sessão; a tela de verificação conclui o login.
    if (data?.mfaRequired) return { mfaRequired: true };
    // Login novo: com 2+ clínicas a tela de escolha volta a aparecer.
    try { window.sessionStorage.removeItem("harmonize-clinic-chosen"); } catch { /* ignora */ }
    setClientCacheScope(data?.user?.id && data.user.clinic?.id ? `${data.user.id}:${data.user.clinic.id}` : null);
    window.localStorage.setItem("harmonize-session-change", String(Date.now()));
    if (data?.passwordChangeRequired) return { passwordChangeRequired: true };
    router.replace("/");
    router.refresh();
    return {};
  }

  async function handlePasswordChange(password: string) {
    const response = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await response.json().catch(() => null) as { message?: string; clinicName?: string; mfaRequired?: boolean } | null;
    if (!response.ok) return { error: data?.message ?? "Não foi possível salvar a nova senha." };
    if (data?.mfaRequired) return { mfaRequired: true };
    router.replace("/");
    router.refresh();
    return {};
  }

  // Conclui o login no segundo estágio. A sessão só existe depois do código: escopo do cache e aviso às outras abas vêm daqui.
  async function handleVerifyMfa(input: MfaVerifyInput): Promise<MfaVerifyResult> {
    let response: Response;
    try {
      response = await fetch("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    } catch {
      return { error: "Não foi possível verificar o código agora. Tente novamente." };
    }
    const data = await response.json().catch(() => null) as { message?: string; code?: string; recoveryCodesRemaining?: number; user?: { id?: string; clinic?: { id?: string } } } | null;
    if (!response.ok) {
      if (data?.code === "mfa_expired") return { expired: true, error: "A verificação expirou. Entre novamente." };
      return { error: data?.message ?? "Código inválido ou expirado." };
    }
    try { window.sessionStorage.removeItem("harmonize-clinic-chosen"); } catch { /* ignora */ }
    setClientCacheScope(data?.user?.id && data.user.clinic?.id ? `${data.user.id}:${data.user.clinic.id}` : null);
    window.localStorage.setItem("harmonize-session-change", String(Date.now()));
    return typeof data?.recoveryCodesRemaining === "number" ? { recoveryCodesRemaining: data.recoveryCodesRemaining } : {};
  }

  function handleEnterApp() {
    router.replace("/");
    router.refresh();
  }

  async function handleRegister(values: RegisterValues) {
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    const data = await response.json().catch(() => null) as { message?: string; verificationRequired?: boolean } | null;
    if (!response.ok) return { error: data?.message ?? "Não foi possível criar a conta agora. Tente novamente." } satisfies RegisterResult;
    // Com provedor de e-mail a conta só nasce após o código; sem provedor (dev) o cadastro já foi criado.
    if (data?.verificationRequired) return { verificationRequired: true } satisfies RegisterResult;
    const result = await handleLogin({ login: values.email, password: values.password });
    return { error: result.error } satisfies RegisterResult;
  }

  async function handleVerifyEmail(values: { email: string; password: string; code: string }): Promise<VerifyResult> {
    let response: Response;
    try {
      response = await fetch("/api/auth/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: values.email, code: values.code, password: values.password }),
      });
    } catch {
      return { error: "Não foi possível verificar o código agora. Tente novamente." };
    }
    const data = await response.json().catch(() => null) as { message?: string } | null;
    if (!response.ok) return { error: data?.message ?? "Não foi possível verificar o código agora. Tente novamente." };
    // Conta criada: se o login automático falhar, não é erro de código (a tela volta ao login).
    try {
      const result = await handleLogin({ login: values.email, password: values.password });
      return result.error ? { createdButLoginFailed: true } : {};
    } catch {
      return { createdButLoginFailed: true };
    }
  }

  async function handleResendCode(email: string) {
    const response = await fetch("/api/auth/register/resend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { message?: string } | null;
      return { error: data?.message ?? "Não foi possível reenviar o código agora." };
    }
    return {};
  }

  async function handleGoogleSignup(values: GoogleSignupValues) {
    const response = await fetch("/api/auth/google/signup/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { code?: string; message?: string } | null;
      // Cookie expirado ou conta já existente: o passo não tem como continuar, volta ao login com o aviso.
      if (data?.code === "pending_missing" || data?.code === "account_exists") {
        window.location.assign(data.code === "account_exists" ? "/login?google=account_exists" : "/login?google=signup_expired");
        return {} satisfies RegisterResult;
      }
      return { error: data?.message ?? "Não foi possível criar a conta agora. Tente novamente." } satisfies RegisterResult;
    }
    // Navegação completa: o app abre já autenticado e `?google=ok` avisa as outras abas da troca de sessão.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/?google=ok");
    return {} satisfies RegisterResult;
  }

  return <LoginScreen initialMode={initialMode} googleStatus={googleStatus} onLogin={handleLogin} onChangePassword={handlePasswordChange} onVerifyMfa={handleVerifyMfa} onEnterApp={handleEnterApp} onRegister={handleRegister} onVerifyEmail={handleVerifyEmail} onResendCode={handleResendCode} onGoogleSignup={handleGoogleSignup} />;
}
