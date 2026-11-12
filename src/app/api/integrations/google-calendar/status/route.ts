import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { loadCalendarStatus } from "@/lib/google-calendar-connection-service";
import { getCalendarConfig } from "@/lib/google-calendar-config";
import { prisma } from "@/lib/prisma";

const noStore = { "Cache-Control": "no-store" };

// Estado das conexões visíveis ao usuário da sessão (clínica e usuário vêm da sessão, nunca do cliente). Sem tokens.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401, headers: noStore });
  // STAFF não vê a integração (Configurações → Integrações exige settings:access).
  if (user.role === "STAFF") return NextResponse.json({ message: "Seu cargo não tem permissão para esta ação." }, { status: 403, headers: noStore });
  const status = await loadCalendarStatus(prisma, user, getCalendarConfig() !== null);
  return NextResponse.json(status, { headers: noStore });
}
