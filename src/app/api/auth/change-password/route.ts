import { compare, hash } from "bcryptjs";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSession, invalidateUserAuthCache, sessionCookieName } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function getSecret() {
  return new TextEncoder().encode(process.env.AUTH_SECRET ?? "harmonize-local-development-secret");
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { password?: string } | null;
  const password = body?.password ?? "";
  if (password.length < 8) {
    return NextResponse.json({ message: "A nova senha deve ter pelo menos 8 caracteres." }, { status: 400 });
  }

  const token = (await cookies()).get(sessionCookieName)?.value;
  if (!token) return NextResponse.json({ message: "Sessão de primeiro acesso inválida. Entre novamente." }, { status: 401 });

  let userId: string;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.passwordChangeOnly !== true || typeof payload.userId !== "string") {
      return NextResponse.json({ message: "Esta sessão não permite alterar a senha." }, { status: 403 });
    }
    userId = payload.userId;
  } catch {
    return NextResponse.json({ message: "Sessão de primeiro acesso expirada. Entre novamente." }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true, mustChangePassword: true, memberships: { take: 1, select: { clinic: { select: { name: true } } } } },
  });
  if (!user?.mustChangePassword || !user.memberships[0]) {
    return NextResponse.json({ message: "Não foi possível validar este acesso." }, { status: 403 });
  }
  if (await compare(password, user.passwordHash)) {
    return NextResponse.json({ message: "Escolha uma senha diferente da senha inicial." }, { status: 400 });
  }

  const passwordHash = await hash(password, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } });
  invalidateUserAuthCache(user.id);

  const response = NextResponse.json({ success: true, clinicName: user.memberships[0].clinic.name });
  response.cookies.set({
    name: sessionCookieName,
    value: await createSession(user.id),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return response;
}
