import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { GOOGLE_ISSUERS } from "./google-oauth-rules.ts";
import type { GoogleConfig } from "./google-oauth-flow.ts";

// Parte de servidor do login com Google. Nunca logar code, tokens ou segredo.

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REQUEST_TIMEOUT_MS = 8_000;
const jwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), { timeoutDuration: REQUEST_TIMEOUT_MS });

// redirect_uri vem de NEXT_PUBLIC_SITE_URL; nunca do header Host. Em producao sem a variavel, indisponivel.
export function getGoogleConfig(env: Record<string, string | undefined> = process.env): GoogleConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const site = env.NEXT_PUBLIC_SITE_URL?.trim() || (env.NODE_ENV === "production" ? "" : "http://localhost:3000");
  if (!site) return null;
  try {
    return { clientId, clientSecret, redirectUri: `${new URL(site).origin}/api/auth/google/callback` };
  } catch {
    return null;
  }
}

export class GoogleOauthError extends Error {
  readonly code: "exchange_failed" | "no_id_token" | "invalid_id_token";
  constructor(code: "exchange_failed" | "no_id_token" | "invalid_id_token") {
    super(code);
    this.code = code;
  }
}

export async function exchangeCodeForIdToken(
  input: { code: string; codeVerifier: string; redirectUri: string },
  config: GoogleConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: input.code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: "authorization_code",
        code_verifier: input.codeVerifier,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new GoogleOauthError("exchange_failed");
  }
  if (!response.ok) throw new GoogleOauthError("exchange_failed");
  const data = await response.json().catch(() => null) as { id_token?: unknown } | null;
  if (typeof data?.id_token !== "string" || !data.id_token) throw new GoogleOauthError("no_id_token");
  return data.id_token;
}

export async function verifyGoogleIdToken(idToken: string, clientId: string, keys: JWTVerifyGetKey = jwks): Promise<Record<string, unknown>> {
  try {
    const { payload } = await jwtVerify(idToken, keys, { issuer: [...GOOGLE_ISSUERS], audience: clientId, algorithms: ["RS256"], clockTolerance: 5 });
    // azp, quando presente, precisa ser o nosso client_id; com aud em lista ele e obrigatorio.
    if ((Array.isArray(payload.aud) || payload.azp !== undefined) && payload.azp !== clientId) throw new Error("azp");
    return payload as Record<string, unknown>;
  } catch {
    throw new GoogleOauthError("invalid_id_token");
  }
}

