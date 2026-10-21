-- CreateTable
CREATE TABLE "PatientAnamnesis" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RASCUNHO',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "content" TEXT NOT NULL DEFAULT '{}',
    "origin" TEXT NOT NULL DEFAULT 'empty',
    "basedOnVersion" INTEGER,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "completedBy" TEXT,
    "completedAt" TIMESTAMPTZ(6),
    "reviewRequestedBy" TEXT,
    "reviewRequestedAt" TIMESTAMPTZ(6),
    "reviewReason" TEXT NOT NULL DEFAULT '',
    "reviewConfirmedBy" TEXT,
    "reviewConfirmedAt" TIMESTAMPTZ(6),
    "auditLog" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PatientAnamnesis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientAnamnesis_clinicId_patientId_status_idx" ON "PatientAnamnesis"("clinicId", "patientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PatientAnamnesis_patientId_version_key" ON "PatientAnamnesis"("patientId", "version");

-- AddForeignKey
ALTER TABLE "PatientAnamnesis" ADD CONSTRAINT "PatientAnamnesis_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PatientAnamnesis" ADD CONSTRAINT "PatientAnamnesis_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
