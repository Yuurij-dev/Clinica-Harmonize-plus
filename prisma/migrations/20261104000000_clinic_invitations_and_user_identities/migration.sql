-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "UserIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMPTZ(6),

    CONSTRAINT "UserIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicInvitation" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "invitedById" TEXT,
    "acceptedById" TEXT,
    "acceptedAt" TIMESTAMPTZ(6),
    "lastSentAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserIdentity_userId_idx" ON "UserIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserIdentity_provider_providerSubject_key" ON "UserIdentity"("provider", "providerSubject");

-- CreateIndex
CREATE UNIQUE INDEX "UserIdentity_userId_provider_key" ON "UserIdentity"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicInvitation_tokenHash_key" ON "ClinicInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "ClinicInvitation_clinicId_status_idx" ON "ClinicInvitation"("clinicId", "status");

-- CreateIndex
CREATE INDEX "ClinicInvitation_email_idx" ON "ClinicInvitation"("email");

-- AddForeignKey
ALTER TABLE "UserIdentity" ADD CONSTRAINT "UserIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ClinicInvitation" ADD CONSTRAINT "ClinicInvitation_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ClinicInvitation" ADD CONSTRAINT "ClinicInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ClinicInvitation" ADD CONSTRAINT "ClinicInvitation_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION;


-- Indice unico PARCIAL (nao declarado no schema.prisma: o Prisma nao suporta indices parciais).
-- Impede dois convites PENDING para o mesmo e-mail (case-insensitive) na mesma clinica.
-- Convites ACCEPTED/EXPIRED/CANCELLED nao entram no indice, entao o historico e preservado.
CREATE UNIQUE INDEX "ClinicInvitation_pending_email_clinic_key"
  ON "ClinicInvitation" (lower("email"), "clinicId")
  WHERE "status" = 'PENDING';
