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
  clinic: { id: string; name: string; slug: string; trialEndsAt: Date | null };
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

export async function getCurrentUser() {
  const token = (await cookies()).get(sessionCookieName)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.userId !== "string") return null;
    const cached = authCache.get(payload.userId);
    if (cached?.expiresAt && cached.expiresAt > Date.now()) {
      return cached.pending ?? cached.value ?? null;
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
        clinic: membership.clinic,
      };
    });
    authCache.set(payload.userId, { expiresAt: Date.now() + authCacheTtl, pending });
    const user = await pending;
    authCache.set(payload.userId, { expiresAt: Date.now() + authCacheTtl, value: user });
    return user;
  } catch {
    return null;
  }
}
