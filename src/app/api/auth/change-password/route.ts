import { compare, hash } from "bcryptjs";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { invalidateUserAuthCache, sessionCookieName } from "@/lib/auth";
import { completeLogin, recordSecurityEvent, revokeUserSessions, revokeUserTrustedDevices } from "@/lib/auth-session";
import { getAuthSecret } from "@/lib/auth-secret";
import { matchesPasswordFingerprint } from "@/lib/password-fingerprint";
import { invalidatePendingResetTokens } from "@/lib/password-reset-repo";
import { prisma } from "@/lib/prisma";
import { pickMembership } from "@/lib/active-clinic-rules";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { password?: string } | null;
  const password = body?.password ?? "";
  if (password.length < 8) {
    return NextResponse.json({ message: "A nova senha deve ter pelo menos 8 caracteres." }, { status: 400 });
  }

  const token = (await cookies()).get(sessionCookieName)?.value;
  if (!token) return NextResponse.json({ message: "Sessão de primeiro acesso inválida. Entre novamente." }, { status: 401 });

  let userId: string;
  let fingerprint: unknown;
  const authSecret = getAuthSecret();
  try {
    const { payload } = await jwtVerify(token, authSecret);
    if (payload.passwordChangeOnly !== true || typeof payload.userId !== "string") {
      return NextResponse.json({ message: "Esta sessão não permite alterar a senha." }, { status: 403 });
    }
    userId = payload.userId;
    fingerprint = payload.pv;
  } catch {
    return NextResponse.json({ message: "Sessão de primeiro acesso expirada. Entre novamente." }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true, mustChangePassword: true, activeClinicId: true, memberships: { orderBy: { id: "asc" }, select: { clinic: { select: { id: true, name: true } } } } },
  });
  // Senha mudou depois deste token (ex.: redefinição por e-mail): ele não troca mais nada.
  if (user && !matchesPasswordFingerprint(fingerprint, user.id, user.passwordHash, authSecret)) {
    return NextResponse.json({ message: "Sessão de primeiro acesso expirada. Entre novamente." }, { status: 401 });
  }
  const membership = user ? pickMembership(user.memberships, user.activeClinicId) : undefined;
  if (!user?.mustChangePassword || !membership) {
    return NextResponse.json({ message: "Não foi possível validar este acesso." }, { status: 403 });
  }
  if (await compare(password, user.passwordHash)) {
    return NextResponse.json({ message: "Escolha uma senha diferente da senha inicial." }, { status: 400 });
  }

  const passwordHash = await hash(password, 12);
  // Condicional ao hash lido: uma redefinição concluída no meio do caminho prevalece. Links de recuperação pendentes caem junto.
  const [updated] = await prisma.$transaction([
    prisma.user.updateMany({ where: { id: user.id, passwordHash: user.passwordHash, mustChangePassword: true }, data: { passwordHash, mustChangePassword: false } }),
    invalidatePendingResetTokens(prisma, user.id),
  ]);
  if (updated.count === 0) return NextResponse.json({ message: "Sessão de primeiro acesso expirada. Entre novamente." }, { status: 401 });
  invalidateUserAuthCache(user.id);

  // Troca de senha derruba todas as sessões e dispositivos confiáveis; a sessão nova (com 2FA, se houver) nasce depois.
  await revokeUserSessions(user.id, { request, reason: "troca de senha" });
  await revokeUserTrustedDevices(user.id, { request, reason: "troca de senha" });
  await recordSecurityEvent({ userId: user.id, type: "PASSWORD_CHANGED", request });

  const login = await completeLogin({ request, userId: user.id, origin: "password", passwordHash });
  if (!login.ok) return NextResponse.json({ message: login.message }, { status: login.status });
  const response = NextResponse.json({ success: true, clinicName: membership.clinic.name, ...(login.mfaRequired ? { mfaRequired: true, method: login.method } : {}) });
  login.apply(response);
  return response;
}
