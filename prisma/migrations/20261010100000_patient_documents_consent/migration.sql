CREATE TABLE "PatientDocument" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'file',
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileData" TEXT,
  "consentText" TEXT,
  "signatureData" TEXT,
  "signedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatientDocument_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Clinic" ADD COLUMN "consentTemplate" TEXT;

CREATE INDEX "PatientDocument_clinicId_patientId_createdAt_idx" ON "PatientDocument"("clinicId", "patientId", "createdAt");

ALTER TABLE "PatientDocument" ADD CONSTRAINT "PatientDocument_clinicId_fkey"
  FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "PatientDocument" ADD CONSTRAINT "PatientDocument_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
