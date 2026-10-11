import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { createPasswordChangeSession, createSession, sessionCookieName } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const maxFailedLogins = 10;
const lockMinutes = 15;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { login?: string; password?: string } | null;
  const login = body?.login?.trim().toLowerCase();
  const password = body?.password ?? "";

  if (!login || !password) {
    return NextResponse.json({ message: "Informe usuário e senha." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email: login },
    include: {
      memberships: {
        take: 1,
        orderBy: { id: "asc" },
        include: { clinic: { select: { id: true, name: true, trialEndsAt: true } } },
      },
    },
  });
  if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    return NextResponse.json({ message: `Muitas tentativas erradas. Tente de novo em ${lockMinutes} minutos.` }, { status: 429 });
  }
  if (!user || !(await compare(password, user.passwordHash))) {
    if (user) {
      // Incremento atômico: tentativas simultâneas contam todas.
      const updated = await prisma.user.update({ where: { id: user.id }, data: { failedLogins: { increment: 1 } }, select: { failedLogins: true } });
      if (updated.failedLogins >= maxFailedLogins) {
        await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: new Date(Date.now() + lockMinutes * 60_000) } });
      }
    }
    return NextResponse.json({ message: "Usuário ou senha inválidos." }, { status: 401 });
  }
  if (user.failedLogins || user.lockedUntil) {
    await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  }
  const membership = user.memberships[0];
  if (!membership) {
    return NextResponse.json({ message: "Este usuário ainda não está vinculado a uma clínica." }, { status: 403 });
  }

  const token = user.mustChangePassword
    ? await createPasswordChangeSession(user.id)
    : await createSession(user.id);
  const response = NextResponse.json({
    ...(user.mustChangePassword ? { passwordChangeRequired: true } : {}),
    user: { id: user.id, name: user.name, email: user.email, role: membership.role, clinic: membership.clinic },
  });
  response.cookies.set({
    name: sessionCookieName,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return response;
}
