import { hash } from "bcryptjs";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const members = await prisma.clinicMembership.findMany({
    where: { clinicId: user.clinicId },
    orderBy: { user: { name: "asc" } },
    select: { id: true, role: true, isOwner: true, laborCostCents: true, user: { select: { id: true, name: true, email: true, createdAt: true } } },
  });
  return NextResponse.json({ members });
}

export async function POST(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Apenas administradores podem cadastrar colaboradores." }, { status: 403 });

  const body = await request.json().catch(() => null) as { name?: string; email?: string; password?: string; role?: "ADMIN" | "PROFESSIONAL" | "STAFF" } | null;
  const name = body?.name?.trim();
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password ?? "";
  const role = body?.role ?? "PROFESSIONAL";
  if (!name || !email || password.length < 8 || !["ADMIN", "PROFESSIONAL", "STAFF"].includes(role)) {
    return NextResponse.json({ message: "Informe nome, e-mail e uma senha com pelo menos 8 caracteres." }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return NextResponse.json({ message: "Já existe uma conta com este e-mail." }, { status: 409 });

  try {
    const passwordHash = await hash(password, 12);
    const member = await prisma.$transaction(async (transaction) => {
      const createdUser = await transaction.user.create({ data: { name, email, passwordHash, role, mustChangePassword: true, emailVerifiedAt: new Date() } });
      return transaction.clinicMembership.create({
        data: { userId: createdUser.id, clinicId: user.clinicId, role },
        select: { id: true, role: true, isOwner: true, laborCostCents: true, user: { select: { id: true, name: true, email: true, createdAt: true } } },
      });
    });
    return NextResponse.json({ member }, { status: 201 });
  } catch (error) {
    console.error("Failed to create clinic collaborator", error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ message: "Já existe uma conta com este e-mail." }, { status: 409 });
    }
    return NextResponse.json({ message: "Não foi possível cadastrar o colaborador agora. Tente novamente." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Apenas administradores podem alterar os dados da equipe." }, { status: 403 });

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
    const updated = await prisma.clinicMembership.update({
      where: { id: member.id },
      data: { role: body.role as "ADMIN" | "PROFESSIONAL" | "STAFF" },
      select: { id: true, role: true, isOwner: true, laborCostCents: true, user: { select: { id: true, name: true, email: true, createdAt: true } } },
    });
    return NextResponse.json({ member: updated });
  }

  const laborCostCents = body?.laborCostCents;
  if (typeof laborCostCents !== "number" || !Number.isSafeInteger(laborCostCents) || laborCostCents < 0 || laborCostCents > 2_000_000_000) {
    return NextResponse.json({ message: "Informe um profissional e um valor válido em reais." }, { status: 400 });
  }
  const member = await prisma.clinicMembership.findFirst({ where: { id: membershipId, clinicId: user.clinicId, role: "PROFESSIONAL" }, select: { id: true } });
  if (!member) return NextResponse.json({ message: "Profissional não encontrado nesta clínica." }, { status: 404 });
  const updated = await prisma.clinicMembership.update({
    where: { id: member.id },
    data: { laborCostCents },
    select: { id: true, role: true, isOwner: true, laborCostCents: true, user: { select: { id: true, name: true, email: true, createdAt: true } } },
  });
  return NextResponse.json({ member: updated });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN" || !user.isOwner) return NextResponse.json({ message: "Apenas o administrador principal pode remover colaboradores." }, { status: 403 });

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
    await transaction.clinicMembership.delete({ where: { id: member.id } });
    const remainingMemberships = await transaction.clinicMembership.count({ where: { userId: member.userId } });
    if (!remainingMemberships) await transaction.user.delete({ where: { id: member.userId } });
  });

  return NextResponse.json({ removed: true });
}
