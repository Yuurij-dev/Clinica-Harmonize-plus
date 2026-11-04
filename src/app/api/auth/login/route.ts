import { NextResponse } from "next/server";
import { createPasswordChangeSession, createSession, sessionCookieName } from "@/lib/auth";
import { authenticateLogin, type LoginResult } from "@/lib/login";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { login?: string; password?: string } | null;
  let result: LoginResult;
  try {
    result = await authenticateLogin(body?.login, body?.password);
  } catch (error) {
    if (error instanceof Error && (error.message.includes("P1001") || error.message.includes("Can't reach database server"))) {
      return NextResponse.json({ message: "Não foi possível conectar ao banco de dados configurado. Verifique a conexão em DATABASE_URL." }, { status: 503 });
    }
    throw error;
  }
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
