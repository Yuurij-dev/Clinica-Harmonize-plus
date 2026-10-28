import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "settings:own-cost")) return NextResponse.json({ message: "Seu cargo não pode alterar valor de mão de obra." }, { status: 403 });
  const membership = await prisma.clinicMembership.findFirst({
    where: { clinicId: user.clinicId, userId: user.id, role: { in: ["ADMIN", "PROFESSIONAL"] } },
    select: { laborCostCents: true },
  });
  if (!membership) return NextResponse.json({ message: "Profissional não encontrado nesta clínica." }, { status: 404 });
  return NextResponse.json({ laborCostCents: membership.laborCostCents });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "settings:own-cost")) return NextResponse.json({ message: "Seu cargo não pode alterar valor de mão de obra." }, { status: 403 });
  const body = await request.json().catch(() => null) as { laborCostCents?: unknown } | null;
  const laborCostCents = body?.laborCostCents;
  if (typeof laborCostCents !== "number" || !Number.isSafeInteger(laborCostCents) || laborCostCents < 0 || laborCostCents > 2_000_000_000) {
    return NextResponse.json({ message: "Informe um valor de mão de obra válido." }, { status: 400 });
  }
  const updated = await prisma.clinicMembership.updateMany({
    where: { clinicId: user.clinicId, userId: user.id, role: { in: ["ADMIN", "PROFESSIONAL"] } },
    data: { laborCostCents },
  });
  if (!updated.count) return NextResponse.json({ message: "Profissional não encontrado nesta clínica." }, { status: 404 });
  return NextResponse.json({ laborCostCents });
}
