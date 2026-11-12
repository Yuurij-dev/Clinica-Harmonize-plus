import { NextResponse } from "next/server";
import { loadOwnProfile } from "@/lib/own-profile";
import { noStore, requireSecurityUser, securityError } from "@/lib/security-api";

// Perfil do PRÓPRIO usuário (userId da sessão). CPF sempre mascarado; nenhum segredo na resposta.
export async function GET(request: Request) {
  const { user, error } = await requireSecurityUser(request);
  if (error) return error;
  const profile = await loadOwnProfile(user);
  if (!profile) return securityError("Não autenticado.", 401);
  return NextResponse.json(profile, { headers: noStore });
}
