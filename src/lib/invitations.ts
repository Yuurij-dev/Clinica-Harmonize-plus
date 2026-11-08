import { parseCollaboratorProfile, type CollaboratorProfile } from "./collaborator-profile-rules.ts";
import type { EmailFailureReason, EmailResult } from "./email.ts";
import { canForUser } from "./permissions.ts";
import {
  canAcceptInvitation,
  generateInviteToken,
  hashInviteToken,
  invitationState,
  inviteExpiryDate,
  isAllowedInviteRole,
  isValidInviteEmail,
  INVITE_SEND_WINDOW_MS,
  MAX_INVITE_SENDS,
  MAX_INVITES_SENT_PER_WINDOW,
  MAX_PENDING_INVITES_PER_CLINIC,
  MIN_INVITE_RESEND_INTERVAL_MS,
  normalizeInviteEmail,
  type InvitationState,
  type InvitationStatusValue,
  type InviteRole,
} from "./invitation-rules.ts";

// Logica de convites com repositorio injetado (sem Prisma, sem Next). O token em claro so existe
// na memoria: e devolvido uma vez para a camada de envio e nunca e gravado nem logado.

export type InvitationRow = {
  id: string;
  clinicId: string;
  email: string;
  role: string;
  tokenHash: string;
  status: InvitationStatusValue;
  expiresAt: Date;
  invitedById: string | null;
  acceptedById: string | null;
  acceptedAt: Date | null;
  lastSentAt: Date;
  sendCount: number;
  createdAt: Date;
};

export type InvitationListItem = {
  id: string;
  email: string;
  role: string;
  status: InvitationState;
  expiresAt: Date;
  createdAt: Date;
  lastSentAt: Date;
  sendCount: number;
  invitedBy: string | null;
};

export type InvitationTx = {
  // Serializa criacao/reenvio por clinica (pg_advisory_xact_lock) para os tetos nao sofrerem corrida.
  lockClinicInvites(clinicId: string): Promise<void>;
  countSentSince(input: { clinicId: string; since: Date }): Promise<number>;
  expireStalePending(input: { clinicId: string; email: string; now: Date }): Promise<void>;
  isMemberByEmail(input: { clinicId: string; email: string }): Promise<boolean>;
  countPending(input: { clinicId: string; now: Date }): Promise<number>;
  create(input: { clinicId: string; email: string; role: InviteRole; tokenHash: string; expiresAt: Date; invitedById: string; now: Date }): Promise<InvitationRow>;
  findInClinic(input: { id: string; clinicId: string }): Promise<InvitationRow | null>;
  rotate(input: { id: string; clinicId: string; tokenHash: string; expiresAt: Date; now: Date; maxSends: number; sentBefore: Date }): Promise<number>;
  cancelPending(input: { id: string; clinicId: string }): Promise<number>;
  findByTokenHash(tokenHash: string): Promise<(InvitationRow & { clinicName: string }) | null>;
  markAccepted(input: { id: string; clinicId: string; tokenHash: string; userId: string; now: Date }): Promise<number>;
  findMembership(input: { userId: string; clinicId: string }): Promise<{ id: string } | null>;
  // Acesso atual de quem criou o convite: precisa continuar membro E com settings:team (B3 nao alcanca revogacao pela matriz
  // nem convites criados na janela do cache de login). null = nao e mais membro.
  inviterAccess(input: { userId: string; clinicId: string }): Promise<{ role: string; isOwner: boolean; rolePermissions: unknown } | null>;
  countMembershipsOutside(input: { userId: string; clinicId: string }): Promise<number>;
  createMembership(input: { userId: string; clinicId: string; role: InviteRole }): Promise<void>;
  findUserByEmail(email: string): Promise<{ id: string } | null>;
  createUser(input: { name: string; email: string; passwordHash: string; now: Date } & Partial<Omit<CollaboratorProfile, "name">>): Promise<string>;
  createIdentity(input: { userId: string; provider: string; sub: string; email: string; now: Date }): Promise<void>;
};

