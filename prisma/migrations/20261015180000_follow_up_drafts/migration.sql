CREATE TABLE "PatientProcedureFollowUpDraft" (
  "sessionId" TEXT NOT NULL,
  "guidanceText" TEXT NOT NULL DEFAULT '',
  "guidanceConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "observations" TEXT NOT NULL DEFAULT '',
  "complications" TEXT NOT NULL DEFAULT '',
  "photos" TEXT NOT NULL DEFAULT '[]',
  "appointmentId" TEXT,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PatientProcedureFollowUpDraft_pkey" PRIMARY KEY ("sessionId")
);

ALTER TABLE "PatientProcedureFollowUpDraft"
  ADD CONSTRAINT "PatientProcedureFollowUpDraft_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "PatientProcedureSession"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
