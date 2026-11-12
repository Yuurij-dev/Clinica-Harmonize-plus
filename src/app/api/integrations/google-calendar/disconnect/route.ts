import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createCalendarClient, getCalendarConfig } from "@/lib/google-calendar-config";
import { disconnectCalendar } from "@/lib/google-calendar-connection-service";
import { prisma } from "@/lib/prisma";
import { isSameOrigin } from "@/lib/same-origin";

const noStore = { "Cache-Control": "no-store" };

// Desconecta a central (ADMIN) ou a individual PRÓPRIA (PROFESSIONAL). Eventos já criados no Google e os vínculos ficam como histórico.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ message: "Origem da requisição não permitida." }, { status: 403, headers: noStore });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401, headers: noStore });
  const body = await request.json().catch(() => null) as { type?: unknown } | null;
  const config = getCalendarConfig();
  // Sem credenciais o cliente só serve para a revogação (que falha em silêncio): a conexão local é desligada do mesmo jeito.
  const client = createCalendarClient(config ?? { clientId: "", clientSecret: "", redirectUri: "", appOrigin: null, fakeBase: null });
  const actor = { id: user.id, clinicId: user.clinicId, role: user.role, isOwner: user.isOwner, rolePermissions: user.rolePermissions };
  const result = await disconnectCalendar({ db: prisma, client, env: process.env }, { user: actor, type: body?.type });
  if (!result.ok) return NextResponse.json({ message: result.message }, { status: result.status, headers: noStore });
  return NextResponse.json({ ok: true }, { headers: noStore });
}
