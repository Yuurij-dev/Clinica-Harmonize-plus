// TOTP (RFC 6238) sobre HOTP (RFC 4226): HMAC-SHA1, 6 digitos, passo de 30 s. Puro, sem rede nem banco.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW = 1;
export const TOTP_ISSUER = "Harmonize+";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Base32 invalido.");
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Segredo novo: 20 bytes aleatorios em base32 (32 caracteres). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** HOTP (RFC 4226) com o segredo ja decodificado. */
export function hotp(key: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function totpStep(nowMs: number, period = TOTP_PERIOD_SECONDS): number {
  return Math.floor(nowMs / 1000 / period);
}

/** Codigo TOTP de um passo. `secret` em base32. */
export function totpAtStep(secret: string, step: number, digits = TOTP_DIGITS): string {
  return hotp(base32Decode(secret), step, digits);
}

export function normalizeTotpCode(input: string): string {
  return input.replace(/[\s-]/g, "");
}

/**
 * Valida o codigo na janela +-1 passo. Devolve o passo aceito (para o controle de replay
 * `step > lastUsedStep`) ou null. Comparacao em tempo constante.
 */
export function verifyTotp(
  secret: string,
  code: string,
  now: number = Date.now(),
  window = TOTP_WINDOW,
  digits = TOTP_DIGITS,
): number | null {
  const normalized = normalizeTotpCode(String(code ?? ""));
  if (!new RegExp(`^\\d{${digits}}$`).test(normalized)) return null;
  let key: Buffer;
  try {
    key = base32Decode(secret);
  } catch {
    return null;
  }
  const current = totpStep(now);
  const given = Buffer.from(normalized);
  let accepted: number | null = null;
  // Percorre toda a janela sem sair cedo, para nao vazar em qual passo acertou.
  for (let offset = -window; offset <= window; offset++) {
    const step = current + offset;
    if (step < 0) continue;
    const expected = Buffer.from(hotp(key, step, digits));
    if (timingSafeEqual(given, expected) && accepted === null) accepted = step;
  }
  return accepted;
}

export function otpauthUri(secret: string, accountEmail: string, issuer = TOTP_ISSUER): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountEmail)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Chave para digitacao manual, em grupos de 4: "ABCD EFGH ...". */
export function formatSecretForManualEntry(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}
