-- AlterTable
-- Preço do procedimento passa a aceitar centavos; valores inteiros existentes permanecem iguais.
ALTER TABLE "Procedure" ALTER COLUMN "price" TYPE DOUBLE PRECISION;
