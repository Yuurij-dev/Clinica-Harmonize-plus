import { NextResponse } from "next/server";
import { getCurrentUser } from "./auth";
import { denyIfReadonly, denyUnlessFeature } from "./plan-guards";
import type { Feature } from "./plans";
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
// `write` = true: é uma escrita, então somente leitura (teste/assinatura sem acesso completo) responde 403 SUBSCRIPTION_READONLY.
export async function adminUser(write = false, permission: Permission = "stock:manage", feature?: Feature) {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ message: "Não autenticado." }, { status: 401 }) };
  if (write) {
    const readonlyDenied = denyIfReadonly(user);
    if (readonlyDenied) return { error: readonlyDenied };
  }
  if (!canForUser(user, permission)) return { error: NextResponse.json({ message: "Seu cargo não tem permissão para esta ação." }, { status: 403 }) };
  // Recurso do plano (ex.: estoque): permissao do papel E recurso da clinica. Em downgrade os dados ficam, mas inacessiveis.
  if (feature) {
    const featureDenied = denyUnlessFeature(user, feature, write ? "write" : "read");
    if (featureDenied) return { error: featureDenied };
  }
  return { user };
}
