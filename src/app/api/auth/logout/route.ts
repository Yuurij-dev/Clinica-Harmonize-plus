import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { invalidateUserAuthCache, readSessionClaims, sessionCookieName } from "@/lib/auth";
import { clearMfaPendingCookie, recordSecurityEvent } from "@/lib/auth-session";
import { prisma } from "@/lib/prisma";
import { isSameOrigin } from "@/lib/same-origin";

// Funciona também com 2FA obrigatório pendente. Revoga a AuthSession do JWT (por sid) mesmo que getCurrentUser devolva null.
// Cross-site explícito (Sec-Fetch-Site/Origin divergente) = 403; sem esses cabeçalhos (cliente não-navegador) segue permitido.
export async function POST(request: Request) {
  const hasOriginSignal = Boolean(request.headers.get("sec-fetch-site") || request.headers.get("origin"));
  if (hasOriginSignal && !isSameOrigin(request)) return NextResponse.json({ message: "Origem da requisição não permitida." }, { status: 403 });

  const claims = await readSessionClaims((await cookies()).get(sessionCookieName)?.value);
  if (claims) {
    const { count } = await prisma.authSession.updateMany({ where: { id: claims.sid, userId: claims.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    invalidateUserAuthCache(claims.userId);
    if (count > 0) await recordSecurityEvent({ userId: claims.userId, type: "SESSION_REVOKED", request, detail: "Logout" });
  }
  const response = NextResponse.json({ success: true });
  response.cookies.set({ name: sessionCookieName, value: "", maxAge: 0, path: "/" });
  clearMfaPendingCookie(response);
  return response;
}
