// Ligação da recuperação de senha com o servidor (Prisma, ambiente) e a guarda comum das três rotas públicas.
import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { getAuthSecret } from "./auth-secret";
import { clientInfo } from "./auth-session";
import { withinResetLimit, type PasswordResetDeps } from "./password-reset-flow";
import { createPrismaPasswordResetRepo } from "./password-reset-repo";
import { RESET_MAX_BODY_BYTES, RESET_RATE_LIMITED_MESSAGE, type RateRule } from "./password-reset-rules";
import { prisma } from "./prisma";
import { isSameOrigin } from "./same-origin";
import { readLimitedJson } from "./signup-account";

export const resetHeaders = { "Cache-Control": "no-store" };

export function resetError(message: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ message, ...extra }, { status, headers: resetHeaders });
}

export function passwordResetDeps(): PasswordResetDeps {
  return {
    repo: createPrismaPasswordResetRepo(prisma),
    secret: getAuthSecret(),
    env: process.env,
    now: () => new Date(),
    hashPassword: (password) => hash(password, 12),
    logDevLink: (message) => console.info(message),
  };
}

/**
 * Cross-site explícito (Sec-Fetch-Site/Origin divergente) = 403, como no logout; limite por IP = 429; corpo limitado = 413.
 * O IP vem de clientInfo (confiável na Vercel; ver docs/recuperacao-de-senha.md). Sem IP, todos dividem o mesmo limite.
 */
export async function readResetRequest(request: Request, rule: RateRule, deps: PasswordResetDeps) {
  const hasOriginSignal = Boolean(request.headers.get("sec-fetch-site") || request.headers.get("origin"));
  if (hasOriginSignal && !isSameOrigin(request)) return { error: resetError("Origem da requisição não permitida.", 403) };
  const ip = clientInfo(request).ip ?? "unknown";
  if (!await withinResetLimit(deps, rule, ip)) {
    return { error: resetError(RESET_RATE_LIMITED_MESSAGE, 429, { code: "rate_limited" }) };
  }
  const read = await readLimitedJson(request, RESET_MAX_BODY_BYTES);
  if (read.tooLarge) return { error: resetError("Requisição grande demais.", 413) };
  return { body: read.body as Record<string, unknown> | null, ip };
}
