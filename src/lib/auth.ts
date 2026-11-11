import { jwtVerify, SignJWT } from "jose";
import { cookies, headers } from "next/headers";
import { parseBearerToken } from "./bearer-rules";
import { getAuthSecret } from "./auth-secret";
import { prisma } from "./prisma";
import { pickMembership } from "./active-clinic-rules";
import { mfaRequiredForMemberships } from "./mfa-rules";
import { canForUser, normalizeRolePermissionMatrix, type Permission, type RolePermissionMatrix } from "./permissions";

export const sessionCookieName = "harmonize_session";
// Cache em memória por instância (chave userId:sid) com o estado da sessão. Revogar na mesma instância limpa na hora (invalidateUserAuthCache);
// em OUTRAS instâncias uma sessão revogada ainda vale por até 15s (janela documentada do cache).
const authCacheTtl = 15_000;
const authCacheMaxEntries = 5000;
// lastSeenAt da sessão só é regravado se estiver mais velho que isto (evita escrita a cada request).
const lastSeenRefreshMs = 5 * 60_000;

type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "PROFESSIONAL" | "STAFF";
  isOwner: boolean;
  clinicId: string;
  trialExpired: boolean;
  rolePermissions: RolePermissionMatrix;
  clinic: { id: string; name: string; slug: string; trialEndsAt: Date | null };
  /** id da AuthSession (claim sid); não expor ao cliente. */
  sessionId: string;
  /** Exige 2FA e ainda não ativou: só rotas com allowMfaSetup enxergam este usuário. */
  mfaSetupRequired: boolean;
};

type CurrentUserOptions = {
  requireActiveTrial?: boolean;
  allowMfaSetup?: boolean;
};

const globalAuthCache = globalThis as typeof globalThis & {
  harmonizeAuthCache?: Map<string, { expiresAt: number; value?: AuthenticatedUser | null; pending?: Promise<AuthenticatedUser | null> }>;
};
const authCache = globalAuthCache.harmonizeAuthCache ?? new Map();
if (!globalAuthCache.harmonizeAuthCache) globalAuthCache.harmonizeAuthCache = authCache;

// Ao inserir: remove expiradas e, se ainda passar do limite, as mais antigas (Map preserva a ordem de inserção).
function sweepAuthCache() {
  const now = Date.now();
  for (const [key, entry] of authCache) if (entry.expiresAt <= now) authCache.delete(key);
  let excess = authCache.size - authCacheMaxEntries + 1;
  for (const key of authCache.keys()) {
    if (excess-- <= 0) break;
    authCache.delete(key);
  }
}

// JWT de sessão: sempre com sid (AuthSession), por isso revogável. O vencimento do JWT acompanha AuthSession.expiresAt.
export async function signSessionToken(userId: string, sid: string, expiresAt: Date) {
  return new SignJWT({ userId, sid })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(getAuthSecret());
}

export async function createPasswordChangeSession(userId: string) {
  return new SignJWT({ userId, passwordChangeOnly: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(getAuthSecret());
}

/** Limpa o cache de todas as sessões (sids) do usuário nesta instância. */
export function invalidateUserAuthCache(userId: string) {
  const prefix = `${userId}:`;
  for (const key of [...authCache.keys()]) if (key.startsWith(prefix)) authCache.delete(key);
}

export function invalidateAllUserAuthCache() {
  authCache.clear();
}

export function userCan(user: AuthenticatedUser, permission: Permission) {
  return canForUser(user, permission);
}

// userId+sid de um JWT válido; passwordChangeOnly e mfaPending nunca valem como sessão; JWT sem sid é rejeitado.
async function verifiedSession(token: string | null | undefined) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getAuthSecret());
    if (typeof payload.userId !== "string" || typeof payload.sid !== "string" || !payload.sid) return null;
    if (payload.passwordChangeOnly === true || payload.mfaPending === true) return null;
    return { userId: payload.userId, sid: payload.sid };
  } catch {
    return null;
  }
}

async function loadAuthenticatedUser(userId: string, sid: string): Promise<AuthenticatedUser | null> {
  const [session, user] = await Promise.all([
    prisma.authSession.findUnique({ where: { id: sid }, select: { userId: true, expiresAt: true, revokedAt: true, lastSeenAt: true } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        activeClinicId: true,
        mfaSetting: { select: { enabledAt: true } },
        memberships: {
          orderBy: { id: "asc" },
          select: { role: true, isOwner: true, clinic: { select: { id: true, name: true, slug: true, trialEndsAt: true, rolePermissions: true } } },
        },
      },
    }),
  ]);
  if (!session || session.userId !== userId || session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;
  const membership = user ? pickMembership(user.memberships, user.activeClinicId) : undefined;
  if (!user || !membership) return null;
  if (Date.now() - session.lastSeenAt.getTime() > lastSeenRefreshMs) {
    void prisma.authSession.updateMany({ where: { id: sid, revokedAt: null }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: membership.role,
    isOwner: membership.isOwner,
    clinicId: membership.clinic.id,
    trialExpired: Boolean(membership.clinic.trialEndsAt && membership.clinic.trialEndsAt.getTime() <= Date.now()),
    rolePermissions: normalizeRolePermissionMatrix(membership.clinic.rolePermissions),
    clinic: { id: membership.clinic.id, name: membership.clinic.name, slug: membership.clinic.slug, trialEndsAt: membership.clinic.trialEndsAt },
    sessionId: sid,
    mfaSetupRequired: mfaRequiredForMemberships(user.memberships) && !user.mfaSetting?.enabledAt,
  };
}

export async function getCurrentUser({ requireActiveTrial = false, allowMfaSetup = false }: CurrentUserOptions = {}) {
  // Web: cookie. App mobile: "Authorization: Bearer <jwt>" (mesmo JWT). Cookie válido tem prioridade; cookie inválido/expirado cai para o Bearer.
  const cookieToken = (await cookies()).get(sessionCookieName)?.value;
  const session = await verifiedSession(cookieToken) ?? await verifiedSession(parseBearerToken((await headers()).get("authorization")));
  if (!session) return null;
  const { userId, sid } = session;
  const cacheKey = `${userId}:${sid}`;
  const finish = (user: AuthenticatedUser | null) => {
    if (!user) return null;
    if (user.mfaSetupRequired && !allowMfaSetup) return null;
    return requireActiveTrial && user.trialExpired ? null : user;
  };

  const cached = authCache.get(cacheKey);
  if (cached?.expiresAt && cached.expiresAt > Date.now()) {
    return finish(cached.pending ? await cached.pending : cached.value ?? null);
  }

  const pending = loadAuthenticatedUser(userId, sid);
  const entry = { expiresAt: Date.now() + authCacheTtl, pending };
  sweepAuthCache();
  authCache.set(cacheKey, entry);
  let user: AuthenticatedUser | null;
  try {
    user = await pending;
  } catch (error) {
    // Falha momentânea do banco não pode virar 401 em cache por 15 s; deixa a rota responder 500.
    if (authCache.get(cacheKey) === entry) authCache.delete(cacheKey);
    throw error;
  }
  // Só grava o resultado se a entrada não foi invalidada (revogação) enquanto a consulta rodava.
  if (authCache.get(cacheKey) === entry) authCache.set(cacheKey, { expiresAt: Date.now() + authCacheTtl, value: user });
  return finish(user);
}

/** Claims (userId, sid) de um JWT de sessão válido, sem consultar o banco. Usado pelo logout para revogar mesmo se getCurrentUser devolver null. */
export const readSessionClaims = verifiedSession;
