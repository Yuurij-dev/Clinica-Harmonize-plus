// Entrada de código do 2FA em um único campo (app mobile): 6 dígitos = TOTP; o resto = código de recuperação.
import { normalizeTotpCode } from "./totp.ts";

export function classifyMfaCode(raw: unknown): { code?: string; recoveryCode?: string } {
  if (typeof raw !== "string") return {};
  const trimmed = raw.trim().slice(0, 64);
  if (!trimmed) return {};
  return /^\d{6}$/.test(normalizeTotpCode(trimmed)) ? { code: trimmed } : { recoveryCode: trimmed };
}
