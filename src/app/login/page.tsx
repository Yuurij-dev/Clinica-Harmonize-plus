import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginPageClient } from "@/components/harmonize/login-page-client";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");
  return <LoginPageClient />;
}
