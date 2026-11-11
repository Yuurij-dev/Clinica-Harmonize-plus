// Emissão central de sessão (cookie/Bearer), estágio MFA, revogação e registro de eventos de segurança.
// Todo ponto que abre sessão passa por aqui (completeLogin / issueSession). Nunca gravar senha, token ou códigos em eventos.
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { getAuthSecret } from "./auth-secret";
import { invalidateUserAuthCache, sessionCookieName, signSessionToken } from "./auth";
import { prisma } from "./prisma";
import { MFA_PENDING_TTL_SECONDS, mfaRequiredForMemberships } from "./mfa-rules";
import { clampEventDetail, type SecurityEventType } from "./security-events";
import {
  TRUSTED_DEVICE_COOKIE,
  TRUSTED_DEVICE_TTL_SECONDS,
  generateTrustedDeviceToken,
  hashTrustedDeviceToken,
  isTrustedDeviceValid,
  trustedDeviceExpiry,
} from "./trusted-device-rules";
import { deviceLabel } from "./user-agent";
import type { MfaVerifyResult } from "./mfa-verify";

export const mfaCookieName = "harmonize_mfa";
export const mfaCookiePath = "/api/auth";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
export const MOBILE_SESSION_TTL_SECONDS = 60 * 60 * 24 * 3;

const secure = () => process.env.NODE_ENV === "production";

export type ClientInfo = { ip: string | null; userAgent: string | null };

/**
 * IP (x-forwarded-for, depois x-real-ip) e user-agent, limitados em tamanho. Usa o PRIMEIRO valor de x-forwarded-for: na Vercel o
 * cabeçalho é sobrescrito pela borda (não vem do cliente); fora dela o IP é informativo (histórico), nunca usado para decisão de segurança.
 * Sem retenção definida para SecurityEvent por ora (pendência). IP completo só no banco; a API devolve mascarado.
 */
export function clientInfo(request: { headers: { get(name: string): string | null } } | null | undefined): ClientInfo {
  if (!request) return { ip: null, userAgent: null };
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = (forwarded || request.headers.get("x-real-ip")?.trim() || "").slice(0, 64) || null;
  const userAgent = request.headers.get("user-agent")?.slice(0, 300) || null;
  return { ip, userAgent };
}

/** Só INSERT. Falha ao registrar nunca derruba a requisição. */
export async function recordSecurityEvent(input: {
  userId: string | null;
  type: SecurityEventType;
  success?: boolean;
  request?: { headers: { get(name: string): string | null } } | null;
  detail?: string | null;
}) {
  const { ip, userAgent } = clientInfo(input.request);
  try {
    await prisma.securityEvent.create({
      data: { userId: input.userId, type: input.type, success: input.success ?? true, ip, userAgent, detail: clampEventDetail(input.detail) },
    });
  } catch (error) {
    console.error("[security-event]", input.type, (error as { code?: unknown } | null)?.code);
  }
}

export function sessionCookie(token: string, maxAge = SESSION_TTL_SECONDS) {
  return { name: sessionCookieName, value: token, httpOnly: true, sameSite: "lax", secure: secure(), maxAge, path: "/" } as const;
}

/** Cria a AuthSession e o JWT com sid. */
export async function issueSession(input: {
  userId: string;
  request?: { headers: { get(name: string): string | null } } | null;
  trustedDeviceId?: string | null;
  ttlSeconds?: number;
}) {
  const { ip, userAgent } = clientInfo(input.request);
  const now = Date.now();
  const expiresAt = new Date(now + (input.ttlSeconds ?? SESSION_TTL_SECONDS) * 1000);
  const session = await prisma.authSession.create({
    data: { userId: input.userId, expiresAt, userAgent, ip, trustedDeviceId: input.trustedDeviceId ?? null },
    select: { id: true },
  });
  // Faxina oportunista das linhas do próprio usuário: expiradas há +1 dia ou revogadas há +30 dias.
  void prisma.authSession.deleteMany({
    where: { userId: input.userId, OR: [{ expiresAt: { lt: new Date(now - 86_400_000) } }, { revokedAt: { lt: new Date(now - 30 * 86_400_000) } }] },
  }).catch(() => undefined);
  const token = await signSessionToken(input.userId, session.id, expiresAt);
  return { sid: session.id, token, expiresAt };
}

