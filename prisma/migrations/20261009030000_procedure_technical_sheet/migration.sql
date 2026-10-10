-- Ficha técnica do procedimento: material e quantidade usada por atendimento.
-- O texto antigo em "Procedure"."materials" fica guardado; a conversão roda com
-- `npm run db:convert-procedure-materials`, que marca os convertidos para revisão.
ALTER TABLE "Procedure" ADD COLUMN IF NOT EXISTS "materialsNeedReview" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "ProcedureMaterial" (
  "id" TEXT NOT NULL,
  "procedureId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  CONSTRAINT "ProcedureMaterial_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProcedureMaterial_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "Procedure"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "ProcedureMaterial_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProcedureMaterial_procedureId_productId_key" ON "ProcedureMaterial"("procedureId", "productId");
CREATE INDEX IF NOT EXISTS "ProcedureMaterial_productId_idx" ON "ProcedureMaterial"("productId");
