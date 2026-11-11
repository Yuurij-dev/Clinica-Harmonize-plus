import { NextResponse } from "next/server";
import { createPasswordChangeSession, sessionCookieName } from "@/lib/auth";
import { completeLogin, recordSecurityEvent } from "@/lib/auth-session";
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
  if (!result.ok) {
    // Só para usuário existente: evento para usuário inexistente não é gravado (não vaza enumeração).
    if (result.failedUserId) await recordSecurityEvent({ userId: result.failedUserId, type: "LOGIN_FAILED", success: false, request });
    return NextResponse.json({ message: result.message }, { status: result.status });
  }

  const { user } = result;
  if (user.mustChangePassword) {
    // Primeiro acesso: só a troca de senha vale; a sessão completa (e o 2FA, se houver) vêm depois dela.
    const response = NextResponse.json({ passwordChangeRequired: true, user: { id: user.id, name: user.name, email: user.email, role: result.role, clinic: result.clinic } });
    response.cookies.set({
      name: sessionCookieName,
      value: await createPasswordChangeSession(user.id),
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });
    return response;
  }

  const login = await completeLogin({ request, userId: user.id, origin: "password" });
  const response = login.mfaRequired
    ? NextResponse.json({ mfaRequired: true })
    : NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: result.role, clinic: result.clinic } });
  login.apply(response);
  return response;
}