// Risco aceito: o token harmonize_mfa (10 min) não é invalidado se a senha mudar nesse intervalo (não há campo barato no schema sem migration).
// O bloqueio do 2FA (5 falhas/15 min) pode ser provocado por quem sabe a senha: decisão de produto aceita; não há limite por IP no repositório.
export async function createMfaPendingToken(userId: string, origin: "password" | "google") {
  return new SignJWT({ userId, mfaPending: true, origin })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MFA_PENDING_TTL_SECONDS}s`)
    .sign(getAuthSecret());
}

export async function verifyMfaPendingToken(token: string | null | undefined) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getAuthSecret());
    if (payload.mfaPending !== true || typeof payload.userId !== "string") return null;
    return { userId: payload.userId, origin: payload.origin === "google" ? "google" as const : "password" as const };
  } catch {
    return null;
  }
}

export function mfaPendingCookie(token: string) {
  return { name: mfaCookieName, value: token, httpOnly: true, sameSite: "lax", secure: secure(), maxAge: MFA_PENDING_TTL_SECONDS, path: mfaCookiePath } as const;
}

export function clearMfaPendingCookie(response: NextResponse) {
  response.cookies.set({ name: mfaCookieName, value: "", httpOnly: true, sameSite: "lax", secure: secure(), maxAge: 0, path: mfaCookiePath });
}

export function trustedDeviceCookie(token: string) {
  return { name: TRUSTED_DEVICE_COOKIE, value: token, httpOnly: true, sameSite: "lax", secure: secure(), maxAge: TRUSTED_DEVICE_TTL_SECONDS, path: "/" } as const;
}

/** 2FA do usuário: ativo? e obrigatório (owner/ADMIN em qualquer clínica)? */
export async function getMfaState(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mfaSetting: { select: { enabledAt: true } }, memberships: { select: { role: true, isOwner: true } } },
  });
  return { active: Boolean(user?.mfaSetting?.enabledAt), required: user ? mfaRequiredForMemberships(user.memberships) : false };
}

/** Dispositivo confiável válido (cookie harmonize_td) do MESMO usuário; atualiza lastUsedAt. */
async function findTrustedDeviceId(userId: string) {
  const token = (await cookies()).get(TRUSTED_DEVICE_COOKIE)?.value;
  if (!token || token.length > 200) return null;
  const device = await prisma.trustedDevice.findUnique({
    where: { tokenHash: hashTrustedDeviceToken(token) },
    select: { id: true, userId: true, revokedAt: true, expiresAt: true },
  });
  if (!device || !isTrustedDeviceValid(device, userId)) return null;
  await prisma.trustedDevice.update({ where: { id: device.id }, data: { lastUsedAt: new Date() } });
  return device.id;
}

export type CompletedLogin = {
  mfaRequired: boolean;
  /** Aplica cookies (sessão, ou harmonize_mfa) na resposta. */
  apply(response: NextResponse): void;
};

/**
 * Credenciais já validadas. Com 2FA ativo e sem dispositivo confiável válido NÃO cria sessão:
 * entrega o cookie harmonize_mfa (10 min). Senão cria AuthSession, cookie e evento LOGIN/LOGIN_GOOGLE.
 */
export async function completeLogin(input: {
  request: { headers: { get(name: string): string | null } };
  userId: string;
  origin: "password" | "google";
}): Promise<CompletedLogin> {
  const mfaActive = await prisma.mfaSetting.findFirst({ where: { userId: input.userId, enabledAt: { not: null } }, select: { id: true } });
  const trustedDeviceId = mfaActive ? await findTrustedDeviceId(input.userId) : null;
  if (mfaActive && !trustedDeviceId) {
    const token = await createMfaPendingToken(input.userId, input.origin);
    return { mfaRequired: true, apply: (response) => {
        // Sem sessão até o código: limpa também um cookie de sessão antigo/de troca de senha.
        response.cookies.set({ name: sessionCookieName, value: "", maxAge: 0, path: "/" });
        response.cookies.set(mfaPendingCookie(token));
      },
    };
  }
  const { token } = await issueSession({ userId: input.userId, request: input.request, trustedDeviceId });
  await recordSecurityEvent({
    userId: input.userId,
    type: input.origin === "google" ? "LOGIN_GOOGLE" : "LOGIN",
    request: input.request,
    detail: trustedDeviceId ? "Dispositivo confiável" : null,
  });
  return {
    mfaRequired: false,
    apply: (response) => {
      response.cookies.set(sessionCookie(token));
      clearMfaPendingCookie(response);
    },
  };
}

/** Cria o dispositivo confiável (cookie harmonize_td vai na resposta pelo chamador). */
export async function createTrustedDevice(userId: string, request: { headers: { get(name: string): string | null } }) {
  const token = generateTrustedDeviceToken();
  const { userAgent } = clientInfo(request);
  const device = await prisma.trustedDevice.create({
    data: { userId, tokenHash: hashTrustedDeviceToken(token), label: deviceLabel(userAgent), userAgent, expiresAt: trustedDeviceExpiry() },
    select: { id: true },
  });
  return { id: device.id, token };
}

/** Revoga sessões do usuário (todas, ou todas menos `exceptSid`). Limpa o cache de auth e registra SESSION_REVOKED. */
export async function revokeUserSessions(userId: string, opts: { exceptSid?: string | null; request?: { headers: { get(name: string): string | null } } | null; reason: string }) {
  const { count } = await prisma.authSession.updateMany({
    where: { userId, revokedAt: null, ...(opts.exceptSid ? { id: { not: opts.exceptSid } } : {}) },
    data: { revokedAt: new Date() },
  });
  invalidateUserAuthCache(userId);
  if (count > 0) await recordSecurityEvent({ userId, type: "SESSION_REVOKED", request: opts.request, detail: `${count} sessão(ões) encerrada(s): ${opts.reason}` });
  return count;
}

/** Revoga todos os dispositivos confiáveis ativos do usuário. */
export async function revokeUserTrustedDevices(userId: string, opts: { request?: { headers: { get(name: string): string | null } } | null; reason: string }) {
  const { count } = await prisma.trustedDevice.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (count > 0) await recordSecurityEvent({ userId, type: "TRUSTED_DEVICE_REMOVED", request: opts.request, detail: `${count} dispositivo(s) removido(s): ${opts.reason}` });
  return count;
}

/**
 * Registra o desfecho de uma verificação de código (nunca o código). Código de recuperação usado =
 * RECOVERY_CODE_USED + ACCOUNT_RECOVERY e revoga todos os dispositivos confiáveis. Tentativa bloqueada não grava evento.
 */
export async function recordMfaOutcome(userId: string, request: { headers: { get(name: string): string | null } }, result: MfaVerifyResult) {
  if (result.ok && result.method === "totp") {
    await recordSecurityEvent({ userId, type: "MFA_VERIFIED", request });
  } else if (result.ok) {
    await recordSecurityEvent({ userId, type: "RECOVERY_CODE_USED", request, detail: `Restantes: ${result.recoveryRemaining ?? 0}` });
    await recordSecurityEvent({ userId, type: "ACCOUNT_RECOVERY", request, detail: "Código de recuperação usado" });
    await revokeUserTrustedDevices(userId, { request, reason: "recuperação de conta" });
  } else if (!result.locked) {
    await recordSecurityEvent({ userId, type: "MFA_FAILED", success: false, request });
  }
}
