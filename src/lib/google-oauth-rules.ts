import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { isInviteTokenShape, normalizeInviteEmail } from "./invitation-rules.ts";
import type { PendingGoogleInvite } from "./invitations.ts";
import type { PendingGoogleSignup } from "./google-signup.ts";

// Regras puras do login com Google (Authorization Code + PKCE S256 + state + nonce).
// Sem Prisma, sem rede. Nunca logar code, tokens, verifier, state ou nonce.

export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"] as const;
export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const OAUTH_FLOW_TTL_SECONDS = 600;
export const CLOCK_TOLERANCE_MS = 5_000; // igual ao clockTolerance do jwtVerify
export const GOOGLE_SCOPE = "openid email profile";

export type GoogleIntent = "login" | "link" | "signup";

export function parseGoogleIntent(value: unknown): GoogleIntent {
  return value === "link" ? "link" : value === "signup" ? "signup" : "login";
}

const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export function generateCodeVerifier() {
  return randomToken(32);
}

export function codeChallengeFor(verifier: string) {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export const generateOauthState = () => randomToken(32);
export const generateOauthNonce = () => randomToken(32);

export function buildGoogleAuthUrl(input: { clientId: string; redirectUri: string; state: string; nonce: string; codeChallenge: string }) {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPE);
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function safeEqual(a: unknown, b: unknown) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type GoogleClaimsResult =
  | { ok: true; sub: string; email: string; name: string; emailVerified: true }
  | { ok: false; reason: "issuer" | "audience" | "expired" | "nonce" | "no_sub" | "no_email" | "email_unverified" };

export function validateGoogleClaims(
  claims: Record<string, unknown> | null | undefined,
  ctx: { clientId: string; nonce: string; now: Date },
): GoogleClaimsResult {
  const c = claims ?? {};
  if (typeof c.iss !== "string" || !(GOOGLE_ISSUERS as readonly string[]).includes(c.iss)) return { ok: false, reason: "issuer" };
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!ctx.clientId || !aud.includes(ctx.clientId)) return { ok: false, reason: "audience" };
  if (typeof c.exp !== "number" || c.exp * 1000 + CLOCK_TOLERANCE_MS <= ctx.now.getTime()) return { ok: false, reason: "expired" };
  if (!safeEqual(c.nonce, ctx.nonce)) return { ok: false, reason: "nonce" };
  if (typeof c.sub !== "string" || !c.sub) return { ok: false, reason: "no_sub" };
  const email = typeof c.email === "string" ? normalizeInviteEmail(c.email) : "";
  if (!email) return { ok: false, reason: "no_email" };
  if (c.email_verified !== true) return { ok: false, reason: "email_unverified" };
  const name = typeof c.name === "string" && c.name.trim() ? c.name.trim().slice(0, 120) : email.split("@")[0];
  return { ok: true, sub: c.sub, email, name, emailVerified: true };
}

// Cookie de fluxo: JWT HS256 com typ proprio, para nunca valer como sessao (e vice-versa).
export type OauthFlow = { state: string; nonce: string; codeVerifier: string; intent: GoogleIntent; invite?: string };

export async function signOauthFlow(flow: OauthFlow, secret: Uint8Array, ttlSeconds = OAUTH_FLOW_TTL_SECONDS) {
  return new SignJWT({ typ: "oauth_flow", ...flow })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secret);
}

export async function verifyOauthFlow(token: string | null | undefined, secret: Uint8Array): Promise<OauthFlow | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    if (payload.typ !== "oauth_flow") return null;
    const { state, nonce, codeVerifier, intent } = payload;
    if (typeof state !== "string" || typeof nonce !== "string" || typeof codeVerifier !== "string") return null;
    const invite = isInviteTokenShape(payload.invite) ? payload.invite : undefined;
    return { state, nonce, codeVerifier, intent: parseGoogleIntent(intent), ...(invite ? { invite } : {}) };
  } catch {
    return null;
  }
}

// Cookie de "registro Google pendente": o callback ja provou a identidade (claims + convite) e so falta
// coletar os dados pessoais. Mesmo segredo/HS256 do cookie de fluxo, typ proprio (nao vale como fluxo nem sessao).
export const GOOGLE_PENDING_COOKIE = "harmonize_google_pending";
export const GOOGLE_PENDING_PATH = "/api/auth/invite/google/complete";