export type InvitationRepo = InvitationTx & {
  transaction<T>(fn: (tx: InvitationTx) => Promise<T>): Promise<T>;
  list(clinicId: string): Promise<Array<ListRow & { invitedByName: string | null }>>;
};

const isP2002 = (error: unknown) => (error as { code?: unknown } | null)?.code === "P2002";

type ListRow = Pick<InvitationRow, "id" | "email" | "role" | "status" | "expiresAt" | "createdAt" | "lastSentAt" | "sendCount"> & { invitedByName?: string | null };

function toListItem(row: ListRow, now: Date): InvitationListItem {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: invitationState(row, now),
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    lastSentAt: row.lastSentAt,
    sendCount: row.sendCount,
    invitedBy: row.invitedByName ?? null,
  };
}

export type InviteFailure = { ok: false; status: 400 | 404 | 409 | 429 | 503; code: string; message: string };
const DELIVERY_UNAVAILABLE = "O envio de e-mails ainda não está configurado.";
const WINDOW_LIMIT = "Limite de convites enviados nas últimas 24 horas atingido.";
const PENDING_LIMIT = "Há convites pendentes demais. Cancele algum antes de enviar outro.";
const fail = (status: InviteFailure["status"], code: string, message: string): InviteFailure => ({ ok: false, status, code, message });

// clinicId e invitedById vem SEMPRE da sessao; role e validado contra a allowlist.
export async function createInvitation(
  repo: InvitationRepo,
  input: { clinicId: string; invitedById: string; email: unknown; role: unknown; deliveryReady: boolean },
  now: Date = new Date(),
): Promise<{ ok: true; invitation: InvitationListItem; token: string } | InviteFailure> {
  if (!input.deliveryReady) return fail(503, "delivery_unavailable", DELIVERY_UNAVAILABLE);
  const email = normalizeInviteEmail(typeof input.email === "string" ? input.email : "");
  if (!isValidInviteEmail(email)) return fail(400, "invalid_email", "Informe um e-mail válido.");
  if (!isAllowedInviteRole(input.role)) return fail(400, "invalid_role", "Escolha um cargo válido para o convite.");
  const role = input.role;
  const token = generateInviteToken();
  try {
    const result = await repo.transaction(async (tx) => {
      // Convites vencidos do mesmo e-mail saem do indice parcial, senao bloqueariam o novo convite.
      await tx.lockClinicInvites(input.clinicId);
      await tx.expireStalePending({ clinicId: input.clinicId, email, now });
      if (await tx.isMemberByEmail({ clinicId: input.clinicId, email })) return fail(409, "already_member", "Este e-mail já faz parte da equipe.");
      if ((await tx.countPending({ clinicId: input.clinicId, now })) >= MAX_PENDING_INVITES_PER_CLINIC) {
        return fail(429, "pending_limit", PENDING_LIMIT);
      }
      if ((await tx.countSentSince({ clinicId: input.clinicId, since: new Date(now.getTime() - INVITE_SEND_WINDOW_MS) })) >= MAX_INVITES_SENT_PER_WINDOW) return fail(429, "window_limit", WINDOW_LIMIT);
      const row = await tx.create({ clinicId: input.clinicId, email, role, tokenHash: hashInviteToken(token), expiresAt: inviteExpiryDate(now), invitedById: input.invitedById, now });
      return { ok: true as const, row };
    });
    if (!result.ok) return result;
    return { ok: true, invitation: toListItem(result.row, now), token };
  } catch (error) {
    if (isP2002(error)) return fail(409, "pending_exists", "Já existe um convite pendente para este e-mail.");
    throw error;
  }
}

