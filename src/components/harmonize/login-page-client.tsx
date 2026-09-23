"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoginScreen } from "./login-screen";
import { ClinicEntryTransition } from "./clinic-entry-transition";

export function LoginPageClient() {
  const router = useRouter();
  const [clinicName, setClinicName] = useState<string | null>(null);

  async function handleLogin(credentials: { login: string; password: string }) {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });

    if (!response.ok) return false;
    const data = await response.json() as { user?: { clinic?: { name?: string } } };
    setClinicName(data.user?.clinic?.name ?? "Sua clínica");
    window.setTimeout(() => {
      router.replace("/");
      router.refresh();
    }, 1500);
    return true;
  }

  return clinicName ? <ClinicEntryTransition clinicName={clinicName} /> : <LoginScreen onLogin={handleLogin} />;
}
