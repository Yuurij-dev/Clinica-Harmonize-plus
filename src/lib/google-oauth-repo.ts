import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { prisma } from "./prisma";
import type { GoogleRepo } from "./google-oauth-flow.ts";

// Persistencia do login com Google (Prisma). Separado de google-oauth.ts para a parte de rede ser testavel sem banco.

// Senha inutilizavel: bcrypt (custo 12) de 32 bytes aleatorios que ninguem conhece.
export const makeUnusablePasswordHash = () => hash(randomBytes(32).toString("base64url"), 12);

export const prismaGoogleRepo: GoogleRepo = {
  async findIdentity(sub) {
    return prisma.userIdentity.findUnique({ where: { provider_providerSubject: { provider: "google", providerSubject: sub } }, select: { userId: true } });
  },
  async findUserByEmail(email) {
    return prisma.user.findUnique({ where: { email }, select: { id: true } });
  },
  async hasMembership(userId) {
    return (await prisma.clinicMembership.count({ where: { userId } })) > 0;
  },
  async getUserAccess(userId) {
    return prisma.user.findUnique({ where: { id: userId }, select: { email: true, lockedUntil: true, mustChangePassword: true } });
  },
  async touchIdentity(sub, now) {
    await prisma.userIdentity.update({ where: { provider_providerSubject: { provider: "google", providerSubject: sub } }, data: { lastLoginAt: now } });
  },
  async linkIdentity({ userId, sub, email, now }) {
    await prisma.userIdentity.create({ data: { userId, provider: "google", providerSubject: sub, email, lastLoginAt: now } });
  },
  async createUserWithIdentity({ name, email, sub, passwordHash, now }) {
    // role legado de User: menor privilegio; o acesso real vem de ClinicMembership (nao criada aqui).
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { name, email, passwordHash, emailVerifiedAt: now, role: "STAFF" }, select: { id: true } });
      await tx.userIdentity.create({ data: { userId: user.id, provider: "google", providerSubject: sub, email, lastLoginAt: now } });
      return user.id;
    });
  },
};
