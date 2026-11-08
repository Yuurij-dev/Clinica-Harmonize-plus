import { hashInviteToken, invitationState, isInviteTokenShape, normalizeInviteEmail } from "./invitation-rules.ts";
import { acceptInvitation, inviterCanInvite, type InvitationRepo, type PendingGoogleInvite } from "./invitations.ts";
import {
  buildGoogleAuthUrl,
  codeChallengeFor,
  generateCodeVerifier,
  generateOauthNonce,
  generateOauthState,
  OAUTH_FLOW_TTL_SECONDS,
  resolveGoogleLogin,
  safeEqual,
  signOauthFlow,
  validateGoogleClaims,
  verifyOauthFlow,
  type GoogleIntent,
} from "./google-oauth-rules.ts";

// Orquestracao do login com Google com dependencias injetadas (sem Next, sem Prisma, sem rede),
// para testar o callback sem Google. Nunca logar code, tokens, state, nonce ou verifier.

export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string };

export type GoogleLoginCode = "unavailable" | "denied" | "no_access" | "account_exists" | "locked" | "must_change_password" | "invite_invalid" | "invite_email_mismatch" | "error";

export type GoogleRepo = {
  findIdentity(sub: string): Promise<{ userId: string } | null>;
  findUserByEmail(email: string): Promise<{ id: string } | null>;
  hasMembership(userId: string): Promise<boolean>;
  getUserAccess(userId: string): Promise<{ email: string; lockedUntil: Date | null; mustChangePassword: boolean } | null>;
  touchIdentity(sub: string, now: Date): Promise<void>;
  linkIdentity(input: { userId: string; sub: string; email: string; now: Date }): Promise<void>;
  createUserWithIdentity(input: { name: string; email: string; sub: string; passwordHash: string; now: Date }): Promise<string>;
};

const loginRedirect = (code: GoogleLoginCode) => `/login?google=${code}`;

export async function startGoogleFlow(input: { intent: GoogleIntent; config: GoogleConfig | null; secret: Uint8Array; invite?: unknown }): Promise<{ redirect: string; flowCookie?: { value: string; maxAge: number } }> {
  if (!input.config) return { redirect: loginRedirect("unavailable") };
  // Convite so vale no login (nunca no link) e so com formato valido; vai dentro do cookie assinado, nunca na URL do Google.
  const invite = input.intent === "login" && isInviteTokenShape(input.invite) ? input.invite : undefined;
  const state = generateOauthState();
  const nonce = generateOauthNonce();
  const codeVerifier = generateCodeVerifier();
  const cookie = await signOauthFlow({ state, nonce, codeVerifier, intent: input.intent, ...(invite ? { invite } : {}) }, input.secret);
  const redirect = buildGoogleAuthUrl({
    clientId: input.config.clientId,
    redirectUri: input.config.redirectUri,
    state,
    nonce,
    codeChallenge: codeChallengeFor(codeVerifier),
  });
  return { redirect, flowCookie: { value: cookie, maxAge: OAUTH_FLOW_TTL_SECONDS } };
}

// Diagnostico: so codigos estaveis (nunca mensagem de erro, code OAuth, token, e-mail ou segredo).
function diag(code: unknown) {
  console.warn("[google-oauth]", typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : "unknown");
}

export type GoogleCallbackDeps = {
  config: GoogleConfig | null;
  secret: Uint8Array;
  now: () => Date;
  exchange: (input: { code: string; codeVerifier: string; redirectUri: string }) => Promise<string>;
  verify: (idToken: string) => Promise<Record<string, unknown>>;
  repo: GoogleRepo;
  invitations: InvitationRepo;
  getSessionUser: () => Promise<{ id: string; email: string } | null>;
  makePasswordHash: () => Promise<string>;
};

export type GoogleCallbackInput = {
  error?: string | null;
  code?: string | null;
  state?: string | null;
  flowToken?: string | null;
};

export type GoogleCallbackResult = { redirect: string; sessionUserId?: string; pendingGoogle?: PendingGoogleInvite };

