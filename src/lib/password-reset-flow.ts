// Orquestração da recuperação de senha com dependências injetadas (sem Next, sem Prisma, sem rede). O armazenamento está em
// password-reset-repo.ts. Nunca logar token, link ou e-mail; a única exceção é o modo de teste local (ver logDevLink).
import { isDevTestEmail } from "./dev-test-auth.ts";
import {
  buildLoginUrl,
  buildPasswordResetUrl,
  isEmailDeliveryReady,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendPasswordResetGoogleEmail,
} from "./email.ts";
import { isGoogleOnlyAccount } from "./mfa-rules.ts";
import {
  RESET_EMAIL_LIMITS,
  RESET_INVALID_TOKEN_MESSAGE,
  RESET_PAIR_LIMITS,
  RESET_TOKEN_TTL_MS,
  generateResetToken,
  hashResetToken,
  isResetTokenShape,
  isResetTokenUsable,
  resetRateKey,
  validateResetPassword,
  type RateRule,
} from "./password-reset-rules.ts";

export type ResetUser = { id: string; email: string; createdAt: Date; googleIdentityCreatedAt: Date | null };
export type ResetTokenRow = { id: string; expiresAt: Date; usedAt: Date | null; invalidatedAt: Date | null; user: ResetUser };

export type RateEntry = { key: string; limit: number; windowMs: number };

export type PasswordResetRepo = {
  /** Soma 1 (atômico) na janela da chave, abrindo outra se a anterior venceu. Devolve o total da janela. */
  hit(key: string, windowMs: number, now: Date): Promise<number>;
  /** Soma 1 em todas as chaves numa transação, só se nenhuma passar do limite; senão não conta nada e devolve false. */
  hitAll(entries: RateEntry[], now: Date): Promise<boolean>;
  cleanup(now: Date): Promise<void>;
  findUserByEmail(email: string): Promise<ResetUser | null>;
  /** Invalida os tokens pendentes do usuário e cria o novo, serializado por usuário. */
  createToken(input: { userId: string; tokenHash: string; expiresAt: Date; now: Date }): Promise<string>;
  invalidateToken(id: string, now: Date): Promise<void>;
  findToken(tokenHash: string): Promise<ResetTokenRow | null>;
  /** Consome o token e troca a senha numa transação só; null se o token deixou de valer. */
  consume(input: { tokenId: string; userId: string; passwordHash: string }): Promise<{ sessions: number; devices: number } | null>;
};

type Env = Record<string, string | undefined>;

export type PasswordResetDeps = {
  repo: PasswordResetRepo;
  secret: Uint8Array;
  env: Env;
  now: () => Date;
  fetchImpl?: typeof fetch;
  hashPassword: (password: string) => Promise<string>;
  /** Console do servidor, usado somente no modo de teste local (isDevTestEmail, nunca em produção). */
  logDevLink: (message: string) => void;
};

// Só códigos estáveis: a mensagem de um erro (Prisma, rede) pode carregar e-mail ou dados da consulta.
function logCode(error: unknown) {
  const code = typeof error === "string" ? error : (error as { code?: unknown } | null)?.code;
  console.warn("[password-reset]", typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : "unknown");
}

export async function withinResetLimit(deps: Pick<PasswordResetDeps, "repo" | "secret" | "now">, rule: RateRule, value: string): Promise<boolean> {
  return await deps.repo.hit(resetRateKey(rule.scope, value, deps.secret), rule.windowMs, deps.now()) <= rule.limit;
}

/** Limites do pedido: por par e-mail + IP e global por e-mail, contados de uma vez. */
export function allowResetRequest(email: string, ip: string, deps: Pick<PasswordResetDeps, "repo" | "secret" | "now">): Promise<boolean> {
  const entries = (rules: RateRule[], value: string) => rules.map((rule) => ({ key: resetRateKey(rule.scope, value, deps.secret), limit: rule.limit, windowMs: rule.windowMs }));
  // Ordem fixa das chaves: pedidos simultâneos as travam na mesma sequência.
  return deps.repo.hitAll([...entries(RESET_PAIR_LIMITS, `${email}\n${ip}`), ...entries(RESET_EMAIL_LIMITS, email)], deps.now());
}

const isGoogleOnly = (user: ResetUser) => isGoogleOnlyAccount(user.createdAt, user.googleIdentityCreatedAt);

