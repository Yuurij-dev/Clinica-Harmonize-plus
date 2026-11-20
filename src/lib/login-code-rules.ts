// Regras do código de verificação por e-mail do LOGIN (2º fator padrão quando o TOTP não está ativo).
// Reaproveita as regras genéricas de janela/limites do cadastro (signup-verification-rules.ts); só o hash
// é específico daqui (rótulo de domínio distinto, amarrado ao userId em vez de e-mail).
import { createHmac, timingSafeEqual } from "node:crypto";
import { isValidCodeFormat } from "./signup-verification-rules.ts";

export {
  CODE_LENGTH,
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  MAX_SENDS,
  MAX_TOTAL_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  WINDOW_MS,
  INVALIDATED_AT,
  generateCode,
  normalizeCode,
  isValidCodeFormat,
  expiresAtFrom,
  isExpired,
  attemptsLeft,
  isLockedOut,
  cooldownRemainingSeconds,
  canSendAgain,
  isLocked,
  canSendCode,
  canGuess,
  isWindowExpired,
  windowEndsAt,
  windowCutoff,
  type PendingState,
} from "./signup-verification-rules.ts";

// Teste local: e-mail @teste.com usa sempre este código fixo, sem enviar e-mail de verdade. Fecha por padrão
// (fail-closed): exige NODE_ENV explicitamente development/test (nunca basta "não ser production", que deixaria
// passar um ambiente mal configurado, ex. staging sem NODE_ENV) E a flag ENABLE_DEV_TEST_LOGIN=1 (opt-in; sem
// ela, nenhum deploy liga isso por acidente mesmo rodando em modo development).
export const DEV_TEST_LOGIN_CODE = "000000";
const DEV_TEST_EMAIL_SUFFIX = "@teste.com";
const DEV_TEST_ALLOWED_NODE_ENVS = new Set(["development", "test"]);

export function isDevTestLoginEmail(email: string, env: { NODE_ENV?: string; ENABLE_DEV_TEST_LOGIN?: string } = process.env): boolean {
  return DEV_TEST_ALLOWED_NODE_ENVS.has(env.NODE_ENV ?? "") && env.ENABLE_DEV_TEST_LOGIN === "1" && email.trim().toLowerCase().endsWith(DEV_TEST_EMAIL_SUFFIX);
}

export function hashLoginCode(code: string, userId: string, secret: Uint8Array | string): string {
  return createHmac("sha256", secret).update(`login-verification:${userId}:${code}`).digest("hex");
}

// Comparacao em tempo constante entre o hash guardado e o calculado a partir do codigo informado.
export function loginCodeMatches(input: string, userId: string, storedHash: string, secret: Uint8Array | string): boolean {
  if (!isValidCodeFormat(input)) return false;
  const a = Buffer.from(hashLoginCode(input, userId, secret), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
