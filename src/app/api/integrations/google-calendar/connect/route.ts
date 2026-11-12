import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAuthSecret } from "@/lib/auth-secret";
import { getCalendarConfig } from "@/lib/google-calendar-config";
import { centralOwnedByAnother } from "@/lib/google-calendar-connection-service";
import { CALENDAR_FLOW_COOKIE, startCalendarOAuth } from "@/lib/google-calendar-oauth-service";
import { GOOGLE_CALENDAR_FLOW_COOKIE_PATH, parseConnectionType } from "@/lib/google-calendar-rules";
import { prisma } from "@/lib/prisma";
import { isSameOrigin } from "@/lib/same-origin";

const noStore = { "Cache-Control": "no-store" };

// Inicia a conexão: devolve a URL de consentimento do Google e grava o cookie de fluxo (httpOnly, assinado, 10 min).
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ message: "Origem da requisição não permitida." }, { status: 403, headers: noStore });
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401, headers: noStore });
  const body = await request.json().catch(() => null) as { type?: unknown } | null;
  const type = parseConnectionType(body?.type);
  if (!type) return NextResponse.json({ message: "Tipo de conexão inválido." }, { status: 400, headers: noStore });

  const result = await startCalendarOAuth({ user, type, config: getCalendarConfig(), secret: getAuthSecret() });
  if (!result.ok) return NextResponse.json({ message: result.message, configured: result.status !== 503 }, { status: result.status, headers: noStore });
  if (type === "ADMIN" && await centralOwnedByAnother(prisma, user)) {
    return NextResponse.json({ message: "A clínica já tem uma agenda central conectada por outra pessoa. Desconecte-a antes de conectar outra." }, { status: 409, headers: noStore });
  }
  const response = NextResponse.json({ url: result.url }, { headers: noStore });
  response.cookies.set({ name: CALENDAR_FLOW_COOKIE, value: result.flowCookie.value, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: result.flowCookie.maxAge, path: GOOGLE_CALENDAR_FLOW_COOKIE_PATH });
  return response;
}
