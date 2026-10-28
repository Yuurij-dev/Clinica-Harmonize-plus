ALTER TABLE "Clinic"
ADD COLUMN "rolePermissions" JSONB NOT NULL DEFAULT '{}'::jsonb;
