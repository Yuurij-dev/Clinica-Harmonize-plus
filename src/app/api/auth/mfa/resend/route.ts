import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthSecret } from "@/lib/auth-secret";
import { mfaCookieName, verifyMfaPendingToken } from "@/lib/auth-session";
import { sendLoginCodeEmail } from "@/lib/email";
import { CODE_TTL_MS, DEV_TEST_LOGIN_CODE, canSendCode, expiresAtFrom, generateCode, hashLoginCode, isDevTestLoginEmail } from "@/lib/login-code-rules";
import { prisma } from "@/lib/prisma";

const noStore = { "Cache-Control": "no-store" };
// Resposta UNICA para qualquer negativa (bloqueado, codigo ainda valido fora do cooldown, limite de envios,
// sem pendente ou pendente de outro metodo): nao serve de oraculo, mesmo padrao do GENERIC_429 do cadastro.
const neutral = () => NextResponse.json({ ok: true }, { headers: noStore });

// Reenvio do codigo por e-mail do 2o estagio do login. O userId vem SO do cookie harmonize_mfa assinado
// (nunca do corpo). So vale para pendente com method "email"; TOTP nao tem reenvio (o app gera o codigo).
// Limite real (1 envio/60s, 6 envios por janela de 24h) vale em silencio, como no reenvio do cadastro.
export async function POST(_request: Request) {
  const pending = await verifyMfaPendingToken((await cookies()).get(mfaCookieName)?.value);
  if (!pending || pending.method !== "email") return neutral();

  try {
    const now = new Date();
    const row = await prisma.loginVerificationCode.findUnique({
      where: { userId: pending.userId },
      select: { id: true, lastSentAt: true, sends: true, windowStartedAt: true, lockedUntil: true, expiresAt: true, attempts: true, totalAttempts: true },
    });
    if (!row || !canSendCode(row, now)) return neutral();

    const user = await prisma.user.findUnique({ where: { id: pending.userId }, select: { email: true } });
    if (!user) return neutral();

    const devTest = isDevTestLoginEmail(user.email);
    const code = devTest ? DEV_TEST_LOGIN_CODE : generateCode();
    const codeHash = hashLoginCode(code, pending.userId, getAuthSecret());
    // Reserva o envio de forma atomica: duas requisicoes paralelas enviam um e-mail so.
    const reserved = await prisma.loginVerificationCode.updateMany({
      where: { id: row.id, lastSentAt: row.lastSentAt, sends: row.sends, lockedUntil: null },
      data: { codeHash, expiresAt: expiresAtFrom(now), attempts: 0, lastSentAt: now, sends: { increment: 1 } },
    });
    if (reserved.count === 0) return neutral();

    // Teste local (@teste.com, nunca em produção): código fixo, sem enviar e-mail de verdade.
    if (!devTest) await sendLoginCodeEmail({ to: user.email, code, ttlMinutes: CODE_TTL_MS / 60_000 });
    return neutral();
  } catch (error) {
    console.error("[mfa-resend]", (error as { code?: unknown } | null)?.code);
    return neutral();
  }
}
