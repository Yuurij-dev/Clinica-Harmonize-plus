"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoginScreen, type RegisterResult, type RegisterValues } from "./login-screen";
import { ClinicEntryTransition } from "./clinic-entry-transition";

export function LoginPageClient() {
  const router = useRouter();
  const [clinicName, setClinicName] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.remove("dark");
  }, []);

  async function handleLogin(credentials: { login: string; password: string }) {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });

    const data = await response.json().catch(() => null) as { message?: string; passwordChangeRequired?: boolean; user?: { clinic?: { name?: string } } } | null;
    if (!response.ok) return { error: data?.message ?? "Usuário ou senha inválidos." };
    if (data?.passwordChangeRequired) return { passwordChangeRequired: true };
    setClinicName(data?.user?.clinic?.name ?? "Sua clínica");
    window.setTimeout(() => {
      router.replace("/");
      router.refresh();
    }, 1500);
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
    setClinicName(data?.clinicName ?? "Sua clínica");
    window.setTimeout(() => {
      router.replace("/");
      router.refresh();
    }, 1500);
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
    const data = await response.json() as { email?: string; verificationUrl?: string };
    return { verificationEmail: data.email ?? values.email, verificationUrl: data.verificationUrl } satisfies RegisterResult;
  }

  return clinicName ? <ClinicEntryTransition clinicName={clinicName} /> : <LoginScreen onLogin={handleLogin} onChangePassword={handlePasswordChange} onRegister={handleRegister} />;
}
