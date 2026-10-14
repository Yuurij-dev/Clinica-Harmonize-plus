ALTER TABLE "Quote"
  ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT NOT NULL DEFAULT 'Cartão de crédito';
