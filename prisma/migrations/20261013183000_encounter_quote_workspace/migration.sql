ALTER TABLE "Quote"
  ADD COLUMN "evaluationId" TEXT,
  ADD COLUMN "details" TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN "notes" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "installments" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "createdBy" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "updatedBy" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "approvedBy" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMPTZ(6),
  ADD COLUMN "sentBy" TEXT,
  ADD COLUMN "sentAt" TIMESTAMPTZ(6),
  ADD COLUMN "refusedBy" TEXT,
  ADD COLUMN "refusedAt" TIMESTAMPTZ(6),
  ADD COLUMN "cancelledBy" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMPTZ(6);

CREATE INDEX "Quote_evaluationId_idx" ON "Quote"("evaluationId");

ALTER TABLE "Quote"
  ADD CONSTRAINT "Quote_evaluationId_fkey"
  FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
