import { hash } from "bcryptjs";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser, invalidateUserAuthCache } from "@/lib/auth";
import { denyIfReadonly, denyUnlessFeature, hasFeature, planErrorResponse } from "@/lib/plan-guards";
import { lockPlanResource, reserveCapacity } from "@/lib/plan-usage";
import { countsAsProfessional } from "@/lib/plans";
import { canForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { parseCollaboratorProfile } from "@/lib/collaborator-profile-rules";
import { isRoleDemotion } from "@/lib/invitation-rules";
import { cancelPendingByInviter, deleteAcceptedByAccepter } from "@/lib/invitations-repo";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "settings:team")) return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const members = await prisma.clinicMembership.findMany({
    where: { clinicId: user.clinicId },
    orderBy: { user: { name: "asc" } },
    select: { id: true, role: true, isOwner: true, laborCostCents: true, user: { select: { id: true, name: true, email: true, createdAt: true } } },
  });
  // Custo/hora do profissional e recurso `costs`: sem ele a resposta NAO traz o valor (nem zerado); o dado fica no banco.
  const costsAllowed = hasFeature(user, "costs");
  return NextResponse.json({ members: costsAllowed ? members : members.map((member) => ({ ...member, laborCostCents: null })) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const readonlyDenied = denyIfReadonly(user);
  if (readonlyDenied) return readonlyDenied;
  if (!canForUser(user, "settings:team")) return NextResponse.json({ message: "Apenas administradores podem cadastrar colaboradores." }, { status: 403 });

  const body = await request.json().catch(() => null) as { name?: string; email?: string; password?: string; role?: "ADMIN" | "PROFESSIONAL" | "STAFF"; cpf?: string; postalCode?: string; address?: string; country?: string; state?: string; city?: string } | null;
  const name = body?.name?.trim();
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password ?? "";
  const role = body?.role ?? "PROFESSIONAL";
  if (!name || !email || password.length < 8 || !["ADMIN", "PROFESSIONAL", "STAFF"].includes(role)) {
    return NextResponse.json({ message: "Informe nome, e-mail e uma senha com pelo menos 8 caracteres." }, { status: 400 });
  }
  const profile = parseCollaboratorProfile(body);
  if (!profile.ok) return NextResponse.json({ message: profile.message }, { status: 400 });
  const { cpf, postalCode, address, country, state, city } = profile.value;

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return NextResponse.json({ message: "Já existe uma conta com este e-mail." }, { status: 409 });

  try {
    const passwordHash = await hash(password, 12);
    const outcome = await prisma.$transaction(async (transaction) => {
      // ADMIN e PROFESSIONAL consomem vaga do plano (STAFF nao). Trava por clinica + contagem + criacao na MESMA transacao.
      if (countsAsProfessional(role)) {
        const capacity = await reserveCapacity(transaction, user.clinicId, "professionals");
        if (!capacity.ok) return { denied: capacity.body } as const;
      }
      const createdUser = await transaction.user.create({ data: { name, email, passwordHash, role, mustChangePassword: true, emailVerifiedAt: new Date(), cpf, postalCode, address, country, state, city } });
      const member = await transaction.clinicMembership.create({
        data: { userId: createdUser.id, clinicId: user.clinicId, role },
        select: { id: true, role: true, isOwner: true, laborCostCents: true, user: { select: { id: true, name: true, email: true, createdAt: true } } },
      });
      return { member } as const;
    });
    if (outcome.denied) return planErrorResponse(outcome.denied);
    return NextResponse.json({ member: hasFeature(user, "costs") ? outcome.member : { ...outcome.member, laborCostCents: null } }, { status: 201 });
  } catch (error) {
    console.error("Failed to create clinic collaborator", error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ message: "Já existe uma conta com este e-mail." }, { status: 409 });
    }
    return NextResponse.json({ message: "Não foi possível cadastrar o colaborador agora. Tente novamente." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const readonlyDenied = denyIfReadonly(user);
  if (readonlyDenied) return readonlyDenied;
  if (!canForUser(user, "settings:team")) return NextResponse.json({ message: "Apenas administradores podem alterar os dados da equipe." }, { status: 403 });

  const body = await request.json().catch(() => null) as { membershipId?: string; laborCostCents?: number; role?: string } | null;
  const membershipId = body?.membershipId?.trim();
  if (!membershipId) return NextResponse.json({ message: "Informe o colaborador que será atualizado." }, { status: 400 });

  if (body?.role !== undefined) {
    if (!["ADMIN", "PROFESSIONAL", "STAFF"].includes(body.role)) {
      return NextResponse.json({ message: "Selecione um cargo válido." }, { status: 400 });
    }
    const member = await prisma.clinicMembership.findFirst({
      where: { id: membershipId, clinicId: user.clinicId },
      select: { id: true, userId: true, isOwner: true, role: true },
    });
    if (!member) return NextResponse.json({ message: "Colaborador não encontrado nesta clínica." }, { status: 404 });
    if (member.isOwner || member.userId === user.id) {
      return NextResponse.json({ message: "O cargo do administrador principal não pode ser alterado." }, { status: 409 });
    }
    // B3: rebaixar o cargo cancela, na mesma transação, os convites PENDING que este membro criou nesta clínica.
    const newRole = body.role as "ADMIN" | "PROFESSIONAL" | "STAFF";
    const outcome = await prisma.$transaction(async (transaction) => {
      // Passar a ADMIN/PROFESSIONAL aumenta o consumo de vagas. Trava primeiro e RELE o cargo atual com a trava tomada
      // (duas mudancas simultaneas nao enxergam o mesmo cargo antigo); so quem sai de fora (STAFF) pede vaga.
      await lockPlanResource(transaction, user.clinicId, "professionals");
      const current = await transaction.clinicMembership.findFirst({ where: { id: member.id, clinicId: user.clinicId }, select: { role: true, isOwner: true } });
      if (!current) return { gone: true } as const;
      if (current.isOwner) return { owner: true } as const;
      if (countsAsProfessional(newRole) && !countsAsProfessional(current.role)) {
        const capacity = await reserveCapacity(transaction, user.clinicId, "professionals");
        if (!capacity.ok) return { denied: capacity.body } as const;
      }
      const result = await transaction.clinicMembership.update({
        where: { id: member.id },
        data: { role: newRole },
        select: { id: true, role: true, isOwner: true, laborCostCents: true, user: { select: { id: true, name: true, email: true, createdAt: true } } },
      });
      if (isRoleDemotion(current.role, newRole)) await cancelPendingByInviter(transaction, { clinicId: user.clinicId, invitedById: member.userId });
      return { updated: result } as const;
    });
    if (outcome.gone) return NextResponse.json({ message: "Colaborador não encontrado nesta clínica." }, { status: 404 });
    if (outcome.owner) return NextResponse.json({ message: "O cargo do administrador principal não pode ser alterado." }, { status: 409 });
    if (outcome.denied) return planErrorResponse(outcome.denied);
    const updated = outcome.updated;
    // Só depois do sucesso, só o usuário afetado. O cache de auth é em memória por instância: em serverless a janela
    // de 15 s pode persistir em outras instâncias; por isso o aceite continua exigindo que o convidante seja membro.
    invalidateUserAuthCache(member.userId);
    return NextResponse.json({ member: hasFeature(user, "costs") ? updated : { ...updated, laborCostCents: null } });
  }

  // Alterar custo de mao de obra: recurso `costs` (Pro/Premium).
  const costsDenied = denyUnlessFeature(user, "costs", "write");
  if (costsDenied) return costsDenied;
  const laborCostCents = body?.laborCostCents;
  if (typeof laborCostCents !== "number" || !Number.isSafeInteger(laborCostCents) || laborCostCents < 0 || laborCostCents > 2_000_000_000) {
    return NextResponse.json({ message: "Informe um profissional e um valor válido em reais." }, { status: 400 });
  }
  const member = await prisma.clinicMembership.findFirst({ where: { id: membershipId, clinicId: user.clinicId, role: { in: ["PROFESSIONAL", "ADMIN"] } }, select: { id: true } });
  if (!member) return NextResponse.json({ message: "Profissional não encontrado nesta clínica." }, { status: 404 });
  const updated = await prisma.clinicMembership.update({
    where: { id: member.id },
    data: { laborCostCents },
    select: { id: true, role: true, isOwner: true, laborCostCents: true, user: { select: { id: true, name: true, email: true, createdAt: true } } },
  });
  return NextResponse.json({ member: updated });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const readonlyDenied = denyIfReadonly(user);
  if (readonlyDenied) return readonlyDenied;
  if (!canForUser(user, "settings:team") || !user.isOwner) return NextResponse.json({ message: "Apenas o administrador principal pode remover colaboradores." }, { status: 403 });

  const body = await request.json().catch(() => null) as { membershipId?: string } | null;
  const membershipId = body?.membershipId?.trim();
  if (!membershipId) return NextResponse.json({ message: "Informe o colaborador que será removido." }, { status: 400 });

  const member = await prisma.clinicMembership.findFirst({
    where: { id: membershipId, clinicId: user.clinicId },
    select: { id: true, userId: true, isOwner: true },
  });
  if (!member) return NextResponse.json({ message: "Colaborador não encontrado." }, { status: 404 });
  if (member.isOwner || member.userId === user.id) {
    return NextResponse.json({ message: "O administrador principal não pode ser removido." }, { status: 409 });
  }

  await prisma.$transaction(async (transaction) => {
    // B3: convites pendentes criados por quem sai deixam de valer (escopo da clínica da sessão).
    await cancelPendingByInviter(transaction, { clinicId: user.clinicId, invitedById: member.userId });
    // O convite que o removido aceitou nesta clínica some (antes de apagar o usuário, enquanto acceptedById ainda aponta pra ele).
    await deleteAcceptedByAccepter(transaction, { clinicId: user.clinicId, acceptedById: member.userId });
    await transaction.clinicMembership.delete({ where: { id: member.id } });
    const remainingMemberships = await transaction.clinicMembership.count({ where: { userId: member.userId } });
    if (!remainingMemberships) await transaction.user.delete({ where: { id: member.userId } });
  });

  invalidateUserAuthCache(member.userId); // mesma ressalva de instância do PATCH acima
  return NextResponse.json({ removed: true });
}
