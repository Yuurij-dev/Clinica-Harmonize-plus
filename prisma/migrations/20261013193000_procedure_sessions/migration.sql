CREATE TABLE "PatientProcedureSession" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "journeyId" TEXT NOT NULL,
  "evaluationId" TEXT NOT NULL,
  "procedureId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "procedureName" TEXT NOT NULL,
  "technique" TEXT NOT NULL DEFAULT '',
  "treatedAreas" TEXT NOT NULL DEFAULT '',
  "professional" TEXT NOT NULL,
  "performedAt" TIMESTAMPTZ(6) NOT NULL,
  "startedAt" TIMESTAMPTZ(6),
  "endedAt" TIMESTAMPTZ(6),
  "estimatedMinutes" INTEGER,
  "durationMinutes" INTEGER,
  "anesthesia" TEXT NOT NULL DEFAULT '',
  "complications" TEXT NOT NULL DEFAULT '',
  "observations" TEXT NOT NULL DEFAULT '',
  "materials" TEXT NOT NULL DEFAULT '[]',
  "photos" TEXT NOT NULL DEFAULT '[]',
  "auditLog" TEXT NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'Rascunho',
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  "completedBy" TEXT,
  "completedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PatientProcedureSession_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "StockMovement" ADD COLUMN "procedureSessionId" TEXT;
ALTER TABLE "PendingStockOutput" ADD COLUMN "procedureSessionId" TEXT;

CREATE INDEX "PatientProcedureSession_clinicId_patientId_performedAt_idx" ON "PatientProcedureSession"("clinicId", "patientId", "performedAt");
CREATE INDEX "PatientProcedureSession_journeyId_performedAt_idx" ON "PatientProcedureSession"("journeyId", "performedAt");
CREATE INDEX "PatientProcedureSession_procedureId_performedAt_idx" ON "PatientProcedureSession"("procedureId", "performedAt");
CREATE INDEX "PatientProcedureSession_evaluationId_idx" ON "PatientProcedureSession"("evaluationId");
CREATE INDEX "PatientProcedureSession_quoteId_idx" ON "PatientProcedureSession"("quoteId");
CREATE INDEX "StockMovement_procedureSessionId_idx" ON "StockMovement"("procedureSessionId");
CREATE INDEX "PendingStockOutput_procedureSessionId_idx" ON "PendingStockOutput"("procedureSessionId");

ALTER TABLE "PatientProcedureSession" ADD CONSTRAINT "PatientProcedureSession_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "PatientProcedureSession" ADD CONSTRAINT "PatientProcedureSession_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "PatientProcedureSession" ADD CONSTRAINT "PatientProcedureSession_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "PatientJourney"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "PatientProcedureSession" ADD CONSTRAINT "PatientProcedureSession_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "PatientProcedureSession" ADD CONSTRAINT "PatientProcedureSession_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "PatientProcedure"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "PatientProcedureSession" ADD CONSTRAINT "PatientProcedureSession_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_procedureSessionId_fkey" FOREIGN KEY ("procedureSessionId") REFERENCES "PatientProcedureSession"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "PendingStockOutput" ADD CONSTRAINT "PendingStockOutput_procedureSessionId_fkey" FOREIGN KEY ("procedureSessionId") REFERENCES "PatientProcedureSession"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
