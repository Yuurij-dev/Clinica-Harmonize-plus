-- Custo do material passa de reais inteiros para centavos inteiros.
ALTER TABLE "Product" RENAME COLUMN "cost" TO "costCents";
UPDATE "Product" SET "costCents" = "costCents" * 100;
