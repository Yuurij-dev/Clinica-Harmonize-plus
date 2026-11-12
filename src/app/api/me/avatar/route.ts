import { readUserAvatar, removeUserAvatar, storeUserAvatar } from "@/lib/user-avatar";
import { requireSecurityUser } from "@/lib/security-api";

// Foto do PRÓPRIO usuário (userId da sessão; nunca do cliente). Limites e sanitização iguais a /api/team/[id]/avatar.
export async function GET(request: Request) {
  const { user, error } = await requireSecurityUser(request);
  if (error) return error;
  // A versão (?v=) muda o URL ao trocar a foto, então com ela o navegador pode guardar a imagem por 1 dia (só no cache privado).
  return readUserAvatar(user.id, { versioned: new URL(request.url).searchParams.has("v") });
}

export async function PUT(request: Request) {
  const { user, error } = await requireSecurityUser(request, { mutation: true });
  if (error) return error;
  return storeUserAvatar(request, user.id);
}

export async function DELETE(request: Request) {
  const { user, error } = await requireSecurityUser(request, { mutation: true });
  if (error) return error;
  return removeUserAvatar(user.id);
}
