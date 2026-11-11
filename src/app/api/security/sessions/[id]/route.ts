import { NextResponse } from "next/server";
import { invalidateUserAuthCache, sessionCookieName } from "@/lib/auth";
import { recordSecurityEvent } from "@/lib/auth-session";
import { prisma } from "@/lib/prisma";
import { noStore, requireSecurityUser, securityError } from "@/lib/security-api";

// Encerra uma sessão do próprio usuário. Id de outro usuário (ou inexistente/já revogada) = 404. Encerrar a atual = logout.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireSecurityUser(request, { mutation: true });
  if (error) return error;
  const { id } = await params;

  // Id com byte nulo/gigante nunca existe: 404 sem tocar no banco (o Postgres rejeitaria o byte nulo com 500).
  if (id.includes(String.fromCharCode(0)) || id.length > 64) return NextResponse.json({ message: "Sessão não encontrada." }, { status: 404 });
  const session = await prisma.authSession.findFirst({ where: { id, userId: user.id, revokedAt: null }, select: { id: true } });
  if (!session) return securityError("Sessão não encontrada.", 404);
  const { count } = await prisma.authSession.updateMany({ where: { id: session.id, userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  invalidateUserAuthCache(user.id);
  if (count > 0) await recordSecurityEvent({ userId: user.id, type: "SESSION_REVOKED", request, detail: session.id === user.sessionId ? "Logout pela tela de segurança" : "Sessão encerrada" });

  const loggedOut = session.id === user.sessionId;
  const response = NextResponse.json({ success: true, loggedOut }, { headers: noStore });
  if (loggedOut) response.cookies.set({ name: sessionCookieName, value: "", maxAge: 0, path: "/" });
  return response;
}
