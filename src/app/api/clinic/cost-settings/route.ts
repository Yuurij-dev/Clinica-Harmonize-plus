import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  try {
    const clinic = await prisma.clinic.findUnique({
      where: { id: user.clinicId },
      select: { laborCost: true, facilityCost: true, medicationCost: true },
    });
    return NextResponse.json({ settings: clinic ?? { laborCost: 0, facilityCost: 0, medicationCost: 0 } });
  } catch {
    return NextResponse.json({ message: "As colunas de custos ainda não foram criadas no banco da clínica." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const laborCost = Number(body?.laborCost);
  const facilityCost = Number(body?.facilityCost);
  const medicationCost = Number(body?.medicationCost);
  if (![laborCost, facilityCost, medicationCost].every((value) => Number.isFinite(value) && value >= 0)) {
    return NextResponse.json({ message: "Informe valores válidos para os custos." }, { status: 400 });
  }

  try {
    const settings = await prisma.clinic.update({
      where: { id: user.clinicId },
      data: { laborCost: Math.round(laborCost), facilityCost: Math.round(facilityCost), medicationCost: Math.round(medicationCost) },
      select: { laborCost: true, facilityCost: true, medicationCost: true },
    });
    return NextResponse.json({ settings });
  } catch {
    return NextResponse.json({ message: "As colunas de custos ainda não foram criadas no banco da clínica." }, { status: 500 });
  }
}
