"use client";

import { useRouter } from "next/navigation";
import { LoginScreen } from "@/components/harmonize/login-screen";

export default function LoginPage() {
  const router = useRouter();

  async function login(credentials: { login: string; password: string }) {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });
    return response.ok;
  }

  async function handleLogin(credentials: { login: string; password: string }) {
    const success = await login(credentials);
    if (success) router.push("/");
    return success;
  }

  return <LoginScreen onLogin={handleLogin} />;
}
