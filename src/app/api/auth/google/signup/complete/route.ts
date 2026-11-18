import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { completeLogin } from "@/lib/auth-session";
import { getAuthSecret } from "@/lib/auth-secret";
import { GOOGLE_SIGNUP_COOKIE, GOOGLE_SIGNUP_PATH, verifyPendingSignup } from "@/lib/google-oauth-rules";
import { makeUnusablePasswordHash } from "@/lib/google-oauth-repo";
import { completeGoogleSignup } from "@/lib/google-signup";
import { prismaSignupRepo } from "@/lib/google-signup-db";

const headers = { "Cache-Control": "no-store" };
const cookieBase = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: GOOGLE_SIGNUP_PATH } as const;
const restart = "Sua verificação com o Google expirou. Volte e toque em “Criar conta com Google” novamente.";

// Publico, mas so funciona com o cookie assinado do callback do Google (e-mail e sub vem dele, nunca do corpo).
// Cria Clinic + User ADMIN + UserIdentity + membership owner na mesma transacao e ja abre a sessao.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const cookieHeader = request.headers.get("cookie") ?? "";
  const raw = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${GOOGLE_SIGNUP_COOKIE}=`))?.slice(GOOGLE_SIGNUP_COOKIE.length + 1) ?? null;
  const pending = await verifyPendingSignup(raw, getAuthSecret());
  if (!pending) {
    const response = NextResponse.json({ code: "pending_missing", message: restart }, { status: 400, headers });
    response.cookies.set({ ...cookieBase, name: GOOGLE_SIGNUP_COOKIE, value: "", maxAge: 0 });
    return response;
  }

  let result;
  try {
    result = await completeGoogleSignup(prismaSignupRepo, { pending, profile: body, makePasswordHash: makeUnusablePasswordHash, newSuffix: randomUUID });
  } catch (error) {
    console.error("[google-signup]", (error as { code?: unknown } | null)?.code);
    return NextResponse.json({ code: "error", message: "Não foi possível criar a conta agora. Tente novamente." }, { status: 500, headers });
  }
  // Dados invalidos: o cookie continua valido para a pessoa corrigir e reenviar.
  if (!result.ok && result.code === "invalid_profile") return NextResponse.json({ code: result.code, message: result.message }, { status: 400, headers });

  // Conta nova (Google): sem trusted device/TOTP ainda, então o login pode pedir o código por e-mail.
  const login = result.ok ? await completeLogin({ request, userId: result.userId, origin: "google" }) : null;
  const response = !result.ok
    ? NextResponse.json({ code: result.code, message: "Já existe uma conta com este e-mail. Entre com sua senha ou com o Google." }, { status: 409, headers })
    : login && !login.ok
      ? NextResponse.json({ code: "mfa_email_failed", message: "Conta criada, mas não foi possível enviar o código de verificação agora. Entre novamente em alguns instantes." }, { status: 201, headers })
      : NextResponse.json({ ok: true, ...(login?.mfaRequired ? { mfaRequired: true, method: login.method } : {}) }, { status: 201, headers });
  // Uso unico: apagado em qualquer desfecho definitivo.
  response.cookies.set({ ...cookieBase, name: GOOGLE_SIGNUP_COOKIE, value: "", maxAge: 0 });
  if (login?.ok) login.apply(response);
  return response;
}
