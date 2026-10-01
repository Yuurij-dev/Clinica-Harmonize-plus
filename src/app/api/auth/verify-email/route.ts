import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createSession, sessionCookieName } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function hashVerificationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function redirectToLogin(request: Request, status: string) {
  return NextResponse.redirect(new URL(`/login?verification=${status}`, request.url));
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token")?.trim();
  if (!token) return redirectToLogin(request, "invalid");

  const user = await prisma.user.findUnique({
    where: { emailVerificationTokenHash: hashVerificationToken(token) },
    include: { memberships: { take: 1, include: { clinic: { select: { id: true, name: true, slug: true, trialEndsAt: true } } } } },
  });
  if (!user || !user.emailVerificationExpiresAt || user.emailVerificationExpiresAt.getTime() < Date.now()) {
    return redirectToLogin(request, "expired");
  }

  const membership = user.memberships[0];
  if (!membership) return redirectToLogin(request, "invalid");

  const verifiedUser = await prisma.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: new Date(), emailVerificationTokenHash: null, emailVerificationExpiresAt: null },
  });

  const tokenValue = await createSession(verifiedUser.id);
  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set({
    name: sessionCookieName,
    value: tokenValue,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return response;
}
