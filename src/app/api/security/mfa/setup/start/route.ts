import { NextResponse } from "next/server";
import { encryptMfaSecret } from "@/lib/mfa-crypto";
import { prisma } from "@/lib/prisma";
import { qrSvg } from "@/lib/qr";
import { noStore, reauthenticate, requireSecurityUser, securityError } from "@/lib/security-api";
import { formatSecretForManualEntry, generateTotpSecret, otpauthUri } from "@/lib/totp";

const alreadyActive = "A verificação em duas etapas já está ativa.";

// Passo 1 da ativação: reautentica (senha; conta só-Google com sessão recente) e cria um segredo PENDENTE.
// O segredo só é devolvido aqui (QR + chave manual) e só ativa depois de setup/confirm com um código válido.
export async function POST(request: Request) {
  const { user, error } = await requireSecurityUser(request, { mutation: true, allowMfaSetup: true });
  if (error) return error;
  const body = await request.json().catch(() => null) as { password?: unknown } | null;
  const denied = await reauthenticate(user, body?.password, { freshSessionOk: user.mfaSetupRequired });
  if (denied) return denied;

  const existing = await prisma.mfaSetting.findUnique({ where: { userId: user.id }, select: { enabledAt: true } });
  if (existing?.enabledAt) return securityError(alreadyActive, 409);

  const secret = generateTotpSecret();
  const data = { secretEnc: encryptMfaSecret(secret), lastUsedStep: null, failedAttempts: 0, lockedUntil: null };
  if (existing) {
    // Condicional: se ativou no meio do caminho, não sobrescreve o segredo ativo.
    const { count } = await prisma.mfaSetting.updateMany({ where: { userId: user.id, enabledAt: null }, data });
    if (count === 0) return securityError(alreadyActive, 409);
  } else {
    try {
      await prisma.mfaSetting.create({ data: { userId: user.id, ...data } });
    } catch (e) {
      if ((e as { code?: string } | null)?.code === "P2002") return securityError(alreadyActive, 409);
      throw e;
    }
  }

  return NextResponse.json({
    qrSvg: await qrSvg(otpauthUri(secret, user.email)),
    manualKey: formatSecretForManualEntry(secret),
  }, { headers: noStore });
}
