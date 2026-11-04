-- Repara schema removido por migration de rollback aplicada fora do histórico ativo.
-- Idempotente para funcionar tanto no Supabase atual quanto em bancos novos.
BEGIN;

-- AlterTable
ALTER TABLE "Evaluation" ADD COLUMN IF NOT EXISTS     "allergies" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS     "anticoagulantUse" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS     "autoimmuneDiseases" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS     "chiefComplaint" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS     "clinicalNotes" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS     "contraindications" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS     "medicalHistory" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS     "patientGoal" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS     "pregnancyStatus" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS     "previousProcedures" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS     "status" TEXT NOT NULL DEFAULT 'Rascunho';

-- AlterTable
ALTER TABLE "EvaluationPhoto" ADD COLUMN IF NOT EXISTS     "category" TEXT NOT NULL DEFAULT 'Outra',
ADD COLUMN IF NOT EXISTS     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PatientJourney" ADD COLUMN IF NOT EXISTS     "professional" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS     "status" TEXT NOT NULL DEFAULT 'Em andamento';

-- AlterTable
ALTER TABLE "PendingStockOutput" ADD COLUMN IF NOT EXISTS     "procedureSessionId" TEXT;

-- AlterTable
ALTER TABLE "Procedure" ADD COLUMN IF NOT EXISTS     "catalogItemId" TEXT,
ADD COLUMN IF NOT EXISTS     "imageAssetId" TEXT,
ADD COLUMN IF NOT EXISTS     "imageCatalogItemId" TEXT,
ALTER COLUMN "category" SET DEFAULT '',
ALTER COLUMN "price" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "margin" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS     "approvedAt" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS     "approvedBy" TEXT,
ADD COLUMN IF NOT EXISTS     "cancelledAt" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS     "cancelledBy" TEXT,
ADD COLUMN IF NOT EXISTS     "createdBy" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS     "details" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN IF NOT EXISTS     "evaluationId" TEXT,
ADD COLUMN IF NOT EXISTS     "installments" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS     "notes" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS     "refusedAt" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS     "refusedBy" TEXT,
ADD COLUMN IF NOT EXISTS     "sentAt" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS     "sentBy" TEXT,
ADD COLUMN IF NOT EXISTS     "updatedBy" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS     "procedureSessionId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProcedureCatalogItem" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageFile" TEXT NOT NULL,
    "imageAlt" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProcedureCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProcedureImageAsset" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "storageDriver" TEXT NOT NULL DEFAULT 'db',
    "storageKey" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcedureImageAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProcedureImageBlob" (
    "assetId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "ProcedureImageBlob_pkey" PRIMARY KEY ("assetId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PatientProcedureSession" (
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
    "materialsSeededAt" TIMESTAMPTZ(6),
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

