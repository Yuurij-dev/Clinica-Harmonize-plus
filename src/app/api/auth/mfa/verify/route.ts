import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { pickMembership } from "@/lib/active-clinic-rules";
import {
  clearMfaPendingCookie,
  createTrustedDevice,
  issueSession,
  mfaCookieName,
  recordEmailCodeOutcome,
  recordMfaOutcome,
  recordSecurityEvent,
  sessionCookie,
  trustedDeviceCookie,
  verifyLoginEmailCode,
  verifyMfaPendingToken,
} from "@/lib/auth-session";
import { MFA_GENERIC_ERROR, MFA_LOCKED_ERROR, verifyMfaCode } from "@/lib/mfa-verify";
import { prisma } from "@/lib/prisma";

const noStore = { "Cache-Control": "no-store" };

// Sessão + usuário público + cookies (sessão, limpa o pendente, grava o dispositivo confiável se houver).
async function respondWithSession(userId: string, token: string, trusted: { id: string; token: string } | null, recoveryCodesRemaining?: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, activeClinicId: true, memberships: { orderBy: { id: "asc" }, select: { role: true, clinic: { select: { id: true, name: true, trialEndsAt: true } } } } },
  });
  const membership = user ? pickMembership(user.memberships, user.activeClinicId) : undefined;
  const response = NextResponse.json({
    ...(user && membership ? { user: { id: user.id, name: user.name, email: user.email, role: membership.role, clinic: membership.clinic } } : {}),
    ...(typeof recoveryCodesRemaining === "number" ? { recoveryCodesRemaining } : {}),
  }, { headers: noStore });
  response.cookies.set(sessionCookie(token));
  clearMfaPendingCookie(response);
  if (trusted) response.cookies.set(trustedDeviceCookie(trusted.token));
  return response;
}

// Segundo estágio do login: troca o cookie harmonize_mfa (10 min) + código (TOTP, recuperação ou e-mail) por uma
// sessão completa. O userId vem só do token assinado, nunca do corpo. SameSite=lax + cookie de path /api/auth já barram POST cross-site.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { code?: unknown; recoveryCode?: unknown; trustDevice?: unknown } | null;
  const pending = await verifyMfaPendingToken((await cookies()).get(mfaCookieName)?.value);
  if (!pending) {
    const response = NextResponse.json({ message: "A verificação expirou. Entre novamente.", code: "mfa_expired" }, { status: 401, headers: noStore });
    clearMfaPendingCookie(response);
    return response;
  }

  if (pending.method === "email") {
    const verified = await verifyLoginEmailCode(pending.userId, body?.code);
    await recordEmailCodeOutcome(pending.userId, request, verified);
    if (!verified.ok) {
      return NextResponse.json({ message: verified.locked ? MFA_LOCKED_ERROR : MFA_GENERIC_ERROR }, { status: verified.locked ? 429 : 401, headers: noStore });
    }
    // Dispositivo confiável: mesmo mecanismo do TOTP (sem "recuperação" no método por e-mail).
    const trusted = body?.trustDevice === true ? await createTrustedDevice(pending.userId, request) : null;
    if (trusted) await recordSecurityEvent({ userId: pending.userId, type: "TRUSTED_DEVICE_ADDED", request });
    const { token } = await issueSession({ userId: pending.userId, request, trustedDeviceId: trusted?.id ?? null });
    await recordSecurityEvent({ userId: pending.userId, type: pending.origin === "google" ? "LOGIN_GOOGLE" : "LOGIN", request, detail: "Com verificação em duas etapas (e-mail)" });
    return respondWithSession(pending.userId, token, trusted);
  }

  const verified = await verifyMfaCode(pending.userId, { code: body?.code, recoveryCode: body?.recoveryCode });
  await recordMfaOutcome(pending.userId, request, verified);
  if (!verified.ok) {
    return NextResponse.json({ message: verified.locked ? MFA_LOCKED_ERROR : MFA_GENERIC_ERROR }, { status: verified.locked ? 429 : 401, headers: noStore });
  }

  // Dispositivo confiável só com código TOTP (recuperação indica aparelho perdido).
  const trusted = body?.trustDevice === true && verified.method === "totp" ? await createTrustedDevice(pending.userId, request) : null;
  if (trusted) await recordSecurityEvent({ userId: pending.userId, type: "TRUSTED_DEVICE_ADDED", request });
  const { token } = await issueSession({ userId: pending.userId, request, trustedDeviceId: trusted?.id ?? null });
  await recordSecurityEvent({ userId: pending.userId, type: pending.origin === "google" ? "LOGIN_GOOGLE" : "LOGIN", request, detail: "Com verificação em duas etapas" });
  return respondWithSession(pending.userId, token, trusted, verified.method === "recovery" ? verified.recoveryRemaining ?? 0 : undefined);
}
