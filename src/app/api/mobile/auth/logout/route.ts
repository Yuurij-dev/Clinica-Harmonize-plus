import { NextResponse } from "next/server";
import { invalidateUserAuthCache, readSessionClaims } from "@/lib/auth";
import { recordSecurityEvent } from "@/lib/auth-session";
import { parseBearerToken } from "@/lib/bearer-rules";
import { prisma } from "@/lib/prisma";

const noStore = { "Cache-Control": "no-store" };

/** Revoga exclusivamente a AuthSession indicada pelo Bearer nativo; cookies Web não participam deste fluxo. */
export async function POST(request: Request) {
  const token = parseBearerToken(request.headers.get("authorization"));
  const claims = token ? await readSessionClaims(token) : null;
  if (!claims) return NextResponse.json({ message: "Não autenticado." }, { status: 401, headers: noStore });

  const { count } = await prisma.authSession.updateMany({
    where: { id: claims.sid, userId: claims.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  invalidateUserAuthCache(claims.userId);
  if (count > 0) await recordSecurityEvent({ userId: claims.userId, type: "SESSION_REVOKED", request, detail: "Logout mobile" });

  return NextResponse.json({ success: true }, { headers: noStore });
}
