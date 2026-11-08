import type { Prisma, PrismaClient } from "@prisma/client";
import type { InvitationRepo, InvitationTx } from "./invitations.ts";

// Persistencia de convites (Prisma). Fabrica que recebe o PrismaClient (testavel contra o banco local sem o alias @/). Toda consulta/atualizacao por id inclui clinicId.

const rowSelect = {
  id: true, clinicId: true, email: true, role: true, tokenHash: true, status: true, expiresAt: true,
  invitedById: true, acceptedById: true, acceptedAt: true, lastSentAt: true, sendCount: true, createdAt: true,
} as const;

type Client = Prisma.TransactionClient;

function makeTx(db: Client): InvitationTx {
  return {
    async lockClinicInvites(clinicId) {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"invite:" + clinicId}))`;
    },
    async countSentSince({ clinicId, since }) {
      return db.clinicInvitation.count({ where: { clinicId, lastSentAt: { gte: since } } });
    },
    async expireStalePending({ clinicId, email, now }) {
      await db.clinicInvitation.updateMany({ where: { clinicId, email, status: "PENDING", expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
    },
    async isMemberByEmail({ clinicId, email }) {
      return (await db.clinicMembership.count({ where: { clinicId, user: { email } } })) > 0;
    },
    async countPending({ clinicId, now }) {
      return db.clinicInvitation.count({ where: { clinicId, status: "PENDING", expiresAt: { gt: now } } });
    },
    async create({ clinicId, email, role, tokenHash, expiresAt, invitedById, now }) {
      return db.clinicInvitation.create({ data: { clinicId, email, role, tokenHash, expiresAt, invitedById, lastSentAt: now }, select: rowSelect });
    },
    async findInClinic({ id, clinicId }) {
      return db.clinicInvitation.findFirst({ where: { id, clinicId }, select: rowSelect });
    },
    async rotate({ id, clinicId, tokenHash, expiresAt, now, maxSends, sentBefore }) {
      const { count } = await db.clinicInvitation.updateMany({
        where: { id, clinicId, status: { in: ["PENDING", "EXPIRED"] }, sendCount: { lt: maxSends }, lastSentAt: { lt: sentBefore } },
        data: { status: "PENDING", tokenHash, expiresAt, lastSentAt: now, sendCount: { increment: 1 } },
      });
      return count;
    },
    async cancelPending({ id, clinicId }) {
      const { count } = await db.clinicInvitation.updateMany({ where: { id, clinicId, status: "PENDING" }, data: { status: "CANCELLED" } });
      return count;
    },
    async findByTokenHash(tokenHash) {
      const row = await db.clinicInvitation.findUnique({ where: { tokenHash }, select: { ...rowSelect, clinic: { select: { name: true } } } });
      if (!row) return null;
      const { clinic, ...rest } = row;
      return { ...rest, clinicName: clinic.name };
    },
    async markAccepted({ id, clinicId, tokenHash, userId, now }) {
      const { count } = await db.clinicInvitation.updateMany({
        where: { id, clinicId, tokenHash, status: "PENDING", expiresAt: { gt: now } },
        data: { status: "ACCEPTED", acceptedById: userId, acceptedAt: now },
      });
      return count;
    },
    async findMembership({ userId, clinicId }) {
      return db.clinicMembership.findUnique({ where: { userId_clinicId: { userId, clinicId } }, select: { id: true } });
    },
    async inviterAccess({ userId, clinicId }) {
      const row = await db.clinicMembership.findUnique({
        where: { userId_clinicId: { userId, clinicId } },
        select: { role: true, isOwner: true, clinic: { select: { rolePermissions: true } } },
      });
      return row ? { role: row.role, isOwner: row.isOwner, rolePermissions: row.clinic.rolePermissions } : null;
    },
    async countMembershipsOutside({ userId, clinicId }) {
      return db.clinicMembership.count({ where: { userId, clinicId: { not: clinicId } } });
    },
    async createMembership({ userId, clinicId, role }) {
      await db.clinicMembership.create({ data: { userId, clinicId, role, isOwner: false } });
    },
    async findUserByEmail(email) {
      return db.user.findUnique({ where: { email }, select: { id: true } });
    },
    async createIdentity({ userId, provider, sub, email, now }) {
      await db.userIdentity.create({ data: { userId, provider, providerSubject: sub, email, lastLoginAt: now } });
    },
    async createUser({ name, email, passwordHash, now, cpf, postalCode, address, country, state, city }) {
      // role legado de User: menor privilegio; o acesso real vem de ClinicMembership.
      return (await db.user.create({ data: { name, email, passwordHash, emailVerifiedAt: now, role: "STAFF", cpf, postalCode, address, country, state, city }, select: { id: true } })).id;
    },
  };
}

export function createPrismaInvitationRepo(client: PrismaClient): InvitationRepo {
  return {
  ...makeTx(client),
  transaction: (fn) => client.$transaction((tx) => fn(makeTx(tx))),
  async list(clinicId) {
    const rows = await client.clinicInvitation.findMany({
      where: { clinicId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, email: true, role: true, status: true, expiresAt: true, createdAt: true, lastSentAt: true, sendCount: true, invitedBy: { select: { name: true } } },
    });
    return rows.map(({ invitedBy, ...row }) => ({ ...row, invitedByName: invitedBy?.name ?? null }));
  },
};
}

// B3: ao remover/rebaixar um membro, seus convites PENDING NA CLINICA deixam de valer.
// Recebe o client (ou o client da transacao) e sempre filtra por clinicId.
export async function cancelPendingByInviter(db: Pick<Client, "clinicInvitation">, input: { clinicId: string; invitedById: string }): Promise<number> {
  const { count } = await db.clinicInvitation.updateMany({
    where: { clinicId: input.clinicId, invitedById: input.invitedById, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  return count;
}

// Ao remover um membro, o convite que ELE aceitou nesta clinica perde o sentido (ninguem mais na equipe por ele):
// e apagado para nao ficar pendurado como "Aceito". Precisa rodar ANTES de apagar o usuario, enquanto acceptedById
// ainda aponta para ele (o onDelete: SetNull zeraria o vinculo). Sempre escopado por clinicId.
export async function deleteAcceptedByAccepter(db: Pick<Client, "clinicInvitation">, input: { clinicId: string; acceptedById: string }): Promise<number> {
  const { count } = await db.clinicInvitation.deleteMany({
    where: { clinicId: input.clinicId, acceptedById: input.acceptedById, status: "ACCEPTED" },
  });
  return count;
}
