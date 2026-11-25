// Recuperação de senha por e-mail: regras puras (token, limites, validação). Sem Prisma, sem Next.
// Fluxo completo em docs/recuperacao-de-senha.md.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { newPasswordError } from "./own-profile-rules.ts";

export const RESET_TOKEN_TTL_MS = 30 * 60_000;
export const RESET_MAX_BODY_BYTES = 4 * 1024;

export type RateRule = { scope: string; limit: number; windowMs: number };

// Valem para e-mail existente ou não, com resposta sempre neutra. São contados juntos: um pedido barrado não gasta nada.
// Teto apertado por par e-mail + IP (um terceiro não consome o de quem pede de outro IP)...
export const RESET_PAIR_LIMITS: RateRule[] = [
  { scope: "pair-cooldown", limit: 1, windowMs: 60_000 },
  { scope: "pair-hour", limit: 5, windowMs: 60 * 60_000 },
  { scope: "pair-day", limit: 10, windowMs: 24 * 60 * 60_000 },
];
// ...e um teto global por e-mail, mais folgado, só contra bombardeio da caixa de entrada por vários IPs.
export const RESET_EMAIL_LIMITS: RateRule[] = [
  { scope: "email-cooldown", limit: 1, windowMs: 60_000 },
  { scope: "email-day", limit: 30, windowMs: 24 * 60 * 60_000 },
];
// Por IP (estes respondem 429). Folgados porque uma clínica inteira costuma sair pelo mesmo IP.
export const RESET_REQUEST_IP_LIMIT: RateRule = { scope: "ip-request", limit: 20, windowMs: 60 * 60_000 };
export const RESET_TOKEN_IP_LIMIT: RateRule = { scope: "ip-token", limit: 30, windowMs: 15 * 60_000 };

export const RESET_INVALID_TOKEN_MESSAGE = "Este link é inválido, expirou ou já foi usado. Solicite um novo.";
export const RESET_CONFIRMATION_MESSAGE = "As senhas não coincidem.";
export const RESET_RATE_LIMITED_MESSAGE = "Muitas tentativas. Aguarde alguns minutos e tente novamente.";

/** 32 bytes aleatórios em base64url (43 caracteres). Só o hash vai ao banco. */
export const generateResetToken = () => randomBytes(32).toString("base64url");
export const hashResetToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const isResetTokenShape = (token: unknown): token is string => typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);

/** Chave da tabela de limites: HMAC, para nunca guardar e-mail ou IP em texto puro. */
export function resetRateKey(scope: string, value: string, secret: Uint8Array): string {
  return `${scope}:${createHmac("sha256", secret).update(`password-reset:${scope}:${value}`).digest("hex")}`;
}

export function normalizeResetEmail(raw: unknown): string | null {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function isResetTokenUsable(token: { expiresAt: Date; usedAt: Date | null; invalidatedAt: Date | null }, now: Date): boolean {
  return !token.usedAt && !token.invalidatedAt && token.expiresAt.getTime() > now.getTime();
}

export type ResetPasswordInput = { ok: true; password: string } | { ok: false; field: "password" | "confirmation"; message: string };

export function validateResetPassword(password: unknown, confirmation: unknown): ResetPasswordInput {
  const value = typeof password === "string" ? password : "";
  const error = newPasswordError(value);
  if (error) return { ok: false, field: "password", message: error };
  if (confirmation !== value) return { ok: false, field: "confirmation", message: RESET_CONFIRMATION_MESSAGE };
  return { ok: true, password: value };
}
