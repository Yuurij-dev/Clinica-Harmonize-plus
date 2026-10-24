ALTER TABLE "Evaluation"
  ADD COLUMN "chiefComplaint" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "patientGoal" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "medicalHistory" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "allergies" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "contraindications" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "previousProcedures" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "clinicalNotes" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'Concluída';

ALTER TABLE "Evaluation" ALTER COLUMN "status" SET DEFAULT 'Rascunho';

ALTER TABLE "EvaluationPhoto"
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'Outra',
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
