"use client";

import { useRouter } from "next/navigation";
import { LoginScreen } from "@/components/harmonize/login-screen";

export default function LoginPage() {
  const router = useRouter();

  return <LoginScreen onLogin={() => router.push("/")} />;
}
