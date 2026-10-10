import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clinicWarningDays } from "@/lib/stock";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  return NextResponse.json({ settings: { expiryWarningDays: await clinicWarningDays(user.clinicId) } });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const body = await request.json().catch(() => null) as { expiryWarningDays?: number } | null;
  const expiryWarningDays = Number(body?.expiryWarningDays);
  if (!Number.isInteger(expiryWarningDays) || expiryWarningDays < 0 || expiryWarningDays > 365) return NextResponse.json({ message: "Informe de 0 a 365 dias." }, { status: 400 });
  const clinic = await prisma.clinic.update({ where: { id: user.clinicId }, data: { expiryWarningDays }, select: { expiryWarningDays: true } });
  return NextResponse.json({ settings: clinic });
}