-- CreateTable
CREATE TABLE IF NOT EXISTS "PatientProcedureFollowUp" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "professional" TEXT NOT NULL,
    "complaints" TEXT NOT NULL DEFAULT '',
    "guidanceText" TEXT NOT NULL DEFAULT '',
    "guidanceSentAt" TIMESTAMPTZ(6),
    "observations" TEXT NOT NULL DEFAULT '',
    "complications" TEXT NOT NULL DEFAULT '',
    "photos" TEXT NOT NULL DEFAULT '[]',
    "removedPhotoIds" TEXT NOT NULL DEFAULT '[]',
    "auditLog" TEXT NOT NULL DEFAULT '[]',
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PatientProcedureFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PatientProcedureFollowUpDraft" (
    "sessionId" TEXT NOT NULL,
    "complaints" TEXT NOT NULL DEFAULT '',
    "guidanceText" TEXT NOT NULL DEFAULT '',
    "guidanceConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "observations" TEXT NOT NULL DEFAULT '',
    "complications" TEXT NOT NULL DEFAULT '',
    "photos" TEXT NOT NULL DEFAULT '[]',
    "removedPhotoIds" TEXT NOT NULL DEFAULT '[]',
    "appointmentId" TEXT,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PatientProcedureFollowUpDraft_pkey" PRIMARY KEY ("sessionId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PatientAnamnesis" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RASCUNHO',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "content" TEXT NOT NULL DEFAULT '{}',
    "origin" TEXT NOT NULL DEFAULT 'empty',
    "basedOnVersion" INTEGER,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "completedBy" TEXT,
    "completedAt" TIMESTAMPTZ(6),
    "reviewRequestedBy" TEXT,
    "reviewRequestedAt" TIMESTAMPTZ(6),
    "reviewReason" TEXT NOT NULL DEFAULT '',
    "reviewConfirmedBy" TEXT,
    "reviewConfirmedAt" TIMESTAMPTZ(6),
    "auditLog" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PatientAnamnesis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ClinicalDocument" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "journeyId" TEXT,
    "encounterType" TEXT,
    "encounterId" TEXT,
    "category" TEXT NOT NULL DEFAULT 'OUTROS',
    "name" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageDriver" TEXT NOT NULL DEFAULT 'db',
    "storageKey" TEXT,
    "signatureStatus" TEXT NOT NULL DEFAULT 'NAO_APLICAVEL',
    "uploadedBy" TEXT NOT NULL,
    "uploadedByName" TEXT NOT NULL,
    "uploadedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "archivedAt" TIMESTAMPTZ(6),
    "archivedBy" TEXT,
    "archiveReason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ClinicalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ClinicalDocumentBlob" (
    "documentId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "ClinicalDocumentBlob_pkey" PRIMARY KEY ("documentId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ClinicalPhoto" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "journeyId" TEXT,
    "encounterType" TEXT,
    "encounterId" TEXT,
    "phase" TEXT NOT NULL DEFAULT 'OUTRA',
    "category" TEXT NOT NULL DEFAULT 'Outra',
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageDriver" TEXT NOT NULL DEFAULT 'db',
    "storageKey" TEXT,
    "takenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT NOT NULL,
    "uploadedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "archivedAt" TIMESTAMPTZ(6),
    "archivedBy" TEXT,

    CONSTRAINT "ClinicalPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ClinicalPhotoBlob" (
    "photoId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "ClinicalPhotoBlob_pkey" PRIMARY KEY ("photoId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ClinicalFileAudit" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "fileKind" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "fileName" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalFileAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ProcedureCatalogItem_slug_key" ON "ProcedureCatalogItem"("slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProcedureCatalogItem_active_sortOrder_idx" ON "ProcedureCatalogItem"("active", "sortOrder");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProcedureImageAsset_clinicId_idx" ON "ProcedureImageAsset"("clinicId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PatientProcedureSession_clinicId_patientId_performedAt_idx" ON "PatientProcedureSession"("clinicId", "patientId", "performedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PatientProcedureSession_journeyId_performedAt_idx" ON "PatientProcedureSession"("journeyId", "performedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PatientProcedureSession_procedureId_performedAt_idx" ON "PatientProcedureSession"("procedureId", "performedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PatientProcedureSession_evaluationId_idx" ON "PatientProcedureSession"("evaluationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PatientProcedureSession_quoteId_idx" ON "PatientProcedureSession"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PatientProcedureFollowUp_appointmentId_key" ON "PatientProcedureFollowUp"("appointmentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PatientProcedureFollowUp_clinicId_patientId_occurredAt_idx" ON "PatientProcedureFollowUp"("clinicId", "patientId", "occurredAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PatientProcedureFollowUp_journeyId_occurredAt_idx" ON "PatientProcedureFollowUp"("journeyId", "occurredAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PatientProcedureFollowUp_sessionId_occurredAt_idx" ON "PatientProcedureFollowUp"("sessionId", "occurredAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PatientAnamnesis_clinicId_patientId_status_idx" ON "PatientAnamnesis"("clinicId", "patientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PatientAnamnesis_patientId_version_key" ON "PatientAnamnesis"("patientId", "version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClinicalDocument_clinicId_patientId_archivedAt_uploadedAt_idx" ON "ClinicalDocument"("clinicId", "patientId", "archivedAt", "uploadedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClinicalDocument_clinicId_patientId_category_idx" ON "ClinicalDocument"("clinicId", "patientId", "category");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClinicalDocument_journeyId_idx" ON "ClinicalDocument"("journeyId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClinicalPhoto_clinicId_patientId_archivedAt_takenAt_idx" ON "ClinicalPhoto"("clinicId", "patientId", "archivedAt", "takenAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClinicalPhoto_journeyId_idx" ON "ClinicalPhoto"("journeyId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClinicalFileAudit_clinicId_patientId_createdAt_idx" ON "ClinicalFileAudit"("clinicId", "patientId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClinicalFileAudit_fileId_idx" ON "ClinicalFileAudit"("fileId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PendingStockOutput_procedureSessionId_idx" ON "PendingStockOutput"("procedureSessionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Procedure_imageAssetId_idx" ON "Procedure"("imageAssetId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Procedure_clinicId_catalogItemId_key" ON "Procedure"("clinicId", "catalogItemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Quote_evaluationId_idx" ON "Quote"("evaluationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StockMovement_procedureSessionId_idx" ON "StockMovement"("procedureSessionId");

-- Seed do catálogo padrão (idempotente): ids determinísticos "cat_<slug>", gerados a partir de public/images/procedimentos/manifest.json.
INSERT INTO "ProcedureCatalogItem" ("id", "slug", "name", "imageFile", "imageAlt", "sortOrder") VALUES
  ('cat_botox', 'botox', 'Botox', '/images/procedimentos/botox.webp', 'Imagem ilustrativa de botox', 1),
  ('cat_preenchimento-labial', 'preenchimento-labial', 'Preenchimento labial', '/images/procedimentos/preenchimento-labial.webp', 'Imagem ilustrativa de preenchimento labial', 2),
  ('cat_harmonizacao-facial', 'harmonizacao-facial', 'Harmonização facial', '/images/procedimentos/harmonizacao-facial.webp', 'Imagem ilustrativa de harmonização facial', 3),
  ('cat_bioestimulador-de-colageno', 'bioestimulador-de-colageno', 'Bioestimulador de colágeno', '/images/procedimentos/bioestimulador-de-colageno.webp', 'Imagem ilustrativa de bioestimulador de colágeno', 4),
  ('cat_skinbooster', 'skinbooster', 'Skinbooster', '/images/procedimentos/skinbooster.webp', 'Imagem ilustrativa de skinbooster', 5),
  ('cat_fios-de-sustentacao', 'fios-de-sustentacao', 'Fios de sustentação', '/images/procedimentos/fios-de-sustentacao.webp', 'Imagem ilustrativa de fios de sustentação', 6),
  ('cat_lipo-de-papada', 'lipo-de-papada', 'Lipo de papada', '/images/procedimentos/lipo-de-papada.webp', 'Imagem ilustrativa de lipo de papada', 7),
  ('cat_enzimas-faciais', 'enzimas-faciais', 'Enzimas faciais', '/images/procedimentos/enzimas-faciais.webp', 'Imagem ilustrativa de enzimas faciais', 8),
  ('cat_peelings-quimicos', 'peelings-quimicos', 'Peelings químicos', '/images/procedimentos/peelings-quimicos.webp', 'Imagem ilustrativa de peelings químicos', 9),
  ('cat_limpeza-de-pele', 'limpeza-de-pele', 'Limpeza de pele', '/images/procedimentos/limpeza-de-pele.webp', 'Imagem ilustrativa de limpeza de pele', 10),
  ('cat_tratamento-para-acne', 'tratamento-para-acne', 'Tratamento para acne', '/images/procedimentos/tratamento-para-acne.webp', 'Imagem ilustrativa de tratamento para acne', 11),
  ('cat_tratamento-para-manchas', 'tratamento-para-manchas', 'Tratamento para manchas', '/images/procedimentos/tratamento-para-manchas.webp', 'Imagem ilustrativa de tratamento para manchas', 12),
  ('cat_rejuvenescimento-facial', 'rejuvenescimento-facial', 'Rejuvenescimento facial', '/images/procedimentos/rejuvenescimento-facial.webp', 'Imagem ilustrativa de rejuvenescimento facial', 13),
  ('cat_preenchimento-de-olheiras', 'preenchimento-de-olheiras', 'Preenchimento de olheiras', '/images/procedimentos/preenchimento-de-olheiras.webp', 'Imagem ilustrativa de preenchimento de olheiras', 14),
  ('cat_rinomodelacao', 'rinomodelacao', 'Rinomodelação', '/images/procedimentos/rinomodelacao.webp', 'Imagem ilustrativa de rinomodelação', 15),
  ('cat_tratamento-para-cicatrizes', 'tratamento-para-cicatrizes', 'Tratamento para cicatrizes', '/images/procedimentos/tratamento-para-cicatrizes.webp', 'Imagem ilustrativa de tratamento para cicatrizes', 16),
  ('cat_design-de-sobrancelhas', 'design-de-sobrancelhas', 'Design de sobrancelhas', '/images/procedimentos/design-de-sobrancelhas.webp', 'Imagem ilustrativa de design de sobrancelhas', 17),
  ('cat_tratamento-para-suor-excessivo', 'tratamento-para-suor-excessivo', 'Tratamento para suor excessivo', '/images/procedimentos/tratamento-para-suor-excessivo.webp', 'Imagem ilustrativa de tratamento para suor excessivo', 18),
  ('cat_emagrecimento', 'emagrecimento', 'Emagrecimento', '/images/procedimentos/emagrecimento.webp', 'Imagem ilustrativa de emagrecimento', 19),
  ('cat_tratamento-para-celulite', 'tratamento-para-celulite', 'Tratamento para celulite', '/images/procedimentos/tratamento-para-celulite.webp', 'Imagem ilustrativa de tratamento para celulite', 20),
  ('cat_tratamento-para-flacidez', 'tratamento-para-flacidez', 'Tratamento para flacidez', '/images/procedimentos/tratamento-para-flacidez.webp', 'Imagem ilustrativa de tratamento para flacidez', 21),
  ('cat_intradermoterapia', 'intradermoterapia', 'Intradermoterapia', '/images/procedimentos/intradermoterapia.webp', 'Imagem ilustrativa de intradermoterapia', 22),
  ('cat_tratamento-capilar', 'tratamento-capilar', 'Tratamento capilar', '/images/procedimentos/tratamento-capilar.webp', 'Imagem ilustrativa de tratamento capilar', 23),
  ('cat_soroterapia', 'soroterapia', 'Soroterapia', '/images/procedimentos/soroterapia.webp', 'Imagem ilustrativa de soroterapia', 24),
  ('cat_crioestetica', 'crioestetica', 'Crioestética', '/images/procedimentos/crioestetica.webp', 'Imagem ilustrativa de crioestética', 25),
  ('cat_radiofrequencia', 'radiofrequencia', 'Radiofrequência', '/images/procedimentos/radiofrequencia.webp', 'Imagem ilustrativa de radiofrequência', 26),
  ('cat_ultrassom-microfocado', 'ultrassom-microfocado', 'Ultrassom microfocado', '/images/procedimentos/ultrassom-microfocado.webp', 'Imagem ilustrativa de ultrassom microfocado', 27),
  ('cat_microagulhamento', 'microagulhamento', 'Microagulhamento', '/images/procedimentos/microagulhamento.webp', 'Imagem ilustrativa de microagulhamento', 28),
  ('cat_ledterapia', 'ledterapia', 'LEDterapia', '/images/procedimentos/ledterapia.webp', 'Imagem ilustrativa de ledterapia', 29),
  ('cat_aplicacao-de-medicamentos', 'aplicacao-de-medicamentos', 'Aplicação de medicamentos', '/images/procedimentos/aplicacao-de-medicamentos.webp', 'Imagem ilustrativa de aplicação de medicamentos', 30)
ON CONFLICT ("slug") DO NOTHING;

-- Backfill (idempotente, aditivo): vincula procedimentos existentes ao catálogo quando o nome normalizado (minúsculas, sem acento)
-- casa com o nome/slug do item ou com os aliases históricos. Nunca altera nome, preço, ficha técnica nem apaga dados.
-- Por clínica, só um procedimento por item (o mais antigo); os demais e os sem correspondência ficam personalizados, sem imagem.
WITH normalized AS (
  SELECT p."id", p."clinicId", p."createdAt",
    CASE lower(translate(btrim(p."name"), 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn'))
      WHEN 'toxina botulinica' THEN 'botox'
      WHEN 'preenchimento de olheira' THEN 'preenchimento-de-olheiras'
      WHEN 'led terapia' THEN 'ledterapia'
      ELSE lower(translate(btrim(p."name"), 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn'))
    END AS "key"
  FROM "Procedure" p
  WHERE p."catalogItemId" IS NULL AND p."clinicId" IS NOT NULL
), matched AS (
  SELECT DISTINCT ON (n."id") n."id", n."clinicId", n."createdAt", c."id" AS "catalogItemId"
  FROM normalized n
  JOIN "ProcedureCatalogItem" c ON c."slug" = n."key" OR lower(translate(btrim(c."name"), 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn')) = n."key"
  ORDER BY n."id", (c."slug" = n."key") DESC, c."sortOrder"
), winners AS (
  SELECT DISTINCT ON (m."clinicId", m."catalogItemId") m."id", m."catalogItemId"
  FROM matched m
  WHERE NOT EXISTS (SELECT 1 FROM "Procedure" x WHERE x."clinicId" = m."clinicId" AND x."catalogItemId" = m."catalogItemId")
  ORDER BY m."clinicId", m."catalogItemId", m."createdAt", m."id"
)
UPDATE "Procedure" p SET "catalogItemId" = w."catalogItemId" FROM winners w WHERE p."id" = w."id";

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProcedureImageAsset_clinicId_fkey' AND conrelid = '"ProcedureImageAsset"'::regclass) THEN
    ALTER TABLE "ProcedureImageAsset" ADD CONSTRAINT "ProcedureImageAsset_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProcedureImageBlob_assetId_fkey' AND conrelid = '"ProcedureImageBlob"'::regclass) THEN
    ALTER TABLE "ProcedureImageBlob" ADD CONSTRAINT "ProcedureImageBlob_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "ProcedureImageAsset"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Procedure_catalogItemId_fkey' AND conrelid = '"Procedure"'::regclass) THEN
    ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "ProcedureCatalogItem"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Procedure_imageCatalogItemId_fkey' AND conrelid = '"Procedure"'::regclass) THEN
    ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_imageCatalogItemId_fkey" FOREIGN KEY ("imageCatalogItemId") REFERENCES "ProcedureCatalogItem"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Procedure_imageAssetId_fkey' AND conrelid = '"Procedure"'::regclass) THEN
    ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_imageAssetId_fkey" FOREIGN KEY ("imageAssetId") REFERENCES "ProcedureImageAsset"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PatientProcedureSession_clinicId_fkey' AND conrelid = '"PatientProcedureSession"'::regclass) THEN
    ALTER TABLE "PatientProcedureSession" ADD CONSTRAINT "PatientProcedureSession_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PatientProcedureSession_patientId_fkey' AND conrelid = '"PatientProcedureSession"'::regclass) THEN
    ALTER TABLE "PatientProcedureSession" ADD CONSTRAINT "PatientProcedureSession_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PatientProcedureSession_journeyId_fkey' AND conrelid = '"PatientProcedureSession"'::regclass) THEN
    ALTER TABLE "PatientProcedureSession" ADD CONSTRAINT "PatientProcedureSession_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "PatientJourney"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PatientProcedureSession_evaluationId_fkey' AND conrelid = '"PatientProcedureSession"'::regclass) THEN
    ALTER TABLE "PatientProcedureSession" ADD CONSTRAINT "PatientProcedureSession_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PatientProcedureSession_procedureId_fkey' AND conrelid = '"PatientProcedureSession"'::regclass) THEN
    ALTER TABLE "PatientProcedureSession" ADD CONSTRAINT "PatientProcedureSession_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "PatientProcedure"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PatientProcedureSession_quoteId_fkey' AND conrelid = '"PatientProcedureSession"'::regclass) THEN
    ALTER TABLE "PatientProcedureSession" ADD CONSTRAINT "PatientProcedureSession_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Quote_evaluationId_fkey' AND conrelid = '"Quote"'::regclass) THEN
    ALTER TABLE "Quote" ADD CONSTRAINT "Quote_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PatientProcedureFollowUp_clinicId_fkey' AND conrelid = '"PatientProcedureFollowUp"'::regclass) THEN
    ALTER TABLE "PatientProcedureFollowUp" ADD CONSTRAINT "PatientProcedureFollowUp_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PatientProcedureFollowUp_patientId_fkey' AND conrelid = '"PatientProcedureFollowUp"'::regclass) THEN
    ALTER TABLE "PatientProcedureFollowUp" ADD CONSTRAINT "PatientProcedureFollowUp_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PatientProcedureFollowUp_journeyId_fkey' AND conrelid = '"PatientProcedureFollowUp"'::regclass) THEN
    ALTER TABLE "PatientProcedureFollowUp" ADD CONSTRAINT "PatientProcedureFollowUp_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "PatientJourney"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PatientProcedureFollowUp_sessionId_fkey' AND conrelid = '"PatientProcedureFollowUp"'::regclass) THEN
    ALTER TABLE "PatientProcedureFollowUp" ADD CONSTRAINT "PatientProcedureFollowUp_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PatientProcedureSession"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PatientProcedureFollowUp_appointmentId_fkey' AND conrelid = '"PatientProcedureFollowUp"'::regclass) THEN
    ALTER TABLE "PatientProcedureFollowUp" ADD CONSTRAINT "PatientProcedureFollowUp_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PatientProcedureFollowUpDraft_sessionId_fkey' AND conrelid = '"PatientProcedureFollowUpDraft"'::regclass) THEN
    ALTER TABLE "PatientProcedureFollowUpDraft" ADD CONSTRAINT "PatientProcedureFollowUpDraft_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PatientProcedureSession"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PatientAnamnesis_clinicId_fkey' AND conrelid = '"PatientAnamnesis"'::regclass) THEN
    ALTER TABLE "PatientAnamnesis" ADD CONSTRAINT "PatientAnamnesis_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PatientAnamnesis_patientId_fkey' AND conrelid = '"PatientAnamnesis"'::regclass) THEN
    ALTER TABLE "PatientAnamnesis" ADD CONSTRAINT "PatientAnamnesis_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClinicalDocument_clinicId_fkey' AND conrelid = '"ClinicalDocument"'::regclass) THEN
    ALTER TABLE "ClinicalDocument" ADD CONSTRAINT "ClinicalDocument_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClinicalDocument_patientId_fkey' AND conrelid = '"ClinicalDocument"'::regclass) THEN
    ALTER TABLE "ClinicalDocument" ADD CONSTRAINT "ClinicalDocument_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClinicalDocumentBlob_documentId_fkey' AND conrelid = '"ClinicalDocumentBlob"'::regclass) THEN
    ALTER TABLE "ClinicalDocumentBlob" ADD CONSTRAINT "ClinicalDocumentBlob_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ClinicalDocument"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClinicalPhoto_clinicId_fkey' AND conrelid = '"ClinicalPhoto"'::regclass) THEN
    ALTER TABLE "ClinicalPhoto" ADD CONSTRAINT "ClinicalPhoto_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClinicalPhoto_patientId_fkey' AND conrelid = '"ClinicalPhoto"'::regclass) THEN
    ALTER TABLE "ClinicalPhoto" ADD CONSTRAINT "ClinicalPhoto_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClinicalPhotoBlob_photoId_fkey' AND conrelid = '"ClinicalPhotoBlob"'::regclass) THEN
    ALTER TABLE "ClinicalPhotoBlob" ADD CONSTRAINT "ClinicalPhotoBlob_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "ClinicalPhoto"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClinicalFileAudit_clinicId_fkey' AND conrelid = '"ClinicalFileAudit"'::regclass) THEN
    ALTER TABLE "ClinicalFileAudit" ADD CONSTRAINT "ClinicalFileAudit_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockMovement_procedureSessionId_fkey' AND conrelid = '"StockMovement"'::regclass) THEN
    ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_procedureSessionId_fkey" FOREIGN KEY ("procedureSessionId") REFERENCES "PatientProcedureSession"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PendingStockOutput_procedureSessionId_fkey' AND conrelid = '"PendingStockOutput"'::regclass) THEN
    ALTER TABLE "PendingStockOutput" ADD CONSTRAINT "PendingStockOutput_procedureSessionId_fkey" FOREIGN KEY ("procedureSessionId") REFERENCES "PatientProcedureSession"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

COMMIT;
