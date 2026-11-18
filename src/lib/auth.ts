import { jwtVerify, SignJWT } from "jose";
import { cookies, headers } from "next/headers";
import { parseBearerToken } from "./bearer-rules";
import { getAuthSecret } from "./auth-secret";
import { prisma } from "./prisma";
import { pickMembership } from "./active-clinic-rules";
import { resolveEntitlements, type Entitlements } from "./entitlements.ts";
import { canForUser, normalizeRolePermissionMatrix, type Permission, type RolePermissionMatrix } from "./permissions";

export const sessionCookieName = "harmonize_session";
// Cache de perfil/permissões por instância (chave userId:sid:activeClinicId). O estado da AuthSession é consultado no banco em toda requisição,
// para que revogações feitas por qualquer instância tenham efeito na próxima requisição.
const authCacheTtl = 15_000;
const authCacheMaxEntries = 5000;
// lastSeenAt da sessão só é regravado se estiver mais velho que isto (evita escrita a cada request).
const lastSeenRefreshMs = 5 * 60_000;

type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "PROFESSIONAL" | "STAFF";
  isOwner: boolean;
  clinicId: string;
  /** Direitos da clínica (plano, modo de acesso, recursos, limites). Só no servidor: o cliente recebe `access` de /api/auth/me. */
  entitlements: Entitlements;
  /** Compat com a UI: true quando a clínica está em somente leitura. Não é fonte de autorização (use entitlements). */
  trialExpired: boolean;
  rolePermissions: RolePermissionMatrix;
  clinic: { id: string; name: string; slug: string; trialEndsAt: Date | null };
  /** id da AuthSession (claim sid); não expor ao cliente. */
  sessionId: string;
};

const globalAuthCache = globalThis as typeof globalThis & {
  harmonizeAuthCache?: Map<string, { expiresAt: number; value?: AuthenticatedUser | null; pending?: Promise<AuthenticatedUser | null> }>;
};
const authCache = globalAuthCache.harmonizeAuthCache ?? new Map();
if (!globalAuthCache.harmonizeAuthCache) globalAuthCache.harmonizeAuthCache = authCache;

// Ao inserir: remove expiradas e, se ainda passar do limite, as mais antigas (Map preserva a ordem de inserção).
function sweepAuthCache() {
  const now = Date.now();
  for (const [key, entry] of authCache) if (entry.expiresAt <= now) authCache.delete(key);
  let excess = authCache.size - authCacheMaxEntries + 1;
  for (const key of authCache.keys()) {
    if (excess-- <= 0) break;
    authCache.delete(key);
  }
}

// JWT de sessão: sempre com sid (AuthSession), por isso revogável. O vencimento do JWT acompanha AuthSession.expiresAt.
export async function signSessionToken(userId: string, sid: string, expiresAt: Date) {
  return new SignJWT({ userId, sid })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(getAuthSecret());
}

export async function createPasswordChangeSession(userId: string) {
  return new SignJWT({ userId, passwordChangeOnly: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(getAuthSecret());
}

/** Limpa o cache de todas as sessões (sids) do usuário nesta instância. */
export function invalidateUserAuthCache(userId: string) {
  const prefix = `${userId}:`;
  for (const key of [...authCache.keys()]) if (key.startsWith(prefix)) authCache.delete(key);
}

export function invalidateAllUserAuthCache() {
  authCache.clear();
}

export function userCan(user: AuthenticatedUser, permission: Permission) {
  return canForUser(user, permission);
}

// userId+sid de um JWT válido; passwordChangeOnly e mfaPending nunca valem como sessão; JWT sem sid é rejeitado.
async function verifiedSession(token: string | null | undefined) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getAuthSecret());
    if (typeof payload.userId !== "string" || typeof payload.sid !== "string" || !payload.sid) return null;
    if (payload.passwordChangeOnly === true || payload.mfaPending === true) return null;
    return { userId: payload.userId, sid: payload.sid };
  } catch {
    return null;
  }
}

