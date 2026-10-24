import { NextResponse } from "next/server";
import { createPasswordChangeSession, createSession, sessionCookieName } from "@/lib/auth";
import { authenticateLogin } from "@/lib/login";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { login?: string; password?: string } | null;
  const result = await authenticateLogin(body?.login, body?.password);
  if (!result.ok) return NextResponse.json({ message: result.message }, { status: result.status });

  const { user } = result;
  const token = user.mustChangePassword
    ? await createPasswordChangeSession(user.id)
    : await createSession(user.id);
  const response = NextResponse.json({
    ...(user.mustChangePassword ? { passwordChangeRequired: true } : {}),
    user: { id: user.id, name: user.name, email: user.email, role: result.role, clinic: result.clinic },
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
