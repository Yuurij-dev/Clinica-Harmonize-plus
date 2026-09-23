import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { prisma } from "./prisma";

export const sessionCookieName = "harmonize_session";

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
    return prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        memberships: {
          take: 1,
          include: { clinic: { select: { id: true, name: true, slug: true } } },
        },
      },
    }).then((user) => {
      const membership = user?.memberships[0];
      if (!user || !membership) return null;
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: membership.role,
        clinicId: membership.clinic.id,
        clinic: membership.clinic,
      };
    });
  } catch {
    return null;
  }
}
