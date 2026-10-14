-- Bloqueio de login após tentativas erradas.
ALTER TABLE "User" ADD COLUMN     "failedLogins" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMPTZ(6);

-- Pagamentos e orçamentos passam a guardar centavos (antes: reais inteiros).
ALTER TABLE "Payment" RENAME COLUMN "value" TO "valueCents";
UPDATE "Payment" SET "valueCents" = "valueCents" * 100;
ALTER TABLE "Quote" RENAME COLUMN "total" TO "totalCents";
UPDATE "Quote" SET "totalCents" = "totalCents" * 100;

-- Procedimento gerado por orçamento: o vínculo sai de notes ("__quote:<id>") para quoteId único.
ALTER TABLE "PatientProcedure" ADD COLUMN     "quoteId" TEXT;
UPDATE "PatientProcedure" SET "quoteId" = substring("notes" from 9)
WHERE "id" IN (
  SELECT DISTINCT ON (substring("notes" from 9)) "id" FROM "PatientProcedure"
  WHERE "notes" LIKE '\_\_quote:%' ORDER BY substring("notes" from 9), "createdAt"
);
UPDATE "PatientProcedure" SET "notes" = '' WHERE "notes" LIKE '\_\_quote:%';
CREATE UNIQUE INDEX "PatientProcedure_quoteId_key" ON "PatientProcedure"("quoteId");

-- Data do agendamento passa a ser sempre meio-dia em São Paulo do dia marcado.
-- Linhas à meia-noite UTC vieram da agenda num servidor em UTC (o dia é o dia UTC);
-- as demais foram gravadas com o fuso da clínica (o dia é o dia em São Paulo).
UPDATE "Appointment" SET "date" = ((CASE
  WHEN ("date" AT TIME ZONE 'UTC')::time = time '00:00' THEN ("date" AT TIME ZONE 'UTC')::date
  ELSE ("date" AT TIME ZONE 'America/Sao_Paulo')::date
END) + time '12:00') AT TIME ZONE 'America/Sao_Paulo';

-- Registros antigos sem jornada vão para a jornada ativa mais antiga do paciente
-- (antes isso era refeito a cada abertura da lista de jornadas).
UPDATE "Appointment" r SET "journeyId" = (SELECT j."id" FROM "PatientJourney" j WHERE j."patientId" = r."patientId" AND j."archivedAt" IS NULL ORDER BY j."createdAt" LIMIT 1) WHERE r."journeyId" IS NULL;
UPDATE "PatientProcedure" r SET "journeyId" = (SELECT j."id" FROM "PatientJourney" j WHERE j."patientId" = r."patientId" AND j."archivedAt" IS NULL ORDER BY j."createdAt" LIMIT 1) WHERE r."journeyId" IS NULL;
UPDATE "Evaluation" r SET "journeyId" = (SELECT j."id" FROM "PatientJourney" j WHERE j."patientId" = r."patientId" AND j."archivedAt" IS NULL ORDER BY j."createdAt" LIMIT 1) WHERE r."journeyId" IS NULL;
UPDATE "Quote" r SET "journeyId" = (SELECT j."id" FROM "PatientJourney" j WHERE j."patientId" = r."patientId" AND j."archivedAt" IS NULL ORDER BY j."createdAt" LIMIT 1) WHERE r."journeyId" IS NULL;
UPDATE "Payment" r SET "journeyId" = (SELECT j."id" FROM "PatientJourney" j WHERE j."patientId" = r."patientId" AND j."archivedAt" IS NULL ORDER BY j."createdAt" LIMIT 1) WHERE r."journeyId" IS NULL;
