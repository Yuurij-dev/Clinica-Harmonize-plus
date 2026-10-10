import { NextResponse } from "next/server";
import { can, type Permission } from "./permissions";

const messages: Record<Permission, string> = {
  "clinical:read": "Acesso restrito à equipe clínica.",
  "clinical:write": "Acesso restrito à equipe clínica.",
  "appointment:run": "O atendimento é conduzido pela equipe clínica.",
  "payments:access": "Acesso restrito.",
  "payments:delete": "Acesso restrito a administradores.",
  "quote:edit-closed": "Orçamento já fechado: só administrador ou profissional pode alterar.",
};

// Devolve a resposta 403 quando o papel não tem a permissão; null quando pode seguir.
export function denyUnless(role: string, permission: Permission) {
  return can(role, permission) ? null : NextResponse.json({ message: messages[permission] }, { status: 403 });
}