export async function resendInvitation(
  repo: InvitationRepo,
  input: { clinicId: string; id: string; deliveryReady: boolean },
  now: Date = new Date(),
): Promise<{ ok: true; invitation: InvitationListItem; token: string; email: string; role: string } | InviteFailure> {
  if (!input.deliveryReady) return fail(503, "delivery_unavailable", DELIVERY_UNAVAILABLE);
  const token = generateInviteToken();
  try {
    const result = await repo.transaction(async (tx) => {
      await tx.lockClinicInvites(input.clinicId);
      const current = await tx.findInClinic({ id: input.id, clinicId: input.clinicId });
      if (!current) return fail(404, "not_found", "Convite não encontrado.");
      if (current.status === "ACCEPTED" || current.status === "CANCELLED") return fail(409, "not_resendable", "Este convite não pode ser reenviado.");
      if (!isAllowedInviteRole(current.role)) return fail(409, "not_resendable", "Este convite não pode ser reenviado.");
      if (await tx.isMemberByEmail({ clinicId: input.clinicId, email: current.email })) return fail(409, "already_member", "Este e-mail já faz parte da equipe.");
      if (current.sendCount >= MAX_INVITE_SENDS) return fail(429, "send_limit", "Limite de envios deste convite atingido.");
      if (now.getTime() - current.lastSentAt.getTime() < MIN_INVITE_RESEND_INTERVAL_MS) return fail(429, "too_soon", "Aguarde um minuto para reenviar o convite.");
      // Volta a PENDING (estava vencido): reaplica o teto de pendentes.
      if (invitationState(current, now) !== "pending" && (await tx.countPending({ clinicId: input.clinicId, now })) >= MAX_PENDING_INVITES_PER_CLINIC) return fail(429, "pending_limit", PENDING_LIMIT);
      if ((await tx.countSentSince({ clinicId: input.clinicId, since: new Date(now.getTime() - INVITE_SEND_WINDOW_MS) })) >= MAX_INVITES_SENT_PER_WINDOW) return fail(429, "window_limit", WINDOW_LIMIT);
      // Outros PENDING vencidos do mesmo e-mail saem do indice parcial (inclusive o proprio, que volta a PENDING abaixo).
      await tx.expireStalePending({ clinicId: input.clinicId, email: current.email, now });
      const count = await tx.rotate({
        id: current.id, clinicId: input.clinicId, tokenHash: hashInviteToken(token), expiresAt: inviteExpiryDate(now), now,
        maxSends: MAX_INVITE_SENDS, sentBefore: new Date(now.getTime() - MIN_INVITE_RESEND_INTERVAL_MS + 1),
      });
      if (count !== 1) return fail(429, "too_soon", "Aguarde um minuto para reenviar o convite.");
      const fresh = await tx.findInClinic({ id: current.id, clinicId: input.clinicId });
      if (!fresh) return fail(404, "not_found", "Convite não encontrado.");
      return { ok: true as const, row: fresh };
    });
    if (!result.ok) return result;
    return { ok: true, invitation: toListItem(result.row, now), token, email: result.row.email, role: result.row.role };
  } catch (error) {
    if (isP2002(error)) return fail(409, "pending_exists", "Já existe um convite pendente para este e-mail.");
    throw error;
  }
}

export async function cancelInvitation(repo: InvitationRepo, input: { clinicId: string; id: string }): Promise<{ ok: true } | InviteFailure> {
  const current = await repo.findInClinic({ id: input.id, clinicId: input.clinicId });
  if (!current) return fail(404, "not_found", "Convite não encontrado.");
  const count = await repo.cancelPending({ id: input.id, clinicId: input.clinicId });
  if (count !== 1) return fail(409, "not_pending", "Só convites pendentes podem ser cancelados.");
  return { ok: true };
}

export async function listInvitations(repo: InvitationRepo, input: { clinicId: string }, now: Date = new Date()): Promise<InvitationListItem[]> {
  const rows = await repo.list(input.clinicId);
  return rows.map((row) => toListItem(row, now));
}

const validTokenShape = (token: unknown): token is string => typeof token === "string" && token.length >= 20 && token.length <= 128;

