import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const now = Date.now();
  const appointments = await prisma.appointment.findMany({
    where: {
      clinicId: user.clinicId,
      date: { gte: new Date(now - 2 * 86_400_000), lte: new Date(now + 2 * 86_400_000) },
      status: { notIn: ["Atendido", "Faltou", "Cancelado"] },
    },
    select: { id: true, date: true, time: true, status: true, patient: { select: { name: true } } },
  });

  return NextResponse.json({ appointments });
}
