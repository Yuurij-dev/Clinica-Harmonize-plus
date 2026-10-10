-- Compras de estoque: uma nota com vários itens (lote, validade, quantidade e preço),
-- ligadas às movimentações de entrada e às despesas (uma por parcela).
CREATE TABLE IF NOT EXISTS "Purchase" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "supplier" TEXT NOT NULL,
  "invoiceNumber" TEXT,
  "purchasedOn" DATE NOT NULL,
  "paymentMethod" TEXT NOT NULL,
  "installments" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'active',
  "userId" TEXT,
  "userName" TEXT NOT NULL DEFAULT '',
  "cancelledAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Purchase_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX IF NOT EXISTS "Purchase_clinicId_purchasedOn_idx" ON "Purchase"("clinicId", "purchasedOn");

CREATE TABLE IF NOT EXISTS "PurchaseItem" (
  "id" TEXT NOT NULL,
  "purchaseId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "lotId" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "unitPriceCents" INTEGER NOT NULL,
  CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "PurchaseItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "PurchaseItem_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX IF NOT EXISTS "PurchaseItem_purchaseId_idx" ON "PurchaseItem"("purchaseId");
CREATE INDEX IF NOT EXISTS "PurchaseItem_productId_idx" ON "PurchaseItem"("productId");
CREATE INDEX IF NOT EXISTS "PurchaseItem_lotId_idx" ON "PurchaseItem"("lotId");

ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "purchaseId" TEXT;
ALTER TABLE "StockMovement" DROP CONSTRAINT IF EXISTS "StockMovement_purchaseId_fkey";
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "purchaseId" TEXT;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "installmentNumber" INTEGER;
ALTER TABLE "Expense" DROP CONSTRAINT IF EXISTS "Expense_purchaseId_fkey";
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
