ALTER TABLE "ClinicMembership"
ALTER COLUMN "laborCostCents" DROP NOT NULL;

UPDATE "ClinicMembership"
SET "laborCostCents" = NULL
WHERE "laborCostCents" = 0;

ALTER TABLE "ClinicMembership"
ALTER COLUMN "laborCostCents" DROP DEFAULT;
