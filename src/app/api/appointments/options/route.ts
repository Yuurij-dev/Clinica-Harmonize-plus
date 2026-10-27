import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canForUser } from "@/lib/permissions";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "agenda:access")) return NextResponse.json({ message: "Seu cargo não tem acesso à agenda." }, { status: 403 });

  const clinic = await prisma.clinic.findUnique({
    where: { id: user.clinicId },
    select: { openingTime: true, closingTime: true, allowAppointmentsOutsideHours: true },
  });

  return NextResponse.json({ openingTime: clinic?.openingTime ?? "08:00", closingTime: clinic?.closingTime ?? "19:00", allowAppointmentsOutsideHours: clinic?.allowAppointmentsOutsideHours ?? false });
}
