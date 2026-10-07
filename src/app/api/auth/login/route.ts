import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { createPasswordChangeSession, createSession, sessionCookieName } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
        include: { clinic: { select: { id: true, name: true, trialEndsAt: true } } },
      },
    },
  });
  if (!user || !(await compare(password, user.passwordHash))) {
    return NextResponse.json({ message: "Usuário ou senha inválidos." }, { status: 401 });
  }
  if (!user.emailVerifiedAt) {
    return NextResponse.json({ message: "Confirme seu e-mail antes de acessar o sistema." }, { status: 403 });
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
