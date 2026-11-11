import { NextResponse } from "next/server";
import { invalidateUserAuthCache } from "@/lib/auth";
import { recordSecurityEvent, revokeUserSessions } from "@/lib/auth-session";
import { MFA_GENERIC_ERROR, MFA_LOCKED_ERROR, verifyMfaCode } from "@/lib/mfa-verify";
import { prisma } from "@/lib/prisma";
import { generateRecoveryCodes, hashRecoveryCode } from "@/lib/recovery-codes";
import { noStore, requireSecurityUser, securityError } from "@/lib/security-api";

// Passo 2: só um código TOTP válido ativa o 2FA. Gera 10 códigos de recuperação (mostrados UMA vez) e revoga as outras sessões.
export async function POST(request: Request) {
  const { user, error } = await requireSecurityUser(request, { mutation: true, allowMfaSetup: true });
  if (error) return error;
  const body = await request.json().catch(() => null) as { code?: unknown } | null;

  const setting = await prisma.mfaSetting.findUnique({ where: { userId: user.id }, select: { enabledAt: true } });
  if (!setting) return securityError("Inicie a configuração da verificação em duas etapas primeiro.", 409, { code: "setup_not_started" });
  if (setting.enabledAt) return securityError("A verificação em duas etapas já está ativa.", 409);

  const verified = await verifyMfaCode(user.id, { code: body?.code }, { allowPending: true });
  // Sem MFA_VERIFIED/MFA_FAILED aqui: só o contador/lock do banco e, no sucesso, MFA_ENABLED.
  if (!verified.ok) return securityError(verified.locked ? MFA_LOCKED_ERROR : MFA_GENERIC_ERROR, verified.locked ? 429 : 400);

  const codes = generateRecoveryCodes();
  const enabledAt = new Date();
  const activated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.mfaSetting.updateMany({ where: { userId: user.id, enabledAt: null }, data: { enabledAt } });
    if (count === 0) return false;
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
    await tx.mfaRecoveryCode.createMany({ data: codes.map((code) => ({ userId: user.id, codeHash: hashRecoveryCode(code)! })) });
    return true;
  });
  if (!activated) return securityError("A verificação em duas etapas já está ativa.", 409);

  invalidateUserAuthCache(user.id); // mfaSetupRequired muda agora
  await recordSecurityEvent({ userId: user.id, type: "MFA_ENABLED", request });
  await revokeUserSessions(user.id, { exceptSid: user.sessionId, request, reason: "2FA ativado" });
  return NextResponse.json({ enabledAt, recoveryCodes: codes }, { headers: noStore });
}
