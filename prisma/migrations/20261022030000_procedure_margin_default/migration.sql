-- AlterTable
-- Margem estimada removida da interface/API; coluna legado mantida com default 0.
ALTER TABLE "Procedure" ALTER COLUMN "margin" SET DEFAULT 0;
