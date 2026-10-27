import { NextResponse } from "next/server";
import { getCurrentUser } from "./auth";
import { can, type Permission } from "./permissions";

const messages: Record<Permission, string> = {
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
export function denyUnless(role: string, permission: Permission) {
  return can(role, permission) ? null : NextResponse.json({ message: messages[permission] }, { status: 403 });
}

// Sessão de administrador (estoque e demais telas só de ADMIN): { user } ou { error } com 401/403 pronto para devolver.
export async function adminUser(requireActiveTrial = false) {
  const user = await getCurrentUser({ requireActiveTrial });
  if (!user) return { error: NextResponse.json({ message: "Não autenticado." }, { status: 401 }) };
  if (user.role !== "ADMIN") return { error: NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 }) };
  return { user };
}
