// Regras puras do dispositivo confiavel. O token vai so no cookie `harmonize_td`; no banco fica o hash.
import { createHash, randomBytes } from "node:crypto";

export const TRUSTED_DEVICE_COOKIE = "harmonize_td";
export const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const TRUSTED_DEVICE_TTL_SECONDS = TRUSTED_DEVICE_TTL_MS / 1000;

export function generateTrustedDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 em hex; o token ja tem 256 bits de entropia, HMAC nao acrescenta nada. */
export function hashTrustedDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function trustedDeviceExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + TRUSTED_DEVICE_TTL_MS);
}

type DeviceState = { userId: string; revokedAt: Date | null; expiresAt: Date };

/** Valido = do mesmo usuario, nao revogado e nao expirado. */
export function isTrustedDeviceValid(
  device: DeviceState | null | undefined,
  userId: string,
  now: Date = new Date(),
): boolean {
  if (!device || device.userId !== userId) return false;
  if (device.revokedAt) return false;
  return device.expiresAt.getTime() > now.getTime();
}
