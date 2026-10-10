-- Compatibilidade temporária: a versão publicada antes do branch feat/estoque-e-despesas
-- ainda lê e grava "Product"."cost" (reais inteiros). Esta coluna volta a existir e fica
-- sincronizada com "costCents" por um trigger, nos dois sentidos:
--   * código antigo grava "cost"      -> "costCents" = cost * 100
--   * código novo grava "costCents"   -> "cost" = costCents / 100 (arredondado)
-- O schema do Prisma não declara "cost". Remover coluna, trigger e função quando a
-- versão antiga não estiver mais no ar.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "cost" INTEGER;
UPDATE "Product" SET "cost" = ROUND("costCents" / 100.0) WHERE "cost" IS NULL;
ALTER TABLE "Product" ALTER COLUMN "costCents" SET DEFAULT 0;
CREATE OR REPLACE FUNCTION "product_cost_compat"() RETURNS trigger AS $$ BEGIN IF TG_OP = 'INSERT' THEN IF NEW."cost" IS NOT NULL AND COALESCE(NEW."costCents", 0) = 0 THEN NEW."costCents" := NEW."cost" * 100; END IF; ELSIF NEW."cost" IS DISTINCT FROM OLD."cost" AND NEW."costCents" = OLD."costCents" THEN NEW."costCents" := NEW."cost" * 100; END IF; NEW."cost" := ROUND(NEW."costCents" / 100.0); RETURN NEW; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "product_cost_compat" ON "Product";
CREATE TRIGGER "product_cost_compat" BEFORE INSERT OR UPDATE ON "Product" FOR EACH ROW EXECUTE FUNCTION "product_cost_compat"();
