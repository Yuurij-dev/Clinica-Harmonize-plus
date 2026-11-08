import { createHash, randomBytes } from "node:crypto";

// Regras puras de convite para clinica. Sem Prisma, sem I/O.
// Nunca logar o token em claro nem o hash.

export const INVITE_TTL_DAYS = 7;
export const INVITE_TOKEN_BYTES = 32;

export type InviteRole = "PROFESSIONAL" | "STAFF";

// ADMIN nao pode ser concedido por convite: administracao/dono so muda pelo
// fluxo existente de equipe, evitando escalada de privilegio por link vazado.
const ALLOWED_INVITE_ROLES: readonly InviteRole[] = ["PROFESSIONAL", "STAFF"];

export function allowedInviteRoles(): readonly InviteRole[] {
  return ALLOWED_INVITE_ROLES;
}

export function isAllowedInviteRole(role: unknown): role is InviteRole {
  return typeof role === "string" && (ALLOWED_INVITE_ROLES as readonly string[]).includes(role);
}

export function normalizeInviteEmail(email: string): string {
  return String(email ?? "").trim().toLowerCase();
}

export function generateInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function inviteExpiryDate(now: Date, days: number = INVITE_TTL_DAYS): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export type InvitationStatusValue = "PENDING" | "ACCEPTED" | "EXPIRED" | "CANCELLED";
export type InvitationState = "pending" | "accepted" | "expired" | "cancelled";

export type InvitationLike = {
  status: InvitationStatusValue;
  email: string;
  expiresAt: Date;
};

// Vence quando now >= expiresAt.
export function invitationState(invitation: Pick<InvitationLike, "status" | "expiresAt">, now: Date): InvitationState {
  if (invitation.status === "ACCEPTED") return "accepted";
  if (invitation.status === "CANCELLED") return "cancelled";
  // Qualquer status que nao seja PENDING (inclusive desconhecido) falha fechado como expirado.
  if (invitation.status !== "PENDING") return "expired";
  return now.getTime() >= invitation.expiresAt.getTime() ? "expired" : "pending";
}

export type InviteRefusal = "expired" | "cancelled" | "accepted" | "email_mismatch" | "email_unverified";

export type AcceptInvitationResult = { ok: true } | { ok: false; reason: InviteRefusal };

export function canAcceptInvitation(input: {
  invitation: InvitationLike;
  accountEmail: string;
  emailVerified: boolean;
  now: Date;
}): AcceptInvitationResult {
  const state = invitationState(input.invitation, input.now);
  if (state !== "pending") return { ok: false, reason: state };
  if (!input.emailVerified) return { ok: false, reason: "email_unverified" };
  const account = normalizeInviteEmail(input.accountEmail);
  if (!account || account !== normalizeInviteEmail(input.invitation.email)) {
    return { ok: false, reason: "email_mismatch" };
  }
  return { ok: true };
}

// Validacao simples e deliberadamente conservadora (o convite so vale se a caixa receber o token).
export function isValidInviteEmail(email: string): boolean {
  const e = normalizeInviteEmail(email);
  // Um unico "@"; sem espacos nem caracteres de lista/cabecalho/aspas (evita "evil<a@x.com>" e "a@b.com,c@d.com").
  return e.length <= 254 && /^[^\s@<>,;"()[\]\\\p{Cc}]+@[^\s@<>,;"()[\]\\\p{Cc}]+\.[^\s@<>,;"()[\]\\\p{Cc}]{2,}$/u.test(e);
}

// Token gerado por generateInviteToken: 32 bytes em base64url = 43 caracteres.
export function isInviteTokenShape(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

const ROLE_RANK: Record<string, number> = { ADMIN: 3, PROFESSIONAL: 2, STAFF: 1 };

// Rebaixamento: o novo papel tem menos privilegio que o anterior (papel desconhecido conta como rebaixamento).
export function isRoleDemotion(from: string, to: string): boolean {
  return (ROLE_RANK[to] ?? 0) < (ROLE_RANK[from] ?? 0);
}

export const MAX_PENDING_INVITES_PER_CLINIC = 25;
export const MAX_INVITE_SENDS = 5;
// Teto de convites DISTINTOS tocados (criados ou reenviados, qualquer status) por clinica na janela movel.
// Um reenvio so atualiza lastSentAt do mesmo convite, entao o pior caso e 40 convites x 5 envios = 200 e-mails em 24 h.
export const MAX_INVITES_SENT_PER_WINDOW = 40;
export const INVITE_SEND_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MIN_INVITE_RESEND_INTERVAL_MS = 60_000;
