import { jwtVerify, SignJWT } from "jose";
import { cookies, headers } from "next/headers";
import { parseBearerToken } from "./bearer-rules";
import { getAuthSecret } from "./auth-secret";
import { prisma } from "./prisma";
import { canForUser, normalizeRolePermissionMatrix, type Permission, type RolePermissionMatrix } from "./permissions";

export const sessionCookieName = "harmonize_session";
// shortcut: cache em memória por instância; quem sai da equipe ainda passa por até 15s; usar sessão no banco se exigirem revogação imediata.
const authCacheTtl = 15_000;

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
};

type CurrentUserOptions = {
  requireActiveTrial?: boolean;
};

const globalAuthCache = globalThis as typeof globalThis & {
  harmonizeAuthCache?: Map<string, { expiresAt: number; value?: AuthenticatedUser | null; pending?: Promise<AuthenticatedUser | null> }>;
};
const authCache = globalAuthCache.harmonizeAuthCache ?? new Map();
if (!globalAuthCache.harmonizeAuthCache) globalAuthCache.harmonizeAuthCache = authCache;

// ttl: a web usa 7d; o app mobile usa um token mais curto (3d). Não há revogação antes do vencimento (a mitigação é o TTL curto);
// invalidar tokens na troca de senha exigiria tokenVersion/passwordChangedAt no schema (backlog).
export async function createSession(userId: string, ttl = "7d") {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(getAuthSecret());
}

export async function createPasswordChangeSession(userId: string) {
  return new SignJWT({ userId, passwordChangeOnly: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(getAuthSecret());
}

export function invalidateUserAuthCache(userId: string) {
  authCache.delete(userId);
}

export function invalidateAllUserAuthCache() {
  authCache.clear();
}

export function userCan(user: AuthenticatedUser, permission: Permission) {
  return canForUser(user, permission);
}

// userId de um JWT válido; sessão de troca de senha (passwordChangeOnly) nunca vale, seja qual for a origem.
async function verifiedUserId(token: string | null | undefined) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getAuthSecret());
    if (typeof payload.userId !== "string" || payload.passwordChangeOnly === true) return null;
    return payload.userId;
  } catch {
    return null;
  }
}

export async function getCurrentUser({ requireActiveTrial = false }: CurrentUserOptions = {}) {
  // Web: cookie. App mobile: "Authorization: Bearer <jwt>" (mesmo JWT). Cookie válido tem prioridade; cookie inválido/expirado cai para o Bearer.
  const cookieToken = (await cookies()).get(sessionCookieName)?.value;
  const userId = await verifiedUserId(cookieToken) ?? await verifiedUserId(parseBearerToken((await headers()).get("authorization")));
  if (!userId) return null;

  try {
    const cached = authCache.get(userId);
    if (cached?.expiresAt && cached.expiresAt > Date.now()) {
      const cachedUser = cached.pending ? await cached.pending : cached.value ?? null;
      return requireActiveTrial && cachedUser?.trialExpired ? null : cachedUser;
    }

    const pending = prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          memberships: {
            take: 1,
            orderBy: { id: "asc" },
            select: { role: true, isOwner: true, clinic: { select: { id: true, name: true, slug: true, trialEndsAt: true, rolePermissions: true } } },
          },
        },
      }).then((user): AuthenticatedUser | null => {
      const membership = user?.memberships[0];
      if (!user || !membership) return null;
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
      };
    });
    const entry = { expiresAt: Date.now() + authCacheTtl, pending };
    authCache.set(userId, entry);
    let user: AuthenticatedUser | null;
    try {
      user = await pending;
    } catch (error) {
      // Falha momentânea do banco não pode virar 401 em cache por 15 s.
      if (authCache.get(userId) === entry) authCache.delete(userId);
      throw error;
    }
    authCache.set(userId, { expiresAt: Date.now() + authCacheTtl, value: user });
    return requireActiveTrial && user?.trialExpired ? null : user;
  } catch {
    return null;
  }
}
