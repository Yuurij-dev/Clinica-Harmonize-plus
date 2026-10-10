-- Despesas da clínica (valores em centavos). Situação: open (a pagar), paid (paga) ou cancelled.
CREATE TABLE IF NOT EXISTS "Expense" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "dueOn" DATE NOT NULL,
  "paymentMethod" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "paidOn" DATE,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "createdById" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Expense_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Expense_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX IF NOT EXISTS "Expense_clinicId_dueOn_idx" ON "Expense"("clinicId", "dueOn");
CREATE INDEX IF NOT EXISTS "Expense_clinicId_paidOn_idx" ON "Expense"("clinicId", "paidOn");
