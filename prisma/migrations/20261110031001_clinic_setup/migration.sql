-- CreateTable
CREATE TABLE "ClinicSetup" (
    "clinicId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "currentStep" TEXT NOT NULL DEFAULT 'clinica',
    "decisions" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMPTZ(6),
    "dismissedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicSetup_pkey" PRIMARY KEY ("clinicId")
);

-- AddForeignKey
ALTER TABLE "ClinicSetup" ADD CONSTRAINT "ClinicSetup_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
