-- Observações da equipe sobre o paciente.
CREATE TABLE IF NOT EXISTS "PatientObservation" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "authorName" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatientObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PatientObservation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX IF NOT EXISTS "PatientObservation_clinicId_patientId_createdAt_idx" ON "PatientObservation"("clinicId", "patientId", "createdAt");
