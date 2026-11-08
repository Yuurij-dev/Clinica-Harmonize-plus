"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoginScreen, type GoogleSignupValues, type RegisterResult, type RegisterValues } from "./login-screen";
import { setClientCacheScope } from "@/lib/client-cache";

export function LoginPageClient({ initialMode, googleStatus }: { initialMode: "login" | "register"; googleStatus?: string }) {
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

    const data = await response.json().catch(() => null) as { message?: string; passwordChangeRequired?: boolean; user?: { id?: string; clinic?: { id?: string; name?: string } } } | null;
    if (!response.ok) return { error: data?.message ?? "Usuário ou senha inválidos." };
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
    const data = await response.json().catch(() => null) as { message?: string; clinicName?: string } | null;
    if (!response.ok) return { error: data?.message ?? "Não foi possível salvar a nova senha." };
    router.replace("/");
    router.refresh();
    return {};
  }

  async function handleRegister(values: RegisterValues) {
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null) as { message?: string } | null;
      return { error: data?.message ?? "Não foi possível criar a conta agora. Tente novamente." } satisfies RegisterResult;
    }
    const result = await handleLogin({ login: values.email, password: values.password });
    return { error: result.error } satisfies RegisterResult;
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

  return <LoginScreen initialMode={initialMode} googleStatus={googleStatus} onLogin={handleLogin} onChangePassword={handlePasswordChange} onRegister={handleRegister} onGoogleSignup={handleGoogleSignup} />;
}
