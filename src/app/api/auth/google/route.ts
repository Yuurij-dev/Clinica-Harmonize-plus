import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAuthSecret } from "@/lib/auth-secret";
import { getGoogleConfig } from "@/lib/google-oauth";
import { startGoogleFlow } from "@/lib/google-oauth-flow";
import { parseGoogleIntent } from "@/lib/google-oauth-rules";

const oauthCookieName = "harmonize_oauth";

// Inicia o login com Google: grava o cookie de fluxo (uso unico) e redireciona ao Google.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const intent = parseGoogleIntent(params.get("intent"));
  // Vincular exige sessao valida ja no inicio; sem ela nem gera cookie de fluxo.
  if (intent === "link" && !(await getCurrentUser())) {
    const denied = NextResponse.redirect(new URL("/login?google=error", request.url), 302);
    denied.headers.set("Cache-Control", "no-store");
    return denied;
  }
  const result = await startGoogleFlow({ intent, config: getGoogleConfig(), secret: getAuthSecret(), invite: params.get("invite") });
  const target = result.redirect.startsWith("/") ? new URL(result.redirect, request.url) : result.redirect;
  const response = NextResponse.redirect(target, 302);
  response.headers.set("Cache-Control", "no-store");
  if (result.flowCookie) {
    response.cookies.set({
      name: oauthCookieName,
      value: result.flowCookie.value,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: result.flowCookie.maxAge,
      path: "/api/auth/google",
    });
  }
  return response;
}
