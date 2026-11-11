// Criptografia e HMAC do 2FA. Chaves derivadas (HKDF-SHA256) de AUTH_SECRET por contexto. Nunca logar segredos.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { getAuthSecret } from "./auth-secret.ts";

export type MfaKeyContext = "mfa-secret" | "mfa-recovery" | "trusted-device";

const VERSION = "v1";

function deriveKey(context: MfaKeyContext): Buffer {
  return Buffer.from(hkdfSync("sha256", getAuthSecret(), Buffer.alloc(0), `harmonize:${context}`, 32));
}

/** AES-256-GCM. Formato `v1:iv:tag:ciphertext` (base64url). */
export function encryptMfaSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey("mfa-secret"), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(":");
}

/** Lanca erro generico se o formato, a versao, a chave ou a integridade falharem. */
export function decryptMfaSecret(payload: string): string {
  const [version, iv, tag, data, extra] = String(payload ?? "").split(":");
  if (version !== VERSION || !iv || !tag || !data || extra !== undefined) throw new Error("Segredo 2FA invalido.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveKey("mfa-secret"), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Segredo 2FA invalido.");
  }
}

/** HMAC-SHA256 em hex com a chave do contexto (codigos de recuperacao, tokens de dispositivo). */
export function hmacHex(context: Exclude<MfaKeyContext, "mfa-secret">, value: string): string {
  return createHmac("sha256", deriveKey(context)).update(value).digest("hex");
}