// activeClinicId vem da mesma leitura que montou a chave do cache: o perfil guardado sob `u:sid:A` e sempre o da clinica A (sem corrida na troca de clinica).
async function loadAuthenticatedUser(userId: string, sid: string, activeClinicId: string | null): Promise<AuthenticatedUser | null> {
  const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        activeClinicId: true,
        memberships: {
          orderBy: { id: "asc" },
          // A assinatura vem no mesmo select da clínica (um único round-trip, já coberto pelo cache de 15 s).
          select: { role: true, isOwner: true, clinic: { select: { id: true, name: true, slug: true, trialEndsAt: true, rolePermissions: true, subscription: { select: { plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true } } } } },
        },
      },
    });
  const membership = user ? pickMembership(user.memberships, activeClinicId) : undefined;
  if (!user || !membership) return null;
  // A ASSINATURA é a fonte oficial dos direitos de acesso (Clinic.trialEndsAt fica só por compatibilidade). Clínica sem
  // assinatura (não deveria existir: o trigger cria uma por clínica) falha fechada: somente leitura, sem recursos de plano.
  const subscription = membership.clinic.subscription;
  const entitlements = resolveEntitlements(subscription, new Date());
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: membership.role,
    isOwner: membership.isOwner,
    clinicId: membership.clinic.id,
    entitlements,
    // Compat com a UI atual: "teste encerrado" passa a significar "sem escrita" (teste vencido OU assinatura sem acesso completo).
    trialExpired: entitlements.accessMode === "readonly",
    rolePermissions: normalizeRolePermissionMatrix(membership.clinic.rolePermissions),
    // A contagem regressiva só existe durante o teste: o término vem da assinatura, não de Clinic.trialEndsAt.
    clinic: { id: membership.clinic.id, name: membership.clinic.name, slug: membership.clinic.slug, trialEndsAt: subscription?.status === "TRIALING" ? subscription.trialEndsAt : null },
    sessionId: sid,
  };
}

async function resolveCurrentUser(session: { userId: string; sid: string } | null) {
  if (!session) return null;
  const { userId, sid } = session;

  // Única leitura obrigatória por requisição: AuthSession é a fonte compartilhada de revogação entre instâncias.
  // Os dados maiores de usuário/permissões continuam no cache local de 15 s.
  // A clínica ativa vem na mesma leitura e entra na chave do cache: trocar de clínica em outra instância nunca serve o perfil da anterior.
  // Mudança de plano/assinatura, ao contrário, só vale em outras instâncias após a janela de authCacheTtl (15 s); com pagamentos/webhooks
  // será preciso invalidar o cache por clínica (ver docs/planos.md).
  const sessionRow = await prisma.authSession.findUnique({ where: { id: sid }, select: { userId: true, expiresAt: true, revokedAt: true, lastSeenAt: true, user: { select: { activeClinicId: true } } } });
  if (!sessionRow || sessionRow.userId !== userId || sessionRow.revokedAt || sessionRow.expiresAt.getTime() <= Date.now()) {
    for (const key of [...authCache.keys()]) if (key.startsWith(`${userId}:${sid}:`)) authCache.delete(key);
    return null;
  }
  const cacheKey = `${userId}:${sid}:${sessionRow.user?.activeClinicId ?? ""}`;
  if (Date.now() - sessionRow.lastSeenAt.getTime() > lastSeenRefreshMs) {
    void prisma.authSession.updateMany({ where: { id: sid, userId, revokedAt: null }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }

  const cached = authCache.get(cacheKey);
  if (cached?.expiresAt && cached.expiresAt > Date.now()) {
    return cached.pending ? await cached.pending : cached.value ?? null;
  }

  const pending = loadAuthenticatedUser(userId, sid, sessionRow.user?.activeClinicId ?? null);
  const entry = { expiresAt: Date.now() + authCacheTtl, pending };
  sweepAuthCache();
  authCache.set(cacheKey, entry);
  let user: AuthenticatedUser | null;
  try {
    user = await pending;
  } catch (error) {
    // Falha momentânea do banco não pode virar 401 em cache por 15 s; deixa a rota responder 500.
    if (authCache.get(cacheKey) === entry) authCache.delete(cacheKey);
    throw error;
  }
  // Só grava o resultado se a entrada não foi invalidada (revogação) enquanto a consulta rodava.
  if (authCache.get(cacheKey) === entry) authCache.set(cacheKey, { expiresAt: Date.now() + authCacheTtl, value: user });
  return user;
}

// Devolve o usuário autenticado ou null (401). Somente leitura NÃO é falha de autenticação: o usuário é devolvido normalmente
// e as rotas de escrita chamam denyIfReadonly (plan-guards.ts), que responde 403 SUBSCRIPTION_READONLY sem encerrar a sessão.
export async function getCurrentUser() {
  // Authorization explícito seleciona o Bearer e nunca cai para um cookie ambiental; Web sem Bearer segue autenticando por cookie.
  const cookieToken = (await cookies()).get(sessionCookieName)?.value;
  const authorization = (await headers()).get("authorization");
  const session = authorization !== null
    ? await verifiedSession(parseBearerToken(authorization))
    : await verifiedSession(cookieToken);
  return resolveCurrentUser(session);
}

/** Identidade exclusivamente do JWT fornecido; ignora cookies ambientais do navegador. */
export async function getCurrentUserFromToken(token: string) {
  return resolveCurrentUser(await verifiedSession(token));
}

/** Claims (userId, sid) de um JWT de sessão válido, sem consultar o banco. Usado pelo logout para revogar mesmo se getCurrentUser devolver null. */
export const readSessionClaims = verifiedSession;
