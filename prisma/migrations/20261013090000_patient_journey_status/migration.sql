ALTER TABLE "PatientJourney"
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'Em andamento';

UPDATE "PatientJourney"
SET "status" = 'Cancelado'
WHERE "archivedAt" IS NOT NULL;
