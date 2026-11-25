// Impressão do hash de senha levada nos tokens pendentes (2FA e troca provisória): trocou a senha, o token deixa de valer.
// HMAC com o segredo do servidor, então o JWT (legível por quem o tem) não revela nada do hash.
import { createHmac } from "node:crypto";

export function passwordFingerprint(userId: string, passwordHash: string, secret: Uint8Array): string {
  return createHmac("sha256", secret).update(`password-fingerprint:${userId}:${passwordHash}`).digest("base64url");
}

/** `claim` vem de um JWT já verificado; ausente (token antigo) é recusado. */
export function matchesPasswordFingerprint(claim: unknown, userId: string, passwordHash: string, secret: Uint8Array): boolean {
  return claim === passwordFingerprint(userId, passwordHash, secret);
}
