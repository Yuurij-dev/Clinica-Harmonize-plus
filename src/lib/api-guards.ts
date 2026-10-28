import { NextResponse } from "next/server";
import { getCurrentUser } from "./auth";
import { canForUser, type Permission, type PermissionPrincipal } from "./permissions";

const messages: Partial<Record<Permission, string>> = {
  "clinical:read": "Acesso restrito à equipe clínica.",
  "clinical:write": "Acesso restrito à equipe clínica.",
  "anamnesis:read": "A anamnese é restrita à equipe clínica.",
  "anamnesis:write": "A anamnese é restrita à equipe clínica.",
  "appointment:run": "O atendimento é conduzido pela equipe clínica.",
  "clinical:archive": "Apenas administrador ou profissional pode arquivar.",
  "clinical:delete": "Apenas administradores podem excluir definitivamente.",
  "payments:access": "Acesso restrito.",
  "payments:delete": "Acesso restrito a administradores.",
  "quote:edit-closed": "Orçamento já fechado: só administrador ou profissional pode alterar.",
};

// Devolve a resposta 403 quando o papel não tem a permissão; null quando pode seguir.
export function denyUnless(user: PermissionPrincipal, permission: Permission) {
  return canForUser(user, permission) ? null : NextResponse.json({ message: messages[permission] ?? "Seu cargo não tem permissão para esta ação." }, { status: 403 });
}

// Sessão de administrador (estoque e demais telas só de ADMIN): { user } ou { error } com 401/403 pronto para devolver.
export async function adminUser(requireActiveTrial = false, permission: Permission = "stock:manage") {
  const user = await getCurrentUser({ requireActiveTrial });
  if (!user) return { error: NextResponse.json({ message: "Não autenticado." }, { status: 401 }) };
  if (!canForUser(user, permission)) return { error: NextResponse.json({ message: "Seu cargo não tem permissão para esta ação." }, { status: 403 }) };
  return { user };
}
