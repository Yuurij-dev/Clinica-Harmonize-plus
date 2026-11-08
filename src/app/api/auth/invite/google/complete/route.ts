import { NextResponse } from "next/server";
import { createSession, sessionCookieName } from "@/lib/auth";
import { getAuthSecret } from "@/lib/auth-secret";
import { GOOGLE_PENDING_COOKIE, GOOGLE_PENDING_PATH, pendingGoogleForToken } from "@/lib/google-oauth-rules";
import { makeUnusablePasswordHash } from "@/lib/google-oauth-repo";
import { completeGoogleInvite } from "@/lib/invitations";
import { prismaInvitationRepo } from "@/lib/invitations-db";

const headers = { "Cache-Control": "no-store" };
const cookieBase = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: GOOGLE_PENDING_PATH } as const;
const restart = "Sua verificação com o Google expirou. Volte e toque em “Entrar com Google” novamente.";

// Publico, mas so funciona com o cookie assinado do callback do Google (identidade e convite ja validados).
// Cria User + UserIdentity + aceite na mesma transacao, com os dados pessoais do formulario.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const cookieHeader = request.headers.get("cookie") ?? "";
  const raw = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${GOOGLE_PENDING_COOKIE}=`))?.slice(GOOGLE_PENDING_COOKIE.length + 1) ?? null;
  // O convite da pagina tem de ser o do cookie (evita concluir um convite a partir da pagina de outro).
  const pending = await pendingGoogleForToken(raw, body?.token, getAuthSecret());
  if (!pending) {
    const response = NextResponse.json({ code: "pending_missing", message: restart }, { status: 400, headers });
    response.cookies.set({ ...cookieBase, name: GOOGLE_PENDING_COOKIE, value: "", maxAge: 0 });
    return response;
  }

  const result = await completeGoogleInvite(prismaInvitationRepo, { pending, profile: body, makePasswordHash: makeUnusablePasswordHash });
  // Dados invalidos: o cookie continua valido para a pessoa corrigir e reenviar.
  if (!result.ok && result.code === "invalid_profile") return NextResponse.json({ code: result.code, message: result.message }, { status: 400, headers });

  const response = result.ok
    ? NextResponse.json({ ok: true }, { status: 201, headers })
    : NextResponse.json(
      result.code === "account_exists" || result.code === "race"
        ? { code: result.code, message: "Já existe uma conta com este e-mail. Entre com sua senha e aceite o convite." }
        : { code: result.code, message: "Este convite não é mais válido. Peça um novo convite à clínica." },
      { status: result.code === "invite_invalid" ? 404 : 409, headers },
    );
  // Uso unico: apagado em qualquer desfecho definitivo.
  response.cookies.set({ ...cookieBase, name: GOOGLE_PENDING_COOKIE, value: "", maxAge: 0 });
  if (result.ok) {
    response.cookies.set({
      name: sessionCookieName,
      value: await createSession(result.userId),
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });
  }
  return response;
}
