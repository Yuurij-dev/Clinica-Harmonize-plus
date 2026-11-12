import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

// "Meu perfil": aberto a todos os papéis. O conteúdo é a visão de perfil do shell (HarmonizeApp, via AppRouterShell).
export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return null;
}
