import { prisma } from "./prisma";
import type { SignupRepo } from "./google-signup.ts";

export const prismaSignupRepo: SignupRepo = {
  transaction: (fn) =>
    prisma.$transaction((tx) =>
      fn({
        findUserByEmail: (email) => tx.user.findUnique({ where: { email }, select: { id: true } }),
        findIdentity: (sub) => tx.userIdentity.findUnique({ where: { provider_providerSubject: { provider: "google", providerSubject: sub } }, select: { userId: true } }),
        async createClinicOwner({ clinicName, slug, trialStartedAt, trialEndsAt, user, sub, now }) {
          const clinic = await tx.clinic.create({ data: { name: clinicName, slug, trialStartedAt, trialEndsAt }, select: { id: true } });
          const created = await tx.user.create({ data: { ...user, emailVerifiedAt: now, role: "ADMIN" }, select: { id: true } });
          await tx.userIdentity.create({ data: { userId: created.id, provider: "google", providerSubject: sub, email: user.email, lastLoginAt: now } });
          await tx.clinicMembership.create({ data: { userId: created.id, clinicId: clinic.id, role: "ADMIN", isOwner: true } });
          return created.id;
        },
      }),
    ),
};
