ALTER TABLE "Evaluation"
  ADD COLUMN "pregnancyStatus" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "anticoagulantUse" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "autoimmuneDiseases" TEXT NOT NULL DEFAULT '';
