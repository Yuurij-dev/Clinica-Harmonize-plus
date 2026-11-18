import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  // Clínicas do próprio usuário (userId da sessão) para o seletor; a ativa é user.clinicId.
  const [memberships, avatar] = await Promise.all([
    prisma.clinicMembership.findMany({
      where: { userId: user.id },
      orderBy: { id: "asc" },
      select: { role: true, isOwner: true, clinic: { select: { id: true, name: true } } },
    }),
    // Só a versão da foto (sem bytes): o topbar monta /api/me/avatar?v=<versão>.
    prisma.userAvatar.findUnique({ where: { userId: user.id }, select: { updatedAt: true } }),
  ]);
  const clinics = memberships.map((membership) => ({ id: membership.clinic.id, name: membership.clinic.name, role: membership.role, isOwner: membership.isOwner }));
  const publicUser = { ...user, sessionId: undefined, avatarVersion: avatar?.updatedAt.toISOString() ?? null }; // sid não vai ao cliente
  return NextResponse.json({ user: publicUser, clinics });
}
