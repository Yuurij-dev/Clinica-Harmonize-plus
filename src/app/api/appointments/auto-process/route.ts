import { NextResponse } from "next/server";
import { markMissedAppointments } from "@/lib/appointment-automation";
import { getCurrentUser } from "@/lib/auth";
import { canForUser } from "@/lib/permissions";

export async function POST() {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "agenda:access")) return NextResponse.json({ message: "Seu cargo não tem acesso à agenda." }, { status: 403 });

  const missed = await markMissedAppointments(user.clinicId);
  return NextResponse.json({ updated: missed.map((item) => ({ ...item, status: "Faltou" })) });
}
