// Codigos de recuperacao do 2FA: `xxxxx-xxxxx`, alfabeto sem caracteres ambiguos, guardados so como HMAC.
import { randomInt } from "node:crypto";
import { hmacHex } from "./mfa-crypto.ts";

export const RECOVERY_CODE_COUNT = 10;
// Sem 0/o/1/i/l: 31 simbolos.
export const RECOVERY_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const GROUP = 5;

export function generateRecoveryCode(): string {
  let raw = "";
  for (let i = 0; i < GROUP * 2; i++) raw += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  return `${raw.slice(0, GROUP)}-${raw.slice(GROUP)}`;
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(generateRecoveryCode());
  return [...codes];
}

/** Minuscula, sem espacos/hifens e reinserindo o hifen. Devolve null se nao tiver o formato. */
export function normalizeRecoveryCode(input: string): string | null {
  const clean = String(input ?? "").toLowerCase().replace(/[\s-]/g, "");
  if (clean.length !== GROUP * 2) return null;
  for (const char of clean) if (!RECOVERY_ALPHABET.includes(char)) return null;
  return `${clean.slice(0, GROUP)}-${clean.slice(GROUP)}`;
}

/** HMAC do codigo normalizado (contexto `mfa-recovery`); null se a entrada for invalida. */
export function hashRecoveryCode(input: string): string | null {
  const normalized = normalizeRecoveryCode(input);
  return normalized ? hmacHex("mfa-recovery", normalized) : null;
}
