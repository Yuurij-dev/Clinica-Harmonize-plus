import { getCurrentUser } from "@/lib/auth";
import { canForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readUserAvatar, removeUserAvatar, storeUserAvatar } from "@/lib/user-avatar";

const json = (message: string, status: number) => Response.json({ message }, { status });

async function findMember(id: string, clinicId: string) {
  return prisma.clinicMembership.findFirst({ where: { id, clinicId }, select: { id: true, userId: true, isOwner: true } });
}

// Foto do colaborador: leitura/gravação em src/lib/user-avatar.ts (compartilhada com /api/me/avatar).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return json("Não autenticado.", 401);
  const member = await findMember((await params).id, user.clinicId);
  if (!member) return json("Colaborador não encontrado nesta clínica.", 404);
  return readUserAvatar(member.userId);
}

// Mesma regra do PATCH de dados: admin edita membros só desta clínica; owner só a si; conta compartilhada com outra clínica só o próprio.
async function authorize(id: string) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return { error: json("Não autenticado.", 401) };
  const member = await findMember(id, user.clinicId);
  const isSelf = member?.userId === user.id;
  if (!isSelf && !canForUser(user, "settings:team")) return { error: json("Apenas administradores podem alterar os dados da equipe.", 403) };
  if (!member) return { error: json("Colaborador não encontrado nesta clínica.", 404) };
  if (!isSelf) {
    if (member.isOwner) return { error: json("Só o administrador principal pode editar os próprios dados.", 403) };
    if (await prisma.clinicMembership.count({ where: { userId: member.userId, clinicId: { not: user.clinicId } } }) > 0) return { error: json("Este colaborador também atua em outra clínica. Apenas ele pode alterar a própria foto.", 403) };
  }
  return { member };
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize((await params).id);
  if (auth.error) return auth.error;
  return storeUserAvatar(request, auth.member.userId);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize((await params).id);
  if (auth.error) return auth.error;
  return removeUserAvatar(auth.member.userId);
}