// Publico: token inexistente, malformado ou de outra forma invalido => sempre null (nao enumera).
export async function previewInvitation(repo: InvitationRepo, token: unknown, now: Date = new Date()) {
  if (!validTokenShape(token)) return null;
  const row = await repo.findByTokenHash(hashInviteToken(token));
  if (!row) return null;
  return { clinicName: row.clinicName, role: row.role, email: row.email, status: invitationState(row, now) };
}

export type AcceptFailureCode = "not_found" | "expired" | "cancelled" | "accepted" | "email_mismatch" | "invalid_role";
export type AcceptResult = { ok: true; alreadyInOtherClinic: boolean } | { ok: false; code: AcceptFailureCode };

// Mesma permissao exigida para ENVIAR convites (POST /api/invitations), reavaliada no momento do aceite.
export async function inviterCanInvite(tx: Pick<InvitationTx, "inviterAccess">, invitation: Pick<InvitationRow, "invitedById" | "clinicId">): Promise<boolean> {
  if (!invitation.invitedById) return false;
  const inviter = await tx.inviterAccess({ userId: invitation.invitedById, clinicId: invitation.clinicId });
  return !!inviter && canForUser({ role: inviter.role, isOwner: inviter.isOwner, rolePermissions: inviter.rolePermissions }, "settings:team");
}

// Nucleo do aceite, dentro de uma transacao ja aberta. O papel vem SEMPRE do convite.
async function acceptInTx(tx: InvitationTx, invitation: InvitationRow, user: { id: string; email: string }, now: Date): Promise<AcceptResult> {
  // emailVerified: true porque o token (enviado so ao e-mail do convite) e a prova de posse da caixa.
  // User.emailVerifiedAt do cadastro por senha NAO e confiavel, por isso nao e consultado.
  const decision = canAcceptInvitation({ invitation, accountEmail: user.email, emailVerified: true, now });
  if (!decision.ok) return { ok: false, code: decision.reason === "email_unverified" ? "email_mismatch" : decision.reason };
  if (!isAllowedInviteRole(invitation.role)) return { ok: false, code: "invalid_role" };
  // Convite sem autor, ou de autor que saiu da clinica / perdeu settings:team, nao vale (mesma resposta generica de convite inexistente).
  if (!(await inviterCanInvite(tx, invitation))) return { ok: false, code: "not_found" };

  // Consumo atomico, amarrado ao tokenHash lido (um reenvio que gira o token invalida este aceite).
  const consumed = await tx.markAccepted({ id: invitation.id, clinicId: invitation.clinicId, tokenHash: invitation.tokenHash, userId: user.id, now });
  if (consumed !== 1) return { ok: false, code: "accepted" };

  const existing = await tx.findMembership({ userId: user.id, clinicId: invitation.clinicId });
  // Ja e membro: convite consumido sem mexer em papel nem isOwner (nunca rebaixa nem promove).
  if (!existing) await tx.createMembership({ userId: user.id, clinicId: invitation.clinicId, role: invitation.role });
  const outside = await tx.countMembershipsOutside({ userId: user.id, clinicId: invitation.clinicId });
  // getCurrentUser usa a primeira membership; a UI avisa ate existir "clinica ativa".
  return { ok: true, alreadyInOtherClinic: outside > 0 };
}

export async function acceptInvitation(
  repo: InvitationRepo,
  input: { token: unknown; user: { id: string; email: string } },
  now: Date = new Date(),
): Promise<AcceptResult> {
  if (!validTokenShape(input.token)) return { ok: false, code: "not_found" };
  const tokenHash = hashInviteToken(input.token);
  return repo.transaction(async (tx) => {
    const invitation = await tx.findByTokenHash(tokenHash);
    if (!invitation) return { ok: false, code: "not_found" } as const;
    return acceptInTx(tx, invitation, input.user, now);
  });
}

export type RegisterByInviteResult =
  | { ok: true; userId: string; alreadyInOtherClinic: boolean }
  | { ok: false; status: 400 | 404 | 409; code: "invalid_input" | "invalid_token" | "account_exists" | "race"; message: string };

