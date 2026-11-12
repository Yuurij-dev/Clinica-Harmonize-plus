import { compare, hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { invalidateUserAuthCache } from "@/lib/auth";
import { recordSecurityEvent, revokeUserSessions, revokeUserTrustedDevices } from "@/lib/auth-session";
import { registerPasswordFailure } from "@/lib/login";
import { isGoogleOnlyAccount } from "@/lib/mfa-rules";
import { validatePasswordChange } from "@/lib/own-profile-rules";
import { prisma } from "@/lib/prisma";
import { noStore, requireSecurityUser, securityError } from "@/lib/security-api";

// Troca de senha com a conta logada: exige a senha atual, derruba as OUTRAS sessões e dispositivos confiáveis e mantém esta sessão.
export async function POST(request: Request) {
  const { user, error } = await requireSecurityUser(request, { mutation: true });
  if (error) return error;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const input = validatePasswordChange(body);
  if (!input.ok) return securityError(input.message, 400, { field: input.field });

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true, lockedUntil: true, createdAt: true, identities: { where: { provider: "google" }, select: { createdAt: true }, take: 1 } },
  });
  if (!row) return securityError("Não autenticado.", 401);
  if (isGoogleOnlyAccount(row.createdAt, row.identities[0]?.createdAt)) return securityError("Sua conta entra com o Google e não tem senha para alterar.", 403, { code: "no_password" });
  if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) return securityError("Muitas tentativas. Tente novamente em alguns minutos.", 429);
  if (!await compare(input.currentPassword, row.passwordHash)) {
    await registerPasswordFailure(user.id); // mesmo contador (e bloqueio) do login
    return securityError("Senha atual incorreta.", 403, { code: "invalid_password" });
  }

  const passwordHash = await hash(input.newPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false, failedLogins: 0, lockedUntil: null } });
  invalidateUserAuthCache(user.id);
  // A senha já mudou: falha ao derrubar as outras sessões não pode virar 500 (o usuário acharia que não trocou). Avisa e segue.
  try {
    const sessionsEnded = await revokeUserSessions(user.id, { exceptSid: user.sessionId, request, reason: "troca de senha" });
    await revokeUserTrustedDevices(user.id, { request, reason: "troca de senha" });
    await recordSecurityEvent({ userId: user.id, type: "PASSWORD_CHANGED", request });
    return NextResponse.json({ success: true, sessionsEnded }, { headers: noStore });
  } catch (cause) {
    console.error("[me-password] revogação pós-troca falhou", (cause as { code?: unknown } | null)?.code);
    return NextResponse.json({ success: true, warning: "A senha foi alterada, mas não foi possível desconectar os outros dispositivos. Encerre as sessões em Segurança da conta." }, { headers: noStore });
  }
}
