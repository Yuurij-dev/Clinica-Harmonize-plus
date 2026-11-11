import { NextResponse } from "next/server";
import { getAuthSecret } from "@/lib/auth-secret";
import { isEmailDeliveryReady, sendSignupCodeEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { readLimitedJson } from "@/lib/signup-account";
import { CODE_TTL_MS, MAX_BODY_BYTES, canSendCode, expiresAtFrom, generateCode, hashCode } from "@/lib/signup-verification-rules";

// Reenvio do codigo. A resposta e SEMPRE `{ ok: true }` 200 (pendente ou nao, bloqueado, em cooldown, no limite
// de envios ou ate falha do provedor), para nao revelar se ha cadastro pendente e nao servir de oraculo.
// Nao altera passwordHash/profile. O limite real (1 envio/60 s, 6 envios por janela de 24 h) vale em silencio.
export async function POST(request: Request) {
  const neutral = () => NextResponse.json({ ok: true });
  const read = await readLimitedJson(request, MAX_BODY_BYTES);
  if (read.tooLarge) return NextResponse.json({ message: "Requisição grande demais." }, { status: 413 });
  const body = read.body as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !isEmailDeliveryReady()) return neutral();

  try {
    const now = new Date();
    const pending = await prisma.pendingSignup.findUnique({
      where: { email },
      select: { id: true, expiresAt: true, lastSentAt: true, sends: true, windowStartedAt: true, lockedUntil: true, profile: true },
    });
    if (!pending || !canSendCode(pending, now)) return neutral();

    const code = generateCode();
    const codeHash = hashCode(code, email, getAuthSecret());
    // Reserva o envio de forma atomica: duas requisicoes paralelas enviam um e-mail so.
    const reserved = await prisma.pendingSignup.updateMany({
      where: { id: pending.id, lastSentAt: pending.lastSentAt, sends: pending.sends, lockedUntil: null },
      data: { codeHash, expiresAt: expiresAtFrom(now), attempts: 0, lastSentAt: now, sends: { increment: 1 } },
    });
    if (reserved.count === 0) return neutral();

    const name = (pending.profile as { name?: unknown } | null)?.name;
    await sendSignupCodeEmail({ to: email, code, name: typeof name === "string" ? name : "", ttlMinutes: CODE_TTL_MS / 60_000 });
    return neutral();
  } catch (error) {
    console.error("[register-resend]", (error as { code?: unknown } | null)?.code);
    return neutral();
  }
}
