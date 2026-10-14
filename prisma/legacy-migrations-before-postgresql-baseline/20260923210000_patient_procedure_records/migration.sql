CREATE TABLE IF NOT EXISTS "PatientProcedure" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT,
  "patientId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "professional" TEXT NOT NULL,
  "performedAt" TIMESTAMPTZ(6) NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '',
  "beforePhoto" TEXT,
  "afterPhoto" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PatientProcedure_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PatientProcedure_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "PatientProcedure_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX IF NOT EXISTS "PatientProcedure_clinicId_idx" ON "PatientProcedure"("clinicId");
CREATE INDEX IF NOT EXISTS "PatientProcedure_patientId_performedAt_idx" ON "PatientProcedure"("patientId", "performedAt");
