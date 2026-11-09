import { NextResponse } from "next/server";
import { parseCollaboratorProfile } from "@/lib/collaborator-profile-rules";
import { getCurrentUser, invalidateUserAuthCache } from "@/lib/auth";
import { canForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "settings:team")) return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const { id } = await params;
  const member = await prisma.clinicMembership.findFirst({
    where: { id, clinicId: user.clinicId },
    select: {
      id: true,
      role: true,
      isOwner: true,
      laborCostCents: true,
      user: { select: { id: true, name: true, email: true, createdAt: true, cpf: true, postalCode: true, address: true, city: true, state: true, country: true } },
    },
  });
  if (!member) return NextResponse.json({ message: "Colaborador não encontrado nesta clínica." }, { status: 404 });
  return NextResponse.json({ member });
}

// Edita os dados pessoais do colaborador (nome, CPF, endereço). E-mail não muda aqui: é a identidade de login.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "settings:team")) return NextResponse.json({ message: "Apenas administradores podem alterar os dados da equipe." }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const profile = parseCollaboratorProfile(body);
  if (!profile.ok) return NextResponse.json({ message: profile.message }, { status: 400 });

  const member = await prisma.clinicMembership.findFirst({ where: { id, clinicId: user.clinicId }, select: { id: true, userId: true, isOwner: true } });
  if (!member) return NextResponse.json({ message: "Colaborador não encontrado nesta clínica." }, { status: 404 });
  if (member.isOwner && member.userId !== user.id) return NextResponse.json({ message: "Só o administrador principal pode editar os próprios dados." }, { status: 403 });
  // A conta é global: se o colaborador também atua em outra clínica, só ele mesmo altera os dados pessoais.
  // Checagem e update na mesma transação para não perder a corrida com um novo vínculo.
  const blocked = await prisma.$transaction(async (tx) => {
    if (member.userId !== user.id && await tx.clinicMembership.count({ where: { userId: member.userId, clinicId: { not: user.clinicId } } }) > 0) return true;
    await tx.user.update({ where: { id: member.userId }, data: profile.value });
    return false;
  });
  if (blocked) return NextResponse.json({ message: "Este colaborador também atua em outra clínica. Apenas ele pode alterar os próprios dados." }, { status: 403 });
  invalidateUserAuthCache(member.userId);
  const updated = await prisma.clinicMembership.findFirst({
    where: { id: member.id, clinicId: user.clinicId },
    select: { id: true, role: true, isOwner: true, laborCostCents: true, user: { select: { id: true, name: true, email: true, createdAt: true, cpf: true, postalCode: true, address: true, city: true, state: true, country: true } } },
  });
  return NextResponse.json({ member: updated });
}
