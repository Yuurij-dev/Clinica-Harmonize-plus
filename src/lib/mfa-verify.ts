// Verificação de código 2FA (TOTP ou recuperação) com bloqueio e anti-replay atômicos no banco.
// Cada tentativa é RESERVADA antes de checar o código (UPDATE condicional), então requisições paralelas
// não furam o limite de 5 falhas por 15 min. Sucesso zera o contador; a 5ª falha trava por 15 min.
import { prisma } from "./prisma";
import { decryptMfaSecret } from "./mfa-crypto";
import { MFA_LOCK_MS, MFA_MAX_FAILED_ATTEMPTS } from "./mfa-rules";
import { hashRecoveryCode } from "./recovery-codes";
import { verifyTotp } from "./totp";

export const MFA_GENERIC_ERROR = "Código inválido ou expirado.";
export const MFA_LOCKED_ERROR = "Muitas tentativas. Tente novamente em alguns minutos.";

export type MfaVerifyResult =
  | { ok: true; method: "totp" | "recovery"; recoveryRemaining?: number }
  | { ok: false; locked: boolean };

const lockWindowMinutes = MFA_LOCK_MS / 60_000;

async function reserveAttempt(userId: string) {
  // Janela deslizante: sem tentativa há +15 min o contador recomeça em 1. Travado (lockedUntil futuro) ou
  // já com 5 tentativas em curso (e recente) → nenhuma linha atualizada.
  const affected = await prisma.$executeRaw`
    UPDATE "MfaSetting" SET
      "failedAttempts" = CASE WHEN "lockedUntil" IS NOT NULL OR "updatedAt" < now() - make_interval(mins => ${lockWindowMinutes}::int) THEN 1 ELSE "failedAttempts" + 1 END,
      "lockedUntil" = NULL,
      "updatedAt" = now()
    WHERE "userId" = ${userId}
      AND ("lockedUntil" IS NULL OR "lockedUntil" <= now())
      AND ("failedAttempts" < ${MFA_MAX_FAILED_ATTEMPTS} OR "updatedAt" < now() - make_interval(mins => ${lockWindowMinutes}::int))`;
  return affected > 0;
}

async function penalize(userId: string) {
  // Atômico: só trava quando as 5 tentativas reservadas já foram gastas.
  await prisma.$executeRaw`
    UPDATE "MfaSetting" SET "failedAttempts" = 0, "lockedUntil" = now() + make_interval(mins => ${lockWindowMinutes}::int), "updatedAt" = now()
    WHERE "userId" = ${userId} AND "failedAttempts" >= ${MFA_MAX_FAILED_ATTEMPTS}`;
}

/**
 * Confere `recoveryCode` (se enviado) ou `code`. `allowPending` aceita segredo ainda não ativado (confirmação do setup).
 * Nunca revela se o erro foi TOTP, recuperação ou replay; `locked` só indica bloqueio.
 */
export async function verifyMfaCode(
  userId: string,
  input: { code?: unknown; recoveryCode?: unknown },
  opts: { allowPending?: boolean } = {},
): Promise<MfaVerifyResult> {
  const setting = await prisma.mfaSetting.findUnique({ where: { userId }, select: { secretEnc: true, enabledAt: true } });
  if (!setting || (!setting.enabledAt && !opts.allowPending)) return { ok: false, locked: false };
  if (!(await reserveAttempt(userId))) return { ok: false, locked: true };

  const recovery = typeof input.recoveryCode === "string" && input.recoveryCode.trim() ? input.recoveryCode : null;
  let result: MfaVerifyResult = { ok: false, locked: false };

  if (recovery) {
    const codeHash = opts.allowPending ? null : hashRecoveryCode(recovery);
    if (codeHash) {
      const { count } = await prisma.mfaRecoveryCode.updateMany({ where: { userId, codeHash, usedAt: null }, data: { usedAt: new Date() } });
      if (count === 1) {
        await prisma.mfaSetting.updateMany({ where: { userId }, data: { failedAttempts: 0, lockedUntil: null } });
        const recoveryRemaining = await prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } });
        result = { ok: true, method: "recovery", recoveryRemaining };
      }
    }
  } else if (typeof input.code === "string") {
    let step: number | null = null;
    try {
      step = verifyTotp(decryptMfaSecret(setting.secretEnc), input.code);
    } catch {
      step = null;
    }
    if (step !== null) {
      const now = new Date();
      // Replay: UPDATE condicional, só passa quem avançar lastUsedStep.
      const { count } = await prisma.mfaSetting.updateMany({
        where: { userId, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: BigInt(step) } }] },
        data: { lastUsedStep: BigInt(step), failedAttempts: 0, lockedUntil: null, updatedAt: now },
      });
      if (count === 1) result = { ok: true, method: "totp" };
    }
  }

  if (!result.ok) await penalize(userId);
  return result;
}

