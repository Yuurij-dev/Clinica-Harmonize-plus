import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

// Lista enxuta para escolher quem atende: administradores e profissionais, sem e-mail nem atendentes.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "agenda:access")) return NextResponse.json({ message: "Seu cargo não tem acesso à agenda." }, { status: 403 });
  const members = await prisma.clinicMembership.findMany({
    where: { clinicId: user.clinicId, role: { in: ["ADMIN", "PROFESSIONAL"] } },
    orderBy: { user: { name: "asc" } },
    select: { user: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ professionals: members.map((member) => member.user) });
}