// Devolve sempre um destino fixo ("/" ou /login?google=...). `sessionUserId` so existe no sucesso;
// `pendingGoogle` so existe no convite de conta nova (sem sessao: falta coletar os dados pessoais).
export async function handleGoogleCallback(deps: GoogleCallbackDeps, input: GoogleCallbackInput): Promise<GoogleCallbackResult> {
  const fail = (code: GoogleLoginCode) => ({ redirect: loginRedirect(code) });
  if (!deps.config) return fail("unavailable");
  if (input.error) return fail(input.error === "access_denied" ? "denied" : "error");

  const flow = await verifyOauthFlow(input.flowToken, deps.secret);
  if (!flow || !input.code || !safeEqual(input.state, flow.state)) return fail("error");

  let claimsResult;
  try {
    const idToken = await deps.exchange({ code: input.code, codeVerifier: flow.codeVerifier, redirectUri: deps.config.redirectUri });
    const claims = await deps.verify(idToken);
    claimsResult = validateGoogleClaims(claims, { clientId: deps.config.clientId, nonce: flow.nonce, now: deps.now() });
  } catch (error) {
    diag((error as { code?: unknown } | null)?.code);
    return fail("error");
  }
  if (!claimsResult.ok) {
    diag(claimsResult.reason);
    return fail("error");
  }
  const google = claimsResult;

  if (flow.intent === "login" && flow.invite) return handleInviteLogin(deps, flow.invite, google);

  try {
    const now = deps.now();
    const sessionUser = flow.intent === "link" ? await deps.getSessionUser() : null;
    const [identity, userByEmail] = await Promise.all([deps.repo.findIdentity(google.sub), deps.repo.findUserByEmail(google.email)]);
    const decision = resolveGoogleLogin({ intent: flow.intent, googleEmail: google.email, identity, userByEmail, sessionUser });

    let userId: string;
    if (decision.action === "refuse") {
      diag(decision.reason);
      return fail(decision.reason === "account_exists" ? "account_exists" : "error");
    }

    // Bloqueio por senha e senha provisoria valem tambem para o Google (login e link), antes de qualquer escrita.
    // Nao zera contadores de tentativas.
    if (decision.action !== "create") {
      const access = await deps.repo.getUserAccess(decision.userId);
      if (!access) return fail("error");
      if (access.lockedUntil && access.lockedUntil.getTime() > now.getTime()) return fail("locked");
      if (access.mustChangePassword) return fail("must_change_password");
    }

    if (decision.action === "login") {
      userId = decision.userId;
      await deps.repo.touchIdentity(google.sub, now);
    } else if (decision.action === "link") {
      userId = decision.userId;
      await deps.repo.linkIdentity({ userId, sub: google.sub, email: google.email, now });
    } else {
      userId = await deps.repo.createUserWithIdentity({ name: google.name, email: google.email, sub: google.sub, passwordHash: await deps.makePasswordHash(), now });
    }

    // Sem clinica nao ha sessao nesta etapa (convite/criacao de clinica entram depois).
    if (!(await deps.repo.hasMembership(userId))) return fail("no_access");
    // google=ok faz a tela avisar outras abas da troca de sessao (como o login por senha).
    return { redirect: "/?google=ok", sessionUserId: userId };
  } catch (error) {
    // Inclui corrida em P2002 (sub/e-mail ja usados): o usuario so tenta de novo.
    diag((error as { code?: unknown } | null)?.code);
    return fail("error");
  }
}

// Login com Google a partir de um convite (token no cookie de fluxo assinado). Roda DEPOIS de toda a
// validacao de claims. (a) identidade existente: aceita para esse usuario; (b) sem usuario: cria
// User+UserIdentity+aceite na mesma transacao; (c) usuario com o e-mail e sem identidade: nao vincula;
// (d) convite invalido/vencido/cancelado: erro generico.
async function handleInviteLogin(
  deps: GoogleCallbackDeps,
  token: string,
  google: { sub: string; email: string },
): Promise<GoogleCallbackResult> {
  const fail = (code: GoogleLoginCode) => ({ redirect: loginRedirect(code) });
  // account_exists e e-mail divergente voltam para a pagina do convite (destino montado so do token ja validado por formato).
  const backToInvite = (code: "account_exists" | "invite_email_mismatch") => ({ redirect: `/convite/${token}?google=${code}` });
  try {
    const now = deps.now();
    const invitation = await deps.invitations.findByTokenHash(hashInviteToken(token));
    if (!invitation || invitationState(invitation, now) !== "pending") return fail("invite_invalid");
    if (normalizeInviteEmail(invitation.email) !== google.email) return backToInvite("invite_email_mismatch");

    const [identity, userByEmail] = await Promise.all([deps.repo.findIdentity(google.sub), deps.repo.findUserByEmail(google.email)]);
    let userId: string;
    let otherClinic = false;
    if (identity) {
      const access = await deps.repo.getUserAccess(identity.userId);
      if (!access) return fail("error");
      if (access.lockedUntil && access.lockedUntil.getTime() > now.getTime()) return fail("locked");
      if (access.mustChangePassword) return fail("must_change_password");
      const accepted = await acceptInvitation(deps.invitations, { token, user: { id: identity.userId, email: access.email } }, now);
      if (!accepted.ok) return accepted.code === "email_mismatch" ? backToInvite("invite_email_mismatch") : fail("invite_invalid");
      otherClinic = accepted.alreadyInOtherClinic;
      // O convite ja foi consumido: falha ao registrar o ultimo login nao pode derrubar o acesso.
      try {
        await deps.repo.touchIdentity(google.sub, now);
      } catch (error) {
        diag((error as { code?: unknown } | null)?.code);
      }
      userId = identity.userId;
    } else if (userByEmail) {
      diag("account_exists");
      return backToInvite("account_exists");
    } else {
      // Autor que saiu da clinica ou perdeu settings:team invalida o convite (a conclusao tambem re-checa, na transacao).
      if (!(await inviterCanInvite(deps.invitations, invitation))) return fail("invite_invalid");
      // Conta nova: identidade e convite ja estao validados. Nada e criado aqui; os dados pessoais sao coletados
      // na pagina do convite e a conta nasce atomicamente em /api/auth/invite/google/complete.
      return {
        redirect: `/convite/${token}?google=complete`,
        pendingGoogle: { invite: token, invitationId: invitation.id, clinicId: invitation.clinicId, sub: google.sub, email: google.email },
      };
    }
    if (!(await deps.repo.hasMembership(userId))) return fail("no_access");
    // other_clinic=1: o app avisa que o acesso ainda abre a clinica mais antiga (ate existir clinica ativa).
    return { redirect: otherClinic ? "/?google=ok&other_clinic=1" : "/?google=ok", sessionUserId: userId };
  } catch (error) {
    diag((error as { code?: unknown } | null)?.code);
    return fail("error");
  }
}