// Conta nova por senha para o convidado. O e-mail vem do CONVITE; se ja existe User com ele, recusa
// (anexar membership a conta existente permitiria pre-hijacking).
export async function registerByInvite(
  repo: InvitationRepo,
  input: { token: unknown; name: unknown; password: unknown; cpf?: unknown; postalCode?: unknown; address?: unknown; country?: unknown; state?: unknown; city?: unknown; hashPassword: (password: string) => Promise<string> },
  now: Date = new Date(),
): Promise<RegisterByInviteResult> {
  const password = typeof input.password === "string" ? input.password : "";
  if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 100 || password.length < 8 || password.length > 128) {
    return { ok: false, status: 400, code: "invalid_input", message: "Informe seu nome e uma senha com pelo menos 8 caracteres." };
  }
  const parsed = parseCollaboratorProfile(input);
  if (!parsed.ok) return { ok: false, status: 400, code: "invalid_input", message: parsed.message };
  const { name, ...personal } = parsed.value;
  const invalid = { ok: false, status: 404, code: "invalid_token", message: "Este convite não é válido ou expirou." } as const;
  if (!validTokenShape(input.token)) return invalid;
  const tokenHash = hashInviteToken(input.token);

  // Pre-checagem antes do bcrypt (caro) para nao gastar CPU com token invalido.
  const preflight = await repo.findByTokenHash(tokenHash);
  if (!preflight || invitationState(preflight, now) !== "pending" || !isAllowedInviteRole(preflight.role)) return invalid;
  if (await repo.findUserByEmail(preflight.email)) {
    return { ok: false, status: 409, code: "account_exists", message: "Já existe uma conta com este e-mail. Entre com sua senha e aceite o convite." };
  }
  const passwordHash = await input.hashPassword(password);

  try {
    const result = await repo.transaction(async (tx) => {
      const invitation = await tx.findByTokenHash(tokenHash);
      if (!invitation || invitationState(invitation, now) !== "pending") return invalid;
      if (await tx.findUserByEmail(invitation.email)) {
        return { ok: false, status: 409, code: "account_exists", message: "Já existe uma conta com este e-mail. Entre com sua senha e aceite o convite." } as const;
      }
      const userId = await tx.createUser({ name, email: invitation.email, passwordHash, now, ...personal });
      const accepted = await acceptInTx(tx, invitation, { id: userId, email: invitation.email }, now);
      // Falha no aceite desfaz tambem a criacao do usuario.
      if (!accepted.ok) throw new RollbackError();
      return { ok: true, userId, alreadyInOtherClinic: accepted.alreadyInOtherClinic } as const;
    });
    return result;
  } catch (error) {
    if (error instanceof RollbackError) return invalid;
    if (isP2002(error)) return { ok: false, status: 409, code: "race", message: "Já existe uma conta com este e-mail. Entre com sua senha e aceite o convite." };
    throw error;
  }
}

class RollbackError extends Error {}

export type GoogleInviteResult =
  | { ok: true; userId: string }
  | { ok: false; code: "invite_invalid" | "invite_email_mismatch" | "account_exists" | "race" };

