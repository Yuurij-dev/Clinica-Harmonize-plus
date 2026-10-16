-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'material',
ALTER COLUMN "category" SET DEFAULT '';
