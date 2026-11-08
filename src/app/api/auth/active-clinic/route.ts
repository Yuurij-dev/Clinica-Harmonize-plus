import { NextResponse } from "next/server";
import { getCurrentUser, invalidateUserAuthCache } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Sessão expirada. Entre novamente." }, { status: 401 });

  const body = await request.json().catch(() => null) as { clinicId?: unknown } | null;
  const clinicId = typeof body?.clinicId === "string" ? body.clinicId : "";
  if (!clinicId) return NextResponse.json({ message: "Informe a clínica." }, { status: 400 });

  // O clinicId do cliente só vale se o próprio usuário da sessão for membro dessa clínica.
  const membership = await prisma.clinicMembership.findUnique({
    where: { userId_clinicId: { userId: user.id, clinicId } },
    select: { clinicId: true },
  });
  if (!membership) return NextResponse.json({ message: "Você não tem acesso a esta clínica." }, { status: 403 });

  await prisma.user.update({ where: { id: user.id }, data: { activeClinicId: membership.clinicId }, select: { id: true } });
  invalidateUserAuthCache(user.id);
  return NextResponse.json({ success: true, clinicId: membership.clinicId });
}
