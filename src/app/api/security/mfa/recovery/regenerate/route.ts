import { NextResponse } from "next/server";
import { recordMfaOutcome, recordSecurityEvent, revokeUserTrustedDevices } from "@/lib/auth-session";
import { MFA_GENERIC_ERROR, MFA_LOCKED_ERROR, verifyMfaCode } from "@/lib/mfa-verify";
import { prisma } from "@/lib/prisma";
import { generateRecoveryCodes, hashRecoveryCode } from "@/lib/recovery-codes";
import { noStore, reauthenticate, requireSecurityUser, securityError } from "@/lib/security-api";

// Novos 10 códigos de recuperação (os antigos deixam de valer). Exige senha + código TOTP; revoga os dispositivos confiáveis.
export async function POST(request: Request) {
  const { user, error } = await requireSecurityUser(request, { mutation: true, allowMfaSetup: true });
  if (error) return error;
  const body = await request.json().catch(() => null) as { password?: unknown; code?: unknown } | null;

  const setting = await prisma.mfaSetting.findUnique({ where: { userId: user.id }, select: { enabledAt: true } });
  if (!setting?.enabledAt) return securityError("A verificação em duas etapas não está ativa.", 409);

  const denied = await reauthenticate(user, body?.password);
  if (denied) return denied;
  const verified = await verifyMfaCode(user.id, { code: body?.code });
  await recordMfaOutcome(user.id, request, verified);
  if (!verified.ok) return securityError(verified.locked ? MFA_LOCKED_ERROR : MFA_GENERIC_ERROR, verified.locked ? 429 : 400);

  const codes = generateRecoveryCodes();
  await prisma.$transaction([
    prisma.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
    prisma.mfaRecoveryCode.createMany({ data: codes.map((code) => ({ userId: user.id, codeHash: hashRecoveryCode(code)! })) }),
  ]);
  await recordSecurityEvent({ userId: user.id, type: "RECOVERY_CODES_REGENERATED", request });
  await revokeUserTrustedDevices(user.id, { request, reason: "códigos de recuperação regenerados" });
  return NextResponse.json({ recoveryCodes: codes }, { headers: noStore });
}
