-- Estoque por lote: estoque mínimo e arquivamento do material, lotes,
-- movimentações (nunca apagadas) e prazo de aviso de vencimento da clínica.
ALTER TABLE "Clinic" ADD COLUMN IF NOT EXISTS "expiryWarningDays" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "minStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMPTZ(6);

CREATE TABLE IF NOT EXISTS "StockLot" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "expiresOn" DATE NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockLot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StockLot_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "StockLot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS "StockLot_productId_code_key" ON "StockLot"("productId", "code");
CREATE INDEX IF NOT EXISTS "StockLot_clinicId_idx" ON "StockLot"("clinicId");

CREATE TABLE IF NOT EXISTS "StockMovement" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "lotId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "reason" TEXT,
  "notes" TEXT NOT NULL DEFAULT '',
  "userId" TEXT,
  "userName" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StockMovement_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "StockMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX IF NOT EXISTS "StockMovement_lotId_idx" ON "StockMovement"("lotId");
CREATE INDEX IF NOT EXISTS "StockMovement_clinicId_createdAt_idx" ON "StockMovement"("clinicId", "createdAt");
CREATE INDEX IF NOT EXISTS "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");
