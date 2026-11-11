import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { completeLogin } from "@/lib/auth-session";
import { getAuthSecret } from "@/lib/auth-secret";
import { exchangeCodeForIdToken, getGoogleConfig, verifyGoogleIdToken } from "@/lib/google-oauth";
import { makeUnusablePasswordHash, prismaGoogleRepo } from "@/lib/google-oauth-repo";
import { prismaInvitationRepo } from "@/lib/invitations-db";
import { handleGoogleCallback } from "@/lib/google-oauth-flow";
import { GOOGLE_PENDING_COOKIE, GOOGLE_PENDING_PATH, GOOGLE_SIGNUP_COOKIE, GOOGLE_SIGNUP_PATH, OAUTH_FLOW_TTL_SECONDS, signPendingGoogle, signPendingSignup } from "@/lib/google-oauth-rules";

const oauthCookieName = "harmonize_oauth";

// Callback do Google. Destino sempre fixo ("/" ou /login?google=codigo): nenhum returnTo/next do cliente.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const cookieHeader = request.headers.get("cookie") ?? "";
  const flowToken = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${oauthCookieName}=`))?.slice(oauthCookieName.length + 1) ?? null;
  const config = getGoogleConfig();

  const result = await handleGoogleCallback({
    config,
    secret: getAuthSecret(),
    now: () => new Date(),
    exchange: (input) => exchangeCodeForIdToken(input, config!),
    verify: (idToken) => verifyGoogleIdToken(idToken, config!.clientId),
    repo: prismaGoogleRepo,
    invitations: prismaInvitationRepo,
    getSessionUser: async () => {
      // allowMfaSetup: quem está no assistente de 2FA obrigatório ainda pode vincular o Google. Sem bypass: aqui só se lê id/e-mail para vincular a identidade; nenhum dado é exposto.
      const user = await getCurrentUser({ allowMfaSetup: true });
      return user ? { id: user.id, email: user.email } : null;
    },
    makePasswordHash: makeUnusablePasswordHash,
  }, {
    error: url.searchParams.get("error"),
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
    flowToken,
  });

  // Login com 2FA ativo (sem dispositivo confiável): sem sessão; cookie harmonize_mfa e a tela de verificação.
  const login = result.sessionUserId ? await completeLogin({ request, userId: result.sessionUserId, origin: "google" }) : null;
  const response = NextResponse.redirect(new URL(login?.mfaRequired ? "/login?mfa=1" : result.redirect, request.url), 302);
  response.headers.set("Cache-Control", "no-store");
  // Cookie de fluxo e de uso unico: apagado em qualquer desfecho.
  response.cookies.set({ name: oauthCookieName, value: "", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 0, path: "/api/auth/google" });
  if (result.pendingGoogle) {
    // Identidade e convite validados; falta coletar os dados pessoais. Cookie curto, assinado, so enviado ao endpoint de conclusao.
    response.cookies.set({
      name: GOOGLE_PENDING_COOKIE,
      value: await signPendingGoogle(result.pendingGoogle, getAuthSecret()),
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: OAUTH_FLOW_TTL_SECONDS,
      path: GOOGLE_PENDING_PATH,
    });
  }
  if (result.pendingSignup) {
    // Identidade nova validada; falta coletar os dados da clinica. Cookie curto, assinado, so enviado ao endpoint de conclusao.
    response.cookies.set({
      name: GOOGLE_SIGNUP_COOKIE,
      value: await signPendingSignup(result.pendingSignup, getAuthSecret()),
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: OAUTH_FLOW_TTL_SECONDS,
      path: GOOGLE_SIGNUP_PATH,
    });
  }
  login?.apply(response);
  return response;
}
