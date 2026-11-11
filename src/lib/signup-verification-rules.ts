// Regras puras da verificacao de e-mail no cadastro com senha. Sem Prisma, sem rede.
// O codigo nunca e guardado: so o HMAC-SHA256 (chave = AUTH_SECRET + rotulo de dominio, amarrado ao e-mail).
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60 * 1000;
export const MAX_SENDS = 6; // 1 envio inicial + 5 reenvios por janela.
export const MAX_TOTAL_ATTEMPTS = 15; // palpites errados acumulados por janela (nao zeram a cada codigo).
export const WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_BODY_BYTES = 10 * 1024;
export const BCRYPT_MAX_PASSWORD_BYTES = 72;

type Env = Record<string, string | undefined>;

export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

// Mantem so digitos (aceita colar "123 456") e limita ao tamanho do codigo.
export function normalizeCode(input: unknown): string {
  return typeof input === "string" ? input.replace(/\D/g, "").slice(0, CODE_LENGTH) : "";
}

export const isValidCodeFormat = (code: string) => new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code);

export const isPlausibleEmail = (email: string) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export function hashCode(code: string, email: string, secret: Uint8Array | string): string {
  return createHmac("sha256", secret).update(`signup-verification:${email.trim().toLowerCase()}:${code}`).digest("hex");
}

// Comparacao em tempo constante entre o hash guardado e o calculado a partir do codigo informado.
export function codeMatches(input: string, email: string, storedHash: string, secret: Uint8Array | string): boolean {
  if (!isValidCodeFormat(input)) return false;
  const a = Buffer.from(hashCode(input, email, secret), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export const expiresAtFrom = (now: Date) => new Date(now.getTime() + CODE_TTL_MS);
export const isExpired = (expiresAt: Date, now: Date) => expiresAt.getTime() <= now.getTime();

export const attemptsLeft = (attempts: number) => Math.max(0, MAX_ATTEMPTS - attempts);
export const isLockedOut = (attempts: number) => attempts >= MAX_ATTEMPTS;

// Segundos que faltam para poder enviar de novo (0 = liberado).
export function cooldownRemainingSeconds(lastSentAt: Date, now: Date): number {
  const remaining = lastSentAt.getTime() + RESEND_COOLDOWN_MS - now.getTime();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

export const canSendAgain = (sends: number) => sends < MAX_SENDS;

export const passwordWithinBcryptLimit = (password: string) => Buffer.byteLength(password, "utf8") <= BCRYPT_MAX_PASSWORD_BYTES;

// Janela de 24 h por e-mail: os limites sobrevivem a expiracao do codigo; a linha so e apagada ao fim da janela.
export const windowEndsAt = (windowStartedAt: Date) => new Date(windowStartedAt.getTime() + WINDOW_MS);
export const isWindowExpired = (windowStartedAt: Date, now: Date) => windowEndsAt(windowStartedAt).getTime() <= now.getTime();
export const windowCutoff = (now: Date) => new Date(now.getTime() - WINDOW_MS);
export const isLocked = (lockedUntil: Date | null, now: Date) => lockedUntil !== null && lockedUntil.getTime() > now.getTime();

// Instante usado para invalidar um codigo (expiresAt no passado).
export const INVALIDATED_AT = new Date(0);

export type PendingState = { expiresAt: Date; lastSentAt: Date; sends: number; windowStartedAt: Date; lockedUntil: Date | null };

// Pode enviar um codigo (reenvio): janela ativa, sem bloqueio, fora do cooldown e abaixo do limite de envios.
export function canSendCode(p: PendingState, now: Date): boolean {
  return !isWindowExpired(p.windowStartedAt, now) && !isLocked(p.lockedUntil, now) && cooldownRemainingSeconds(p.lastSentAt, now) === 0 && canSendAgain(p.sends);
}

// Decisao do register diante do pendente do e-mail:
// create = sem pendente; restart = janela vencida (apagar e criar); overwrite = codigo expirado e pode reenviar;
// reject = bloqueado, codigo ainda valido (o dono pode estar com ele) ou cooldown/limite (nunca sobrescreve).
export type RegisterDecision = "create" | "restart" | "overwrite" | "reject";
export function registerDecision(p: PendingState | null, now: Date): RegisterDecision {
  if (!p) return "create";
  if (isWindowExpired(p.windowStartedAt, now)) return "restart";
  if (!isExpired(p.expiresAt, now)) return "reject";
  return canSendCode(p, now) ? "overwrite" : "reject";
}

// Pode-se tentar um palpite agora (so decide a tentativa; o servidor responde igual em qualquer negativa).
export function canGuess(p: { expiresAt: Date; attempts: number; totalAttempts: number; windowStartedAt: Date; lockedUntil: Date | null }, now: Date): boolean {
  return !isWindowExpired(p.windowStartedAt, now) && !isLocked(p.lockedUntil, now) && !isExpired(p.expiresAt, now) && p.attempts < MAX_ATTEMPTS && p.totalAttempts < MAX_TOTAL_ATTEMPTS;
}

export type SignupDeliveryMode = "verify" | "direct" | "unavailable";

// Com provedor de e-mail: verifica. Sem provedor: fora de producao cria direto (dev/e2e); em producao nao cria conta.
export function signupDeliveryMode(env: Env, providerReady: boolean): SignupDeliveryMode {
  if (providerReady) return "verify";
  return env.NODE_ENV === "production" ? "unavailable" : "direct";
}
