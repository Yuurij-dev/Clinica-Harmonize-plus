import { NextResponse } from "next/server";
import { invalidateUserAuthCache } from "@/lib/auth";
import { getMfaState, recordMfaOutcome, recordSecurityEvent, revokeUserSessions } from "@/lib/auth-session";
import { MFA_GENERIC_ERROR, MFA_LOCKED_ERROR, verifyMfaCode } from "@/lib/mfa-verify";
import { prisma } from "@/lib/prisma";
import { noStore, reauthenticate, requireSecurityUser, securityError } from "@/lib/security-api";

// Desativa o 2FA com senha + código (TOTP ou recuperação). Qualquer papel pode desativar: o TOTP é sempre opcional;
// quem desativa volta a usar o código por e-mail como 2º fator do login.
export async function POST(request: Request) {
  const { user, error } = await requireSecurityUser(request, { mutation: true });
  if (error) return error;
  const body = await request.json().catch(() => null) as { password?: unknown; code?: unknown; recoveryCode?: unknown } | null;

  const state = await getMfaState(user.id);
  if (!state.active) return securityError("A verificação em duas etapas não está ativa.", 409);

  const denied = await reauthenticate(user, body?.password);
  if (denied) return denied;
  const verified = await verifyMfaCode(user.id, { code: body?.code, recoveryCode: body?.recoveryCode });
  await recordMfaOutcome(user.id, request, verified);
  if (!verified.ok) return securityError(verified.locked ? MFA_LOCKED_ERROR : MFA_GENERIC_ERROR, verified.locked ? 429 : 400);

  await prisma.$transaction([
    prisma.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
    prisma.trustedDevice.deleteMany({ where: { userId: user.id } }),
    prisma.mfaSetting.deleteMany({ where: { userId: user.id } }),
  ]);
  invalidateUserAuthCache(user.id);
  await recordSecurityEvent({ userId: user.id, type: "MFA_DISABLED", request });
  await revokeUserSessions(user.id, { exceptSid: user.sessionId, request, reason: "2FA desativado" });
  return NextResponse.json({ success: true }, { headers: noStore });
}
