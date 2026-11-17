-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('start', 'pro', 'premium');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SubscriptionEventType" AS ENUM ('TRIAL_STARTED', 'BACKFILLED', 'PLAN_CHANGED', 'STATUS_CHANGED');

-- CreateTable
CREATE TABLE "ClinicSubscription" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "plan" "SubscriptionPlan",
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "trialStartedAt" TIMESTAMPTZ(6),
    "trialEndsAt" TIMESTAMPTZ(6),
    "currentPeriodStart" TIMESTAMPTZ(6),
    "currentPeriodEnd" TIMESTAMPTZ(6),
    "canceledAt" TIMESTAMPTZ(6),
    "externalCustomerId" TEXT,
    "externalSubscriptionId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicSubscriptionEvent" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "type" "SubscriptionEventType" NOT NULL,
    "fromPlan" "SubscriptionPlan",
    "toPlan" "SubscriptionPlan",
    "fromStatus" "SubscriptionStatus",
    "toStatus" "SubscriptionStatus",
    "reason" TEXT NOT NULL DEFAULT '',
    "actorUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicSubscriptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClinicSubscription_clinicId_key" ON "ClinicSubscription"("clinicId");

-- CreateIndex
CREATE INDEX "ClinicSubscription_status_trialEndsAt_idx" ON "ClinicSubscription"("status", "trialEndsAt");

-- CreateIndex
CREATE INDEX "ClinicSubscriptionEvent_clinicId_createdAt_idx" ON "ClinicSubscriptionEvent"("clinicId", "createdAt");

-- AddForeignKey
ALTER TABLE "ClinicSubscription" ADD CONSTRAINT "ClinicSubscription_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ClinicSubscriptionEvent" ADD CONSTRAINT "ClinicSubscriptionEvent_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Backfill (idempotente): uma assinatura TRIALING por clínica existente, copiando as datas do teste SEM alterá-las.
-- Nenhuma clínica passa a expirar por causa disto: vencido continua vencido (trialEndsAt no passado) e vigente continua
-- vigente. Clínica legada com trialEndsAt NULL fica TRIALING com trialEndsAt NULL = nunca expira (mesma regra de auth.ts).
-- plan fica NULL (nenhum plano contratado). Não toca em Clinic.
WITH inserted AS (
  INSERT INTO "ClinicSubscription" ("id", "clinicId", "status", "trialStartedAt", "trialEndsAt")
  SELECT gen_random_uuid()::text, c."id", 'TRIALING', c."trialStartedAt", c."trialEndsAt"
  FROM "Clinic" c
  ON CONFLICT ("clinicId") DO NOTHING
  RETURNING "clinicId"
)
INSERT INTO "ClinicSubscriptionEvent" ("id", "clinicId", "type", "toStatus", "reason")
SELECT gen_random_uuid()::text, "clinicId", 'BACKFILLED', 'TRIALING', 'Assinatura criada a partir de Clinic.trialStartedAt/trialEndsAt'
FROM inserted;

-- Toda clínica nova (cadastro, seed, testes, qualquer caminho) nasce com a assinatura espelhando o teste atual, para
-- nunca existir clínica sem registro. O Prisma não modela triggers (mesmo caso de product_cost_compat); o código das
-- próximas etapas deve ATUALIZAR esta linha, não inserir outra (clinicId é único).
CREATE OR REPLACE FUNCTION "clinic_subscription_on_insert"() RETURNS trigger AS $$
BEGIN
  INSERT INTO "ClinicSubscription" ("id", "clinicId", "status", "trialStartedAt", "trialEndsAt")
  VALUES (gen_random_uuid()::text, NEW."id", 'TRIALING', NEW."trialStartedAt", NEW."trialEndsAt")
  ON CONFLICT ("clinicId") DO NOTHING;
  IF FOUND AND NEW."trialStartedAt" IS NOT NULL THEN
    INSERT INTO "ClinicSubscriptionEvent" ("id", "clinicId", "type", "toStatus", "reason")
    VALUES (gen_random_uuid()::text, NEW."id", 'TRIAL_STARTED', 'TRIALING', 'Teste grátis iniciado no cadastro da clínica');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "clinic_subscription_on_insert"
AFTER INSERT ON "Clinic"
FOR EACH ROW EXECUTE FUNCTION "clinic_subscription_on_insert"();
