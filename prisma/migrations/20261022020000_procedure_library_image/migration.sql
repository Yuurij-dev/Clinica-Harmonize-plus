-- AlterTable
ALTER TABLE "Procedure" ADD COLUMN     "imageCatalogItemId" TEXT;

-- AddForeignKey
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_imageCatalogItemId_fkey" FOREIGN KEY ("imageCatalogItemId") REFERENCES "ProcedureCatalogItem"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