export async function signPendingGoogle(pending: PendingGoogleInvite, secret: Uint8Array, ttlSeconds = OAUTH_FLOW_TTL_SECONDS) {
  return new SignJWT({ typ: "google_invite_pending", ...pending })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secret);
}

export async function verifyPendingGoogle(token: string | null | undefined, secret: Uint8Array): Promise<PendingGoogleInvite | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    if (payload.typ !== "google_invite_pending") return null;
    const { invite, invitationId, clinicId, sub, email } = payload;
    if (!isInviteTokenShape(invite) || typeof invitationId !== "string" || typeof clinicId !== "string" || typeof sub !== "string" || typeof email !== "string" || !sub || !email) return null;
    return { invite, invitationId, clinicId, sub, email };
  } catch {
    return null;
  }
}

// Cookie de "cadastro Google pendente" (usuario novo criando a propria clinica): typ proprio, distinto de fluxo,
// convite-pendente e sessao. Leva so o minimo da identidade ja verificada pelo Google.
export const GOOGLE_SIGNUP_COOKIE = "harmonize_google_signup";
export const GOOGLE_SIGNUP_PATH = "/api/auth/google/signup/complete";

export async function signPendingSignup(pending: PendingGoogleSignup, secret: Uint8Array, ttlSeconds = OAUTH_FLOW_TTL_SECONDS) {
  return new SignJWT({ typ: "google_signup_pending", sub: pending.sub, email: pending.email, name: pending.name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secret);
}

export async function verifyPendingSignup(token: string | null | undefined, secret: Uint8Array): Promise<PendingGoogleSignup | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    if (payload.typ !== "google_signup_pending") return null;
    const { sub, email, name } = payload;
    if (typeof sub !== "string" || typeof email !== "string" || typeof name !== "string" || !sub || !email) return null;
    return { sub, email, name };
  } catch {
    return null;
  }
}

// Cookie pendente valido E do mesmo convite que a pagina enviou no corpo (nunca concluir o convite A a partir da pagina do B).
export async function pendingGoogleForToken(raw: string | null | undefined, token: unknown, secret: Uint8Array): Promise<PendingGoogleInvite | null> {
  const pending = await verifyPendingGoogle(raw, secret);
  return pending && safeEqual(token, pending.invite) ? pending : null;
}

// Decisao de identidade. O vinculo e SEMPRE pelo `sub`; e-mail igual nunca vincula sozinho
// (o cadastro por senha marca o e-mail como verificado sem verificar: pre-hijacking).
export type ResolveGoogleInput = {
  intent: GoogleIntent;
  googleEmail: string;
  identity: { userId: string } | null; // UserIdentity(google, sub)
  userByEmail: { id: string } | null;
  sessionUser: { id: string; email: string } | null; // so relevante em intent=link
};

export type ResolveGoogleResult =
  | { action: "login"; userId: string }
  | { action: "link"; userId: string }
  | { action: "create" }
  | { action: "refuse"; reason: "account_exists" | "link_requires_session" | "email_mismatch" | "identity_taken" };

export function resolveGoogleLogin(input: ResolveGoogleInput): ResolveGoogleResult {
  const { intent, identity, userByEmail, sessionUser } = input;
  const googleEmail = normalizeInviteEmail(input.googleEmail);

  if (intent === "link") {
    if (!sessionUser) return { action: "refuse", reason: "link_requires_session" };
    if (identity) {
      return identity.userId === sessionUser.id
        ? { action: "login", userId: identity.userId }
        : { action: "refuse", reason: "identity_taken" };
    }
    if (normalizeInviteEmail(sessionUser.email) !== googleEmail) return { action: "refuse", reason: "email_mismatch" };
    if (userByEmail && userByEmail.id !== sessionUser.id) return { action: "refuse", reason: "email_mismatch" };
    return { action: "link", userId: sessionUser.id };
  }

  if (identity) return { action: "login", userId: identity.userId };
  if (userByEmail) return { action: "refuse", reason: "account_exists" };
  return { action: "create" };
}
