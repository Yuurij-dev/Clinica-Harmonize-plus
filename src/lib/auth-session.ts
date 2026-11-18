// Emissão central de sessão (cookie/Bearer), estágio MFA, revogação e registro de eventos de segurança.
// Todo ponto que abre sessão passa por aqui (completeLogin / issueSession). Nunca gravar senha, token ou códigos em eventos.
import { Prisma } from "@prisma/client";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { getAuthSecret } from "./auth-secret";
import { invalidateUserAuthCache, sessionCookieName, signSessionToken } from "./auth";
import { prisma } from "./prisma";
import { sendLoginCodeEmail } from "./email";
import { MFA_PENDING_TTL_SECONDS } from "./mfa-rules";
import {
  CODE_TTL_MS,
  INVALIDATED_AT,
  MAX_ATTEMPTS,
  MAX_TOTAL_ATTEMPTS,
  canGuess,
  canSendCode,
  expiresAtFrom,
  generateCode,
  hashLoginCode,
  isExpired,
  isLocked,
  isValidCodeFormat,
  isWindowExpired,
  loginCodeMatches,
  normalizeCode,
  windowCutoff,
  windowEndsAt,
} from "./login-code-rules";
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
export async function createMfaPendingToken(userId: string, origin: "password" | "google", method: "totp" | "email") {
  return new SignJWT({ userId, mfaPending: true, origin, method })
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
    return {
      userId: payload.userId,
      origin: payload.origin === "google" ? "google" as const : "password" as const,
      // Pendentes antigos (criados antes desta mudança) não têm `method`: tratados como TOTP, único método que existia.
      method: payload.method === "email" ? "email" as const : "totp" as const,
    };
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

/** 2FA (TOTP) do usuário: ativo? Sempre opcional, qualquer papel; quem não ativou usa o código por e-mail no login. */
export async function getMfaState(userId: string) {
  const setting = await prisma.mfaSetting.findUnique({ where: { userId }, select: { enabledAt: true } });
  return { active: Boolean(setting?.enabledAt) };
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

export type CompletedLogin =
  | { ok: true; mfaRequired: false; apply(response: NextResponse): void }
  | { ok: true; mfaRequired: true; method: "totp" | "email"; apply(response: NextResponse): void }
  /** E-mail do código de verificação não pôde ser enviado: nenhuma sessão nem pendente foi criado. */
  | { ok: false; status: number; message: string };

const pendingCookieApply = (token: string) => (response: NextResponse) => {
  // Sem sessão até o código: limpa também um cookie de sessão antigo/de troca de senha.
  response.cookies.set({ name: sessionCookieName, value: "", maxAge: 0, path: "/" });
  response.cookies.set(mfaPendingCookie(token));
};

/**
 * Gera e envia (por e-mail) o código de verificação do login para `userId`. Reaproveita um código ainda válido
 * sem reenviar e-mail (login resubmetido não deve consumir o limite de envios); fora disso segue os MESMOS
 * limites do cadastro (6 dígitos, TTL 10 min, cooldown de 60 s, 5 tentativas por código, 15 por janela de 24 h,
 * 6 envios por janela). Falha do provedor invalida o código recém-gerado (nunca deixa um código sem e-mail enviado).
 */
export async function sendLoginVerificationCode(userId: string, email: string): Promise<{ ok: true } | { ok: false }> {
  const now = new Date();
  await prisma.loginVerificationCode.deleteMany({ where: { userId, windowStartedAt: { lt: windowCutoff(now) } } });
  const pending = await prisma.loginVerificationCode.findUnique({
    where: { userId },
    select: { id: true, expiresAt: true, lastSentAt: true, sends: true, windowStartedAt: true, lockedUntil: true },
  });
  // Login resubmetido com um código ainda válido: reaproveita, sem reenviar e-mail nem gastar o limite de envios.
  if (pending && !isWindowExpired(pending.windowStartedAt, now) && !isExpired(pending.expiresAt, now)) return { ok: true };

  const secret = getAuthSecret();
  const code = generateCode();
  const data = { codeHash: hashLoginCode(code, userId, secret), expiresAt: expiresAtFrom(now), attempts: 0, lastSentAt: now };

  let id: string;
  if (!pending || isWindowExpired(pending.windowStartedAt, now)) {
    if (pending) await prisma.loginVerificationCode.deleteMany({ where: { id: pending.id, windowStartedAt: pending.windowStartedAt } });
    try {
      id = (await prisma.loginVerificationCode.create({ data: { userId, ...data, sends: 1, windowStartedAt: now }, select: { id: true } })).id;
    } catch (error) {
      // Corrida: outra requisição criou o pendente entre o find e o create.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { ok: false };
      throw error;
    }
  } else {
    if (!canSendCode(pending, now)) return { ok: false };
    // Sobrescrita atomica: so se nada mudou desde a leitura (mesmo bloqueio/lacuna de envio da pendencia lida).
    const updated = await prisma.loginVerificationCode.updateMany({
      where: { id: pending.id, lastSentAt: pending.lastSentAt, expiresAt: pending.expiresAt, lockedUntil: null, sends: pending.sends },
      data: { ...data, sends: { increment: 1 } },
    });
    if (updated.count === 0) return { ok: false };
    id = pending.id;
  }

  const sent = await sendLoginCodeEmail({ to: email, code, ttlMinutes: CODE_TTL_MS / 60_000 });
  if (!sent.sent) {
    // Mantem a linha e os contadores; so invalida o codigo que o usuario nunca recebeu.
    await prisma.loginVerificationCode.updateMany({ where: { id }, data: { codeHash: "", expiresAt: INVALIDATED_AT } });
    return { ok: false };
  }
  return { ok: true };
}

/**
 * Credenciais já validadas. Com dispositivo confiável válido entra direto (qualquer método de 2FA).
 * Senão, com TOTP ativo pede o código do aplicativo autenticador (cookie harmonize_mfa, método "totp").
 * Senão (TOTP nunca é obrigatório), envia um código por e-mail e pede ele (mesmo cookie, método "email").
 */
export async function completeLogin(input: {
  request: { headers: { get(name: string): string | null } };
  userId: string;
  origin: "password" | "google";
}): Promise<CompletedLogin> {
  const trustedDeviceId = await findTrustedDeviceId(input.userId);
  if (!trustedDeviceId) {
    const mfaActive = await prisma.mfaSetting.findFirst({ where: { userId: input.userId, enabledAt: { not: null } }, select: { id: true } });
    if (mfaActive) {
      const token = await createMfaPendingToken(input.userId, input.origin, "totp");
      return { ok: true, mfaRequired: true, method: "totp", apply: pendingCookieApply(token) };
    }
    const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { email: true } });
    if (!user) return { ok: false, status: 401, message: "Não foi possível entrar. Tente novamente." };
    const sent = await sendLoginVerificationCode(input.userId, user.email);
    if (!sent.ok) {
      return { ok: false, status: 502, message: "Não foi possível enviar o código de verificação agora. Tente novamente em instantes." };
    }
    const token = await createMfaPendingToken(input.userId, input.origin, "email");
    return { ok: true, mfaRequired: true, method: "email", apply: pendingCookieApply(token) };
  }

  const { token } = await issueSession({ userId: input.userId, request: input.request, trustedDeviceId });
  await recordSecurityEvent({
    userId: input.userId,
    type: input.origin === "google" ? "LOGIN_GOOGLE" : "LOGIN",
    request: input.request,
    detail: "Dispositivo confiável",
  });
  return {
    ok: true,
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

// Hash de mentira para a comparacao de custo igual quando nao ha pendente (mesmo truque de register/verify).
const DUMMY_LOGIN_CODE_HASH = "0".repeat(64);

export type EmailCodeVerifyResult = { ok: true } | { ok: false; locked: boolean };

/**
 * Confere o código por e-mail do 2º estágio do login. Mesma lógica atômica de reserva de tentativa/lock/
 * comparação em tempo constante que register/verify/route.ts usa para o PendingSignup, adaptada a userId.
 * Sucesso apaga a linha (código de uso único); nunca revela o motivo da negativa além de `locked`.
 */
export async function verifyLoginEmailCode(userId: string, code: unknown): Promise<EmailCodeVerifyResult> {
  const normalized = normalizeCode(code);
  if (!isValidCodeFormat(normalized)) return { ok: false, locked: false };

  const now = new Date();
  const secret = getAuthSecret();
  const pending = await prisma.loginVerificationCode.findUnique({ where: { userId } });
  const matches = loginCodeMatches(normalized, userId, pending?.codeHash || DUMMY_LOGIN_CODE_HASH, secret);
  if (!pending || !canGuess(pending, now)) return { ok: false, locked: Boolean(pending && isLocked(pending.lockedUntil, now)) };

  // Reserva o palpite de forma atomica (sem update que lanca): paralelismo nao burla os limites.
  const reserved = await prisma.loginVerificationCode.updateMany({
    where: { id: pending.id, lockedUntil: null, expiresAt: { gt: now }, attempts: { lt: MAX_ATTEMPTS }, totalAttempts: { lt: MAX_TOTAL_ATTEMPTS } },
    data: { attempts: { increment: 1 }, totalAttempts: { increment: 1 } },
  });
  if (reserved.count === 0) return { ok: false, locked: false };

  if (!matches) {
    const attempts = pending.attempts + 1;
    const totalAttempts = pending.totalAttempts + 1;
    if (totalAttempts >= MAX_TOTAL_ATTEMPTS) {
      // Bloqueia ate o fim da janela e inutiliza o codigo; a linha fica (os contadores sobrevivem).
      await prisma.loginVerificationCode.updateMany({ where: { id: pending.id }, data: { lockedUntil: windowEndsAt(pending.windowStartedAt), codeHash: "", expiresAt: INVALIDATED_AT } });
      return { ok: false, locked: true };
    }
    if (attempts >= MAX_ATTEMPTS) {
      await prisma.loginVerificationCode.updateMany({ where: { id: pending.id }, data: { codeHash: "", expiresAt: INVALIDATED_AT } });
    }
    return { ok: false, locked: false };
  }

  // Sucesso: codigo de uso unico, some depois de usado.
  await prisma.loginVerificationCode.deleteMany({ where: { id: pending.id } });
  return { ok: true };
}

/** Registra o desfecho da verificação por e-mail (nunca o código). Tentativa bloqueada não grava evento. */
export async function recordEmailCodeOutcome(userId: string, request: { headers: { get(name: string): string | null } }, result: EmailCodeVerifyResult) {
  if (result.ok) {
    await recordSecurityEvent({ userId, type: "EMAIL_CODE_VERIFIED", request });
  } else if (!result.locked) {
    await recordSecurityEvent({ userId, type: "EMAIL_CODE_FAILED", success: false, request });
  }
}
