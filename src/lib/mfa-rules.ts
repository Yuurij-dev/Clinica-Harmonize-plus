// Regras puras do 2FA: obrigatoriedade, bloqueio por tentativas e replay do TOTP. Sem Prisma.

export const MFA_MAX_FAILED_ATTEMPTS = 5;
export const MFA_LOCK_MS = 15 * 60 * 1000;
export const MFA_PENDING_TTL_SECONDS = 10 * 60;
/** Reautenticacao por sessao recente (contas so-Google, sem senha utilizavel). */
export const RECENT_AUTH_WINDOW_MS = 10 * 60 * 1000;

/** Exige 2FA quem e proprietario ou ADMIN em qualquer clinica. */
export function mfaRequiredForMemberships(
  memberships: ReadonlyArray<{ role: string; isOwner: boolean }>,
): boolean {
  return memberships.some((m) => m.isOwner === true || m.role === "ADMIN");
}

export function isMfaLocked(lockedUntil: Date | null | undefined, now: Date = new Date()): boolean {
  return !!lockedUntil && lockedUntil.getTime() > now.getTime();
}

/** Estado apos uma falha. Lock expirado conta como contador zerado. */
export function nextFailureState(
  state: { failedAttempts: number; lockedUntil: Date | null },
  now: Date = new Date(),
): { failedAttempts: number; lockedUntil: Date | null } {
  const expired = state.lockedUntil !== null && state.lockedUntil.getTime() <= now.getTime();
  const attempts = (expired ? 0 : state.failedAttempts) + 1;
  if (attempts >= MFA_MAX_FAILED_ATTEMPTS) {
    return { failedAttempts: 0, lockedUntil: new Date(now.getTime() + MFA_LOCK_MS) };
  }
  return { failedAttempts: attempts, lockedUntil: expired ? null : state.lockedUntil };
}

/** Replay: so aceita passo estritamente maior que o ultimo usado. */
export function isStepFresh(step: number, lastUsedStep: number | bigint | null | undefined): boolean {
  return lastUsedStep === null || lastUsedStep === undefined || BigInt(step) > BigInt(lastUsedStep);
}

export function isRecentAuth(sessionCreatedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - sessionCreatedAt.getTime() < RECENT_AUTH_WINDOW_MS;
}

/**
 * Conta nascida pelo Google (cadastro/convite): User e UserIdentity são criados na mesma transação e a senha é um hash
 * inutilizável (makeUnusablePasswordHash, indetectável pelo hash). Heurística sem migration: identidade criada em até 1 min do User.
 * Conta que vinculou o Google depois (identidade bem posterior) tem senha real e SEMPRE precisa digitá-la.
 */
export const GOOGLE_BORN_WINDOW_MS = 60_000;
export function isGoogleOnlyAccount(userCreatedAt: Date, identityCreatedAt: Date | null | undefined): boolean {
  if (!identityCreatedAt) return false;
  return Math.abs(identityCreatedAt.getTime() - userCreatedAt.getTime()) <= GOOGLE_BORN_WINDOW_MS;
}
