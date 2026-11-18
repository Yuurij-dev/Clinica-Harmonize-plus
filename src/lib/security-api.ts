// Guardas das rotas /api/security/*: sessão do próprio usuário, same-origin em mutações e reautenticação.
import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { getCurrentUser } from "./auth";
import { registerPasswordFailure } from "./login";
import { isGoogleOnlyAccount, isRecentAuth } from "./mfa-rules";
import { prisma } from "./prisma";
import { isSameOrigin } from "./same-origin";

export const noStore = { "Cache-Control": "no-store" };

export function securityError(message: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ message, ...extra }, { status, headers: noStore });
}

type SecurityUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/**
 * Autentica (401) e, em mutações, exige same-origin (403).
 * O userId vem SEMPRE da sessão; nenhuma rota de segurança aceita userId do cliente.
 */
export async function requireSecurityUser(
  request: Request,
  opts: { mutation?: boolean } = {},
): Promise<{ user: SecurityUser; error?: undefined } | { user?: undefined; error: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) return { error: securityError("Não autenticado.", 401) };
  if (opts.mutation && !isSameOrigin(request)) return { error: securityError("Origem da requisição não permitida.", 403) };
  return { user };
}

/**
 * Reautenticação para operações sensíveis. Conta com senha real: a senha é SEMPRE exigida (errada = 403 invalid_password; ausente = 403 password_required).
 * Só conta nascida pelo Google (senha inutilizável, ver isGoogleOnlyAccount) pode usar sessão criada há menos de 10 min.
 */
export async function reauthenticate(user: { id: string; sessionId: string }, password: unknown): Promise<NextResponse | null> {
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true, lockedUntil: true, createdAt: true, identities: { where: { provider: "google" }, select: { createdAt: true }, take: 1 } },
  });
  if (!row) return securityError("Não autenticado.", 401);
  if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) return securityError("Muitas tentativas. Tente novamente em alguns minutos.", 429);
  if (isGoogleOnlyAccount(row.createdAt, row.identities[0]?.createdAt)) {
    const session = await prisma.authSession.findFirst({ where: { id: user.sessionId, userId: user.id }, select: { createdAt: true } });
    if (session && isRecentAuth(session.createdAt)) return null;
    return securityError("Entre novamente para confirmar sua identidade.", 403, { code: "reauth_required" });
  }
  if (typeof password !== "string" || !password) return securityError("Informe sua senha para continuar.", 403, { code: "password_required" });
  if (await compare(password, row.passwordHash)) return null;
  await registerPasswordFailure(user.id);
  return securityError("Senha incorreta.", 403, { code: "invalid_password" });
}
