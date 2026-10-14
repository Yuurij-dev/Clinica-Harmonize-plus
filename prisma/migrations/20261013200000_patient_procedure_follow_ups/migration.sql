CREATE TABLE "PatientProcedureFollowUp" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "professional" TEXT NOT NULL,
    "guidanceText" TEXT NOT NULL DEFAULT '',
    "guidanceSentAt" TIMESTAMPTZ(6),
    "observations" TEXT NOT NULL DEFAULT '',
    "complications" TEXT NOT NULL DEFAULT '',
    "photos" TEXT NOT NULL DEFAULT '[]',
    "auditLog" TEXT NOT NULL DEFAULT '[]',
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "PatientProcedureFollowUp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PatientProcedureFollowUp_appointmentId_key" ON "PatientProcedureFollowUp"("appointmentId");
CREATE INDEX "PatientProcedureFollowUp_clinicId_patientId_occurredAt_idx" ON "PatientProcedureFollowUp"("clinicId", "patientId", "occurredAt");
CREATE INDEX "PatientProcedureFollowUp_journeyId_occurredAt_idx" ON "PatientProcedureFollowUp"("journeyId", "occurredAt");
CREATE INDEX "PatientProcedureFollowUp_sessionId_occurredAt_idx" ON "PatientProcedureFollowUp"("sessionId", "occurredAt");

ALTER TABLE "PatientProcedureFollowUp" ADD CONSTRAINT "PatientProcedureFollowUp_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "PatientProcedureFollowUp" ADD CONSTRAINT "PatientProcedureFollowUp_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "PatientProcedureFollowUp" ADD CONSTRAINT "PatientProcedureFollowUp_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "PatientJourney"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "PatientProcedureFollowUp" ADD CONSTRAINT "PatientProcedureFollowUp_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PatientProcedureSession"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "PatientProcedureFollowUp" ADD CONSTRAINT "PatientProcedureFollowUp_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
