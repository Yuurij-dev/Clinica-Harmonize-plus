-- AlterTable
ALTER TABLE "Procedure" ADD COLUMN     "catalogItemId" TEXT,
ADD COLUMN     "imageAssetId" TEXT,
ALTER COLUMN "category" SET DEFAULT '';

-- CreateTable
CREATE TABLE "ProcedureCatalogItem" (
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
CREATE TABLE "ProcedureImageAsset" (
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
CREATE TABLE "ProcedureImageBlob" (
    "assetId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "ProcedureImageBlob_pkey" PRIMARY KEY ("assetId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcedureCatalogItem_slug_key" ON "ProcedureCatalogItem"("slug");

-- CreateIndex
CREATE INDEX "ProcedureCatalogItem_active_sortOrder_idx" ON "ProcedureCatalogItem"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "ProcedureImageAsset_clinicId_idx" ON "ProcedureImageAsset"("clinicId");

-- CreateIndex
CREATE INDEX "Procedure_imageAssetId_idx" ON "Procedure"("imageAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "Procedure_clinicId_catalogItemId_key" ON "Procedure"("clinicId", "catalogItemId");

-- AddForeignKey
ALTER TABLE "ProcedureImageAsset" ADD CONSTRAINT "ProcedureImageAsset_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProcedureImageBlob" ADD CONSTRAINT "ProcedureImageBlob_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "ProcedureImageAsset"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "ProcedureCatalogItem"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_imageAssetId_fkey" FOREIGN KEY ("imageAssetId") REFERENCES "ProcedureImageAsset"("id") ON DELETE SET NULL ON UPDATE NO ACTION;



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
