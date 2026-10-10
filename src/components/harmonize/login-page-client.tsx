"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoginScreen, type RegisterResult, type RegisterValues } from "./login-screen";
import { fetchForSave, httpErrorMessage } from "@/lib/client-errors";
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
    const response = await fetchForSave("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }, "Não foi possível salvar a nova senha");
    const data = await response.json().catch(() => null) as { message?: string; clinicName?: string } | null;
    if (!response.ok) return { error: data?.message ?? httpErrorMessage(response, "Não foi possível salvar a nova senha") };
    setClinicName(data?.clinicName ?? "Sua clínica");
    window.setTimeout(() => {
      router.replace("/");
      router.refresh();
    }, 1500);
    return {};
  }

  async function handleRegister(values: RegisterValues) {
      const response = await fetchForSave("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
      }, "Não foi possível criar a conta");

    if (!response.ok) {
      const data = await response.json().catch(() => null) as { message?: string } | null;
      return { error: data?.message ?? httpErrorMessage(response, "Não foi possível criar a conta") } satisfies RegisterResult;
    }
    const result = await handleLogin({ login: values.email, password: values.password });
    return { error: result.error } satisfies RegisterResult;
  }

  return clinicName ? <ClinicEntryTransition clinicName={clinicName} /> : <LoginScreen onLogin={handleLogin} onChangePassword={handlePasswordChange} onRegister={handleRegister} />;
}
