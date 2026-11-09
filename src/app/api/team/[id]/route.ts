import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
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
