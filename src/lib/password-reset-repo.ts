// Armazenamento da recuperação de senha (Prisma). Recebe o client para os testes de concorrência usarem o banco local.
import type { Prisma, PrismaClient } from "@prisma/client";
import type { PasswordResetRepo, ResetUser } from "./password-reset-flow.ts";

const userSelect = {
  id: true,
  email: true,
  createdAt: true,
  identities: { where: { provider: "google" }, select: { createdAt: true }, take: 1 },
} satisfies Prisma.UserSelect;

const toResetUser = ({ identities, ...user }: Prisma.UserGetPayload<{ select: typeof userSelect }>): ResetUser =>
  ({ ...user, googleIdentityCreatedAt: identities[0]?.createdAt ?? null });

// FOR UPDATE (e não o lock comum de um update): também segura o INSERT de AuthSession/TrustedDevice deste usuário (FK) até o commit.
const lockUser = (tx: Prisma.TransactionClient, userId: string) => tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;

/** Invalida os links de redefinição pendentes (nova solicitação ou senha trocada por outro caminho). */
export function invalidatePendingResetTokens(db: Pick<PrismaClient, "passwordResetToken">, userId: string, now = new Date()) {
  return db.passwordResetToken.updateMany({ where: { userId, usedAt: null, invalidatedAt: null }, data: { invalidatedAt: now } });
}

/**
 * Cria a AuthSession só se o hash da senha ainda for o conferido no login. FOR SHARE espera uma redefinição em andamento (que
 * trava a linha com FOR UPDATE) e lê o hash já novo; se vier antes, a redefinição espera este INSERT e revoga a sessão.
 */
export function createSessionIfPasswordUnchanged(db: PrismaClient, passwordHash: string, data: Prisma.AuthSessionUncheckedCreateInput) {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ passwordHash: string }[]>`SELECT "passwordHash" FROM "User" WHERE "id" = ${data.userId} FOR SHARE`;
    if (rows[0]?.passwordHash !== passwordHash) return null;
    return tx.authSession.create({ data, select: { id: true } });
  });
}

// Upsert numa instrução só: pedidos simultâneos contam todos (em transação, esperam o commit de quem veio antes).
async function bump(db: Pick<PrismaClient, "$queryRaw">, key: string, windowMs: number, now: Date) {
  const current = now.toISOString();
  const next = new Date(now.getTime() + windowMs).toISOString();
  const rows = await db.$queryRaw<{ hits: number }[]>`
    INSERT INTO "PasswordResetRateLimit" AS r ("key", "hits", "expiresAt")
    VALUES (${key}, 1, ${next}::timestamptz)
    ON CONFLICT ("key") DO UPDATE SET
      "hits" = CASE WHEN r."expiresAt" <= ${current}::timestamptz THEN 1 ELSE r."hits" + 1 END,
      "expiresAt" = CASE WHEN r."expiresAt" <= ${current}::timestamptz THEN EXCLUDED."expiresAt" ELSE r."expiresAt" END
    RETURNING "hits"`;
  return rows[0].hits;
}

const overLimit = Symbol("over-limit");

export function createPrismaPasswordResetRepo(db: PrismaClient): PasswordResetRepo {
  return {
    hit: (key, windowMs, now) => bump(db, key, windowMs, now),
    async hitAll(entries, now) {
      try {
        await db.$transaction(async (tx) => {
          // Passou do limite: desfaz a transação inteira, sem gastar nenhuma das chaves.
          for (const entry of entries) if (await bump(tx, entry.key, entry.windowMs, now) > entry.limit) throw overLimit;
        });
        return true;
      } catch (error) {
        if (error === overLimit) return false;
        throw error;
      }
    },
    async cleanup(now) {
      await db.passwordResetRateLimit.deleteMany({ where: { expiresAt: { lte: now } } });
      await db.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } });
    },
    async findUserByEmail(email) {
      const user = await db.user.findUnique({ where: { email }, select: userSelect });
      return user ? toResetUser(user) : null;
    },
    createToken({ userId, tokenHash, expiresAt, now }) {
      return db.$transaction(async (tx) => {
        await lockUser(tx, userId);
        await invalidatePendingResetTokens(tx, userId, now);
        return (await tx.passwordResetToken.create({ data: { userId, tokenHash, expiresAt, createdAt: now }, select: { id: true } })).id;
      });
    },
    async invalidateToken(id, now) {
      await db.passwordResetToken.updateMany({ where: { id, usedAt: null, invalidatedAt: null }, data: { invalidatedAt: now } });
    },
    async findToken(tokenHash) {
      const row = await db.passwordResetToken.findUnique({
        where: { tokenHash },
        select: { id: true, expiresAt: true, usedAt: true, invalidatedAt: true, user: { select: userSelect } },
      });
      return row ? { ...row, user: toResetUser(row.user) } : null;
    },
    consume({ tokenId, userId, passwordHash }) {
      return db.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const now = new Date();
        // Uso único: das requisições simultâneas, só uma encontra o token ainda livre.
        const claimed = await tx.passwordResetToken.updateMany({
          where: { id: tokenId, userId, usedAt: null, invalidatedAt: null, expiresAt: { gt: now } },
          data: { usedAt: now },
        });
        if (claimed.count !== 1) return null;
        await tx.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false, failedLogins: 0, lockedUntil: null }, select: { id: true } });
        // Quem recebeu o link provou a posse do e-mail.
        await tx.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: now } });
        await invalidatePendingResetTokens(tx, userId, now);
        const sessions = await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
        const devices = await tx.trustedDevice.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
        await tx.loginVerificationCode.deleteMany({ where: { userId } });
        return { sessions: sessions.count, devices: devices.count };
      });
    },
  };
}
