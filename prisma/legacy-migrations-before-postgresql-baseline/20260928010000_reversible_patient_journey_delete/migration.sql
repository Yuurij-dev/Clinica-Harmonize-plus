ALTER TABLE "PatientJourney" ADD COLUMN "archivedAt" TIMESTAMPTZ(6);

CREATE INDEX "PatientJourney_patientId_archivedAt_idx" ON "PatientJourney"("patientId", "archivedAt");