/**
 * Trabalho da solicitação que depende da conta. Roda DEPOIS da resposta (after) para a existência do e-mail não aparecer no
 * tempo nem no corpo: nunca lança e não devolve nada. `email` já normalizado.
 */
export async function processPasswordResetRequest(email: string, ip: string, deps: PasswordResetDeps): Promise<void> {
  try {
    await deps.repo.cleanup(deps.now()).catch(logCode);
    if (!await allowResetRequest(email, ip, deps)) return;
    const user = await deps.repo.findUserByEmail(email);
    if (!user) return;
    // Exceção de teste local (@teste.com, NODE_ENV development/test e ENABLE_DEV_TEST_LOGIN=1): nada de e-mail real,
    // o link vai para o console do servidor. Em produção isDevTestEmail é sempre false.
    const devTest = isDevTestEmail(user.email, deps.env);

    if (isGoogleOnly(user)) {
      if (devTest) { deps.logDevLink("[password-reset] teste local: conta só-Google, nenhum link gerado."); return; }
      const sent = await sendPasswordResetGoogleEmail({ to: user.email, loginUrl: buildLoginUrl(deps.env) }, deps);
      if (!sent.sent) logCode(sent.reason);
      return;
    }

    const token = generateResetToken();
    const url = buildPasswordResetUrl(token, deps.env);
    // Sem como entregar o link, nenhum token é criado.
    if (!url || (!devTest && !isEmailDeliveryReady(deps.env))) { logCode("not_configured"); return; }
    const now = deps.now();
    const id = await deps.repo.createToken({ userId: user.id, tokenHash: hashResetToken(token), expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS), now });
    if (devTest) { deps.logDevLink(`[password-reset] teste local, link de redefinição: ${url}`); return; }
    const sent = await sendPasswordResetEmail({ to: user.email, url, ttlMinutes: RESET_TOKEN_TTL_MS / 60_000 }, deps);
    if (!sent.sent) {
      logCode(sent.reason);
      // O usuário não recebeu o link: o token não pode sobrar válido. No timeout o provedor pode ter entregue; ele expira sozinho.
      if (sent.reason !== "timeout") await deps.repo.invalidateToken(id, deps.now());
    }
  } catch (error) {
    logCode(error);
  }
}

async function usableToken(token: unknown, deps: PasswordResetDeps): Promise<ResetTokenRow | null> {
  if (!isResetTokenShape(token)) return null;
  const row = await deps.repo.findToken(hashResetToken(token));
  return row && isResetTokenUsable(row, deps.now()) && !isGoogleOnly(row.user) ? row : null;
}

export async function isValidResetToken(token: unknown, deps: PasswordResetDeps): Promise<boolean> {
  return Boolean(await usableToken(token, deps));
}

export type ConfirmResetResult =
  | { ok: true; userId: string; email: string; sessions: number; devices: number }
  | { ok: false; code: "invalid_token"; message: string }
  | { ok: false; code: "invalid_password"; field: "password" | "confirmation"; message: string };

const invalidToken: ConfirmResetResult = { ok: false, code: "invalid_token", message: RESET_INVALID_TOKEN_MESSAGE };

export async function confirmPasswordReset(
  input: { token?: unknown; password?: unknown; confirmation?: unknown } | null | undefined,
  deps: PasswordResetDeps,
): Promise<ConfirmResetResult> {
  const row = await usableToken(input?.token, deps);
  if (!row) return invalidToken;
  // Senha inválida não consome o token.
  const password = validateResetPassword(input?.password, input?.confirmation);
  if (!password.ok) return { ok: false, code: "invalid_password", field: password.field, message: password.message };
  const done = await deps.repo.consume({ tokenId: row.id, userId: row.user.id, passwordHash: await deps.hashPassword(password.password) });
  return done ? { ok: true, userId: row.user.id, email: row.user.email, ...done } : invalidToken;
}

/** Aviso de senha alterada. Falha no envio não desfaz a troca. */
export async function notifyPasswordChanged(email: string, deps: PasswordResetDeps): Promise<void> {
  try {
    if (isDevTestEmail(email, deps.env)) return;
    const sent = await sendPasswordChangedEmail({ to: email, loginUrl: buildLoginUrl(deps.env) }, deps);
    if (!sent.sent) logCode(sent.reason);
  } catch (error) {
    logCode(error);
  }
}
