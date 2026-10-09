import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { prisma } from "./prisma";

export const sessionCookieName = "harmonize_session";
const authCacheTtl = 15_000;

type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "PROFESSIONAL" | "STAFF";
  isOwner: boolean;
  clinicId: string;
  trialExpired: boolean;
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

function getSecret() {
  return new TextEncoder().encode(process.env.AUTH_SECRET ?? "harmonize-local-development-secret");
}

export async function createSession(userId: string) {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
}

export async function createPasswordChangeSession(userId: string) {
  return new SignJWT({ userId, passwordChangeOnly: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(getSecret());
}

export function invalidateUserAuthCache(userId: string) {
  authCache.delete(userId);
}

export async function getCurrentUser({ requireActiveTrial = false }: CurrentUserOptions = {}) {
  const token = (await cookies()).get(sessionCookieName)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.userId !== "string") return null;
    if (payload.passwordChangeOnly === true) return null;
    const cached = authCache.get(payload.userId);
    if (cached?.expiresAt && cached.expiresAt > Date.now()) {
      const cachedUser = cached.pending ? await cached.pending : cached.value ?? null;
      return requireActiveTrial && cachedUser?.trialExpired ? null : cachedUser;
    }

    const pending = prisma.user.findUnique({
        where: { id: payload.userId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          memberships: {
            take: 1,
            select: { role: true, isOwner: true, clinic: { select: { id: true, name: true, slug: true, trialEndsAt: true } } },
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
        clinic: membership.clinic,
      };
    });
    authCache.set(payload.userId, { expiresAt: Date.now() + authCacheTtl, pending });
    const user = await pending;
    authCache.set(payload.userId, { expiresAt: Date.now() + authCacheTtl, value: user });
    return requireActiveTrial && user?.trialExpired ? null : user;
  } catch {
    return null;
  }
}
