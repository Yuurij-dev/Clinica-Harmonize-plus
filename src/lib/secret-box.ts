// Cifra genérica de segredos (tokens OAuth) com AES-256-GCM e contexto autenticado (AAD). Sem Prisma, sem rede.
// Chave: GOOGLE_TOKEN_ENCRYPTION_KEY (32 bytes em hex ou base64) quando definida; senão HKDF de AUTH_SECRET.
// Nunca logar chave, texto claro nem payload cifrado.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export const SECRET_BOX_ENV_KEY = "GOOGLE_TOKEN_ENCRYPTION_KEY";
export const SECRET_BOX_FALLBACK_CONTEXT = "google-calendar-token";
const VERSION = "v1";

type Env = Record<string, string | undefined>;

/** Contexto = finalidade do segredo (ex.: "google-calendar-token"). Um payload só abre no contexto em que foi cifrado. */
export type SecretBoxContext = string;

function decodeConfiguredKey(raw: string): Buffer {
  const value = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
    const key = Buffer.from(value, "base64");
    if (key.length === 32) return key;
  }
  throw new Error(`${SECRET_BOX_ENV_KEY} inválida: use 32 bytes em hexadecimal (64 caracteres) ou base64.`);
}

/** Chave de 32 bytes. Lança se a env estiver definida mas inválida, ou se não houver nem env nem AUTH_SECRET (>= 32 bytes). */
export function resolveSecretBoxKey(env: Env = process.env): Buffer {
  const configured = env[SECRET_BOX_ENV_KEY];
  if (configured && configured.trim()) return decodeConfiguredKey(configured);
  const authSecret = Buffer.from(env.AUTH_SECRET ?? "", "utf8");
  if (authSecret.length < 32) throw new Error("AUTH_SECRET precisa ter pelo menos 32 bytes.");
  return Buffer.from(hkdfSync("sha256", authSecret, Buffer.alloc(0), `harmonize:${SECRET_BOX_FALLBACK_CONTEXT}`, 32));
}

/** true quando a chave dedicada está configurada (em produção deve estar). */
export function hasDedicatedSecretBoxKey(env: Env = process.env) {
  return Boolean(env[SECRET_BOX_ENV_KEY]?.trim());
}

/** Formato `v1:iv:tag:ciphertext` (base64url). */
export function encryptSecret(plain: string, context: SecretBoxContext, env: Env = process.env): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", resolveSecretBoxKey(env), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(":");
}

/** Erro genérico se formato, versão, contexto, chave ou integridade falharem. */
export function decryptSecret(payload: string, context: SecretBoxContext, env: Env = process.env): string {
  const [version, iv, tag, data, extra] = String(payload ?? "").split(":");
  if (version !== VERSION || !iv || !tag || !data || extra !== undefined) throw new Error("Segredo cifrado inválido.");
  const key = resolveSecretBoxKey(env);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Segredo cifrado inválido.");
  }
}

/** Atalhos para os tokens do Google Agenda. */
export const encryptGoogleToken = (plain: string, env: Env = process.env) => encryptSecret(plain, SECRET_BOX_FALLBACK_CONTEXT, env);
export const decryptGoogleToken = (payload: string, env: Env = process.env) => decryptSecret(payload, SECRET_BOX_FALLBACK_CONTEXT, env);
