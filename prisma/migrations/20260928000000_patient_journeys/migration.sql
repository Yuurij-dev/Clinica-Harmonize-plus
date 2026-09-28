CREATE TABLE "PatientJourney" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "clinicId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PatientJourney_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PatientJourney_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "PatientJourney_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

ALTER TABLE "Appointment" ADD COLUMN "journeyId" TEXT;
ALTER TABLE "PatientProcedure" ADD COLUMN "journeyId" TEXT;
ALTER TABLE "Evaluation" ADD COLUMN "journeyId" TEXT;
ALTER TABLE "Quote" ADD COLUMN "journeyId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "journeyId" TEXT;

INSERT INTO "PatientJourney" ("id", "patientId", "clinicId", "name")
SELECT md5(p."id" || ':journey-1'), p."id", p."clinicId", 'Jornada 1'
FROM "Patient" p
WHERE NOT EXISTS (
    SELECT 1 FROM "PatientJourney" j WHERE j."patientId" = p."id"
);

UPDATE "Appointment" a SET "journeyId" = j."id"
FROM "PatientJourney" j
WHERE a."journeyId" IS NULL AND a."patientId" = j."patientId";

UPDATE "PatientProcedure" p SET "journeyId" = j."id"
FROM "PatientJourney" j
WHERE p."journeyId" IS NULL AND p."patientId" = j."patientId";

UPDATE "Evaluation" e SET "journeyId" = j."id"
FROM "PatientJourney" j
WHERE e."journeyId" IS NULL AND e."patientId" = j."patientId";

UPDATE "Quote" q SET "journeyId" = j."id"
FROM "PatientJourney" j
WHERE q."journeyId" IS NULL AND q."patientId" = j."patientId";

UPDATE "Payment" p SET "journeyId" = j."id"
FROM "PatientJourney" j
WHERE p."journeyId" IS NULL AND p."patientId" = j."patientId";

ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "PatientJourney"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "PatientProcedure" ADD CONSTRAINT "PatientProcedure_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "PatientJourney"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "PatientJourney"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "PatientJourney"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "PatientJourney"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE INDEX "PatientJourney_patientId_createdAt_idx" ON "PatientJourney"("patientId", "createdAt");
CREATE INDEX "PatientJourney_clinicId_idx" ON "PatientJourney"("clinicId");
CREATE INDEX "Appointment_journeyId_date_idx" ON "Appointment"("journeyId", "date");
CREATE INDEX "PatientProcedure_journeyId_performedAt_idx" ON "PatientProcedure"("journeyId", "performedAt");
CREATE INDEX "Evaluation_journeyId_idx" ON "Evaluation"("journeyId");
CREATE INDEX "Quote_journeyId_idx" ON "Quote"("journeyId");
CREATE INDEX "Payment_journeyId_idx" ON "Payment"("journeyId");
