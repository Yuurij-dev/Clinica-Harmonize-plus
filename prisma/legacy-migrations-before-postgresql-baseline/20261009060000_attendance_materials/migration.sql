-- Conferência de materiais ao finalizar atendimentos, rastreio do uso por paciente,
-- saídas pendentes (quando falta saldo) e estorno de saídas.
-- materialsCheck: null (atendimento antigo), pending, done ou skipped.
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "materialsCheck" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "materialsCheckedAt" TIMESTAMPTZ(6);

ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "appointmentId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "patientId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "attendanceKind" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "attendanceName" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "attendanceDate" TIMESTAMPTZ(6);
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "reversesId" TEXT;
ALTER TABLE "StockMovement" DROP CONSTRAINT IF EXISTS "StockMovement_appointmentId_fkey";
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "StockMovement" DROP CONSTRAINT IF EXISTS "StockMovement_patientId_fkey";
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "StockMovement" DROP CONSTRAINT IF EXISTS "StockMovement_reversesId_fkey";
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "StockMovement"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
CREATE UNIQUE INDEX IF NOT EXISTS "StockMovement_reversesId_key" ON "StockMovement"("reversesId");
CREATE INDEX IF NOT EXISTS "StockMovement_appointmentId_idx" ON "StockMovement"("appointmentId");
CREATE INDEX IF NOT EXISTS "StockMovement_patientId_idx" ON "StockMovement"("patientId");

CREATE TABLE IF NOT EXISTS "PendingStockOutput" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "appointmentId" TEXT,
  "patientId" TEXT,
  "quantity" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attendanceKind" TEXT NOT NULL,
  "attendanceName" TEXT NOT NULL,
  "attendanceDate" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMPTZ(6),
  CONSTRAINT "PendingStockOutput_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PendingStockOutput_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "PendingStockOutput_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "PendingStockOutput_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "PendingStockOutput_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);
CREATE INDEX IF NOT EXISTS "PendingStockOutput_clinicId_status_idx" ON "PendingStockOutput"("clinicId", "status");
CREATE INDEX IF NOT EXISTS "PendingStockOutput_appointmentId_idx" ON "PendingStockOutput"("appointmentId");
