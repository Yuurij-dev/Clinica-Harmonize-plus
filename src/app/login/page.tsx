import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginPageClient } from "@/components/harmonize/login-page-client";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ mode?: string | string[] }> }) {
  // Banco fora do ar: mostra o formulário mesmo assim (o login responde o erro), em vez da página de erro.
  const user = await getCurrentUser().catch(() => null);
  if (user) redirect("/");
  const { mode } = await searchParams;
  return <LoginPageClient initialMode={mode === "register" ? "register" : "login"} />;
}