// Aceite via Google para quem ainda NAO tem conta: User + UserIdentity + aceite na MESMA transacao.
// Prova dupla: o token (enviado so ao e-mail do convite) e o e-mail verificado pelo Google. Se ja existe
// User com esse e-mail, recusa (nao vincula: pre-hijacking). Falha no aceite desfaz a criacao do User.
export async function registerGoogleByInvite(
  repo: InvitationRepo,
  input: { token: unknown; google: { sub: string; email: string }; profile: CollaboratorProfile; passwordHash: string; expect?: { invitationId: string; clinicId: string } },
  now: Date = new Date(),
): Promise<GoogleInviteResult> {
  if (!validTokenShape(input.token)) return { ok: false, code: "invite_invalid" };
  const tokenHash = hashInviteToken(input.token);
  const { name, ...personal } = input.profile;
  try {
    return await repo.transaction(async (tx): Promise<GoogleInviteResult> => {
      const invitation = await tx.findByTokenHash(tokenHash);
      if (!invitation || invitationState(invitation, now) !== "pending" || !isAllowedInviteRole(invitation.role)) return { ok: false, code: "invite_invalid" };
      // O convite lido pelo token tem de ser o mesmo que o callback do Google validou (mesma clinica).
      if (input.expect && (invitation.id !== input.expect.invitationId || invitation.clinicId !== input.expect.clinicId)) return { ok: false, code: "invite_invalid" };
      if (normalizeInviteEmail(input.google.email) !== normalizeInviteEmail(invitation.email)) return { ok: false, code: "invite_email_mismatch" };
      if (await tx.findUserByEmail(invitation.email)) return { ok: false, code: "account_exists" };
      const userId = await tx.createUser({ name, email: invitation.email, passwordHash: input.passwordHash, now, ...personal });
      await tx.createIdentity({ userId, provider: "google", sub: input.google.sub, email: invitation.email, now });
      const accepted = await acceptInTx(tx, invitation, { id: userId, email: invitation.email }, now);
      if (!accepted.ok) throw new RollbackError();
      return { ok: true, userId };
    });
  } catch (error) {
    if (error instanceof RollbackError) return { ok: false, code: "invite_invalid" };
    if (isP2002(error)) return { ok: false, code: "race" };
    throw error;
  }
}

export type PendingGoogleInvite = { invite: string; invitationId: string; clinicId: string; sub: string; email: string };

// Conclusao do cadastro Google: a identidade ja foi provada no callback (cookie assinado `pending`);
// aqui entram so os dados pessoais, validados pela mesma regra do cadastro direto.
export async function completeGoogleInvite(
  repo: InvitationRepo,
  input: { pending: PendingGoogleInvite; profile: Record<string, unknown> | null; makePasswordHash: () => Promise<string> },
  now: Date = new Date(),
): Promise<GoogleInviteResult | { ok: false; code: "invalid_profile"; message: string }> {
  const parsed = parseCollaboratorProfile(input.profile);
  if (!parsed.ok) return { ok: false, code: "invalid_profile", message: parsed.message };
  // bcrypt (caro) so depois de o perfil passar: perfil invalido nao gasta CPU.
  const passwordHash = await input.makePasswordHash();
  return registerGoogleByInvite(repo, {
    token: input.pending.invite,
    google: { sub: input.pending.sub, email: input.pending.email },
    profile: parsed.value,
    passwordHash,
    expect: { invitationId: input.pending.invitationId, clinicId: input.pending.clinicId },
  }, now);
}

export type DeliveryDeps = {
  // Verdadeiro so fora de producao: em producao a URL nunca volta ao admin (o token criaria conta com a senha dele).
  revealUrl: boolean;
  buildUrl: (token: string) => string | null;
  send: (input: { to: string; clinicName: string; inviterName: string; role: string; url: string | null }) => Promise<EmailResult>;
};

// Envia o e-mail; fora de producao e sem provedor configurado, devolve a URL para testes manuais.
export async function deliverInvitation(
  deps: DeliveryDeps,
  input: { token: string; email: string; role: string; clinicName: string; inviterName: string },
): Promise<{ emailSent: boolean; inviteUrl?: string; emailFailureReason?: EmailFailureReason }> {
  const url = deps.buildUrl(input.token);
  const result = await deps.send({ to: input.email, clinicName: input.clinicName, inviterName: input.inviterName, role: input.role, url });
  if (result.sent) return { emailSent: true };
  // emailFailureReason e um codigo estavel (so vai ao admin com settings:team); nada da resposta do provedor passa daqui.
  if (result.reason === "not_configured" && url && deps.revealUrl) return { emailSent: false, emailFailureReason: result.reason, inviteUrl: url };
  return { emailSent: false, emailFailureReason: result.reason };
}
