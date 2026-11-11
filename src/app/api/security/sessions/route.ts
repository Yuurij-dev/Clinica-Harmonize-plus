import { NextResponse } from "next/server";
import { revokeUserSessions } from "@/lib/auth-session";
import { noStore, requireSecurityUser } from "@/lib/security-api";

// Encerra todas as OUTRAS sessões do próprio usuário (a atual continua).
export async function DELETE(request: Request) {
  const { user, error } = await requireSecurityUser(request, { mutation: true });
  if (error) return error;
  const revoked = await revokeUserSessions(user.id, { exceptSid: user.sessionId, request, reason: "encerradas pelo usuário" });
  return NextResponse.json({ success: true, revoked }, { headers: noStore });
}
