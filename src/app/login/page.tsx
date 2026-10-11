import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginPageClient } from "@/components/harmonize/login-page-client";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ mode?: string | string[] }> }) {
  const user = await getCurrentUser();
  if (user) redirect("/");
  const { mode } = await searchParams;
  return <LoginPageClient initialMode={mode === "register" ? "register" : "login"} />;
}
