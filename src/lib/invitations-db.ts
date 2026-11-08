import { prisma } from "./prisma";
import { createPrismaInvitationRepo } from "./invitations-repo.ts";

// Singleton usado pelas rotas.
export const prismaInvitationRepo = createPrismaInvitationRepo(prisma);
