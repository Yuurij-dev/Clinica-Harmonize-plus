// Autorização das rotas de cron: `Authorization: Bearer ${CRON_SECRET}` (a Vercel envia assim), comparação em tempo constante.
// Sem CRON_SECRET configurado a rota fica fechada (503); sem credencial ou credencial errada = 401. Nunca logar o segredo.
import { createHash, timingSafeEqual } from "node:crypto";

export type CronAuth = "ok" | "unconfigured" | "unauthorized";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

export function checkCronAuth(authorization: string | null | undefined, secret: string | null | undefined): CronAuth {
  const expected = secret?.trim();
  if (!expected) return "unconfigured";
  const match = /^Bearer\s+(\S+)$/i.exec(authorization?.trim() ?? "");
  if (!match) return "unauthorized";
  // Comparar os hashes iguala o tamanho (timingSafeEqual exige) sem vazar o comprimento do segredo.
  return timingSafeEqual(digest(match[1]), digest(expected)) ? "ok" : "unauthorized";
}
