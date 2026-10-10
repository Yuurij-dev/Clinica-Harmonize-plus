-- Despesas fixas (semanais, mensais e anuais). Cada ocorrência vira uma despesa "a pagar";
-- o índice único (despesa fixa + data) garante que nenhuma ocorrência seja duplicada.
CREATE TABLE IF NOT EXISTS "RecurringExpense" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "paymentMethod" TEXT NOT NULL,
  "frequency" TEXT NOT NULL,
  "weekday" INTEGER,
  "dayOfMonth" INTEGER,
  "month" INTEGER,
  "startsOn" DATE NOT NULL,
  "endsOn" DATE,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecurringExpense_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RecurringExpense_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX IF NOT EXISTS "RecurringExpense_clinicId_idx" ON "RecurringExpense"("clinicId");

ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "recurringExpenseId" TEXT;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "occurrenceOn" DATE;
ALTER TABLE "Expense" DROP CONSTRAINT IF EXISTS "Expense_recurringExpenseId_fkey";
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_recurringExpenseId_fkey" FOREIGN KEY ("recurringExpenseId") REFERENCES "RecurringExpense"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
CREATE UNIQUE INDEX IF NOT EXISTS "Expense_recurringExpenseId_occurrenceOn_key" ON "Expense"("recurringExpenseId", "occurrenceOn");
