-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'PROFESSIONAL', 'STAFF');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT,
    "profession" TEXT,
    "practiceArea" TEXT,
    "hasSecretary" BOOLEAN,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(6),
    "emailVerifiedAt" TIMESTAMPTZ(6),
    "emailVerificationTokenHash" TEXT,
    "emailVerificationExpiresAt" TIMESTAMPTZ(6),
    "role" "UserRole" NOT NULL DEFAULT 'ADMIN',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clinic" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "laborCost" INTEGER NOT NULL DEFAULT 0,
    "facilityCost" INTEGER NOT NULL DEFAULT 0,
    "medicationCost" INTEGER NOT NULL DEFAULT 0,
    "appointmentToleranceMinutes" INTEGER NOT NULL DEFAULT 15,
    "openingTime" TEXT NOT NULL DEFAULT '08:00',
    "closingTime" TEXT NOT NULL DEFAULT '19:00',
    "professionalOpeningTime" TEXT NOT NULL DEFAULT '09:00',
    "professionalClosingTime" TEXT NOT NULL DEFAULT '18:00',
    "professionalHourlyCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expiryWarningDays" INTEGER NOT NULL DEFAULT 30,
    "trialStartedAt" TIMESTAMPTZ(6),
    "trialEndsAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Clinic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'STAFF',
    "isOwner" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ClinicMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT,
    "name" TEXT NOT NULL,
    "cpf" TEXT,
    "phone" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Ativa',
    "lastVisit" TIMESTAMPTZ(6),
    "nextReturn" TIMESTAMPTZ(6),
    "totalValue" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientObservation" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'clinical',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT,
    "date" TIMESTAMPTZ(6) NOT NULL,
    "time" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "journeyId" TEXT,
    "procedure" TEXT NOT NULL,
    "professional" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "materialsCheck" TEXT,
    "materialsCheckedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Procedure" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "materials" TEXT NOT NULL,
    "materialsNeedReview" BOOLEAN NOT NULL DEFAULT false,
    "margin" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Procedure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientProcedure" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT,
    "patientId" TEXT NOT NULL,
    "journeyId" TEXT,
    "quoteId" TEXT,
    "name" TEXT NOT NULL,
    "professional" TEXT NOT NULL,
    "performedAt" TIMESTAMPTZ(6) NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "beforePhoto" TEXT,
    "afterPhoto" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PatientProcedure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientProcedurePhotoSession" (
    "id" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "beforePhoto" TEXT,
    "afterPhoto" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PatientProcedurePhotoSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT,
    "patientId" TEXT NOT NULL,
    "journeyId" TEXT,
    "professional" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "cost" INTEGER,
    "minStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMPTZ(6),
    "supplier" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT,
    "patientId" TEXT,
    "journeyId" TEXT,
    "items" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'Cartão de crédito',
    "status" TEXT NOT NULL DEFAULT 'Pendente',
    "expires" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT,
    "patientId" TEXT,
    "journeyId" TEXT,
    "valueCents" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Pago',
    "installments" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationPhoto" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "annotations" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientJourney" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "clinicId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "archivedAt" TIMESTAMPTZ(6),

    CONSTRAINT "PatientJourney_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLot" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresOn" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "userId" TEXT,
    "userName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purchaseId" TEXT,
    "appointmentId" TEXT,
    "patientId" TEXT,
    "attendanceKind" TEXT,
    "attendanceName" TEXT,
    "attendanceDate" TIMESTAMPTZ(6),
    "reversesId" TEXT,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
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
    "purchaseId" TEXT,
    "installmentNumber" INTEGER,
    "recurringExpenseId" TEXT,
    "occurrenceOn" DATE,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcedureMaterial" (
    "id" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ProcedureMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "purchasedOn" DATE NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "userId" TEXT,
    "userName" TEXT NOT NULL DEFAULT '',
    "cancelledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseItem" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,

    CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringExpense" (
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

    CONSTRAINT "RecurringExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingStockOutput" (
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

    CONSTRAINT "PendingStockOutput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_emailVerificationTokenHash_key" ON "User"("emailVerificationTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Clinic_slug_key" ON "Clinic"("slug");

-- CreateIndex
CREATE INDEX "ClinicMembership_clinicId_idx" ON "ClinicMembership"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicMembership_userId_clinicId_key" ON "ClinicMembership"("userId", "clinicId");

-- CreateIndex
CREATE INDEX "Patient_clinicId_idx" ON "Patient"("clinicId");

-- CreateIndex
CREATE INDEX "Patient_clinicId_name_idx" ON "Patient"("clinicId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_clinicId_cpf_key" ON "Patient"("clinicId", "cpf");

-- CreateIndex
CREATE INDEX "PatientObservation_clinicId_patientId_createdAt_idx" ON "PatientObservation"("clinicId", "patientId", "createdAt");

-- CreateIndex
CREATE INDEX "Appointment_patientId_date_idx" ON "Appointment"("patientId", "date");

-- CreateIndex
CREATE INDEX "Appointment_journeyId_date_idx" ON "Appointment"("journeyId", "date");

-- CreateIndex
CREATE INDEX "Appointment_clinicId_idx" ON "Appointment"("clinicId");

-- CreateIndex
CREATE INDEX "Appointment_clinicId_date_time_idx" ON "Appointment"("clinicId", "date", "time");

-- CreateIndex
CREATE INDEX "Procedure_clinicId_idx" ON "Procedure"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "Procedure_clinicId_name_key" ON "Procedure"("clinicId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PatientProcedure_quoteId_key" ON "PatientProcedure"("quoteId");

-- CreateIndex
CREATE INDEX "PatientProcedure_clinicId_idx" ON "PatientProcedure"("clinicId");

-- CreateIndex
CREATE INDEX "PatientProcedure_patientId_performedAt_idx" ON "PatientProcedure"("patientId", "performedAt");

-- CreateIndex
CREATE INDEX "PatientProcedure_journeyId_performedAt_idx" ON "PatientProcedure"("journeyId", "performedAt");

-- CreateIndex
CREATE INDEX "PatientProcedurePhotoSession_procedureId_createdAt_idx" ON "PatientProcedurePhotoSession"("procedureId", "createdAt");

-- CreateIndex
CREATE INDEX "Evaluation_patientId_idx" ON "Evaluation"("patientId");

-- CreateIndex
CREATE INDEX "Evaluation_clinicId_idx" ON "Evaluation"("clinicId");

-- CreateIndex
CREATE INDEX "Evaluation_journeyId_idx" ON "Evaluation"("journeyId");

-- CreateIndex
CREATE INDEX "Product_clinicId_idx" ON "Product"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_clinicId_name_key" ON "Product"("clinicId", "name");

-- CreateIndex
CREATE INDEX "Quote_clinicId_idx" ON "Quote"("clinicId");

-- CreateIndex
CREATE INDEX "Quote_clinicId_createdAt_idx" ON "Quote"("clinicId", "createdAt");

-- CreateIndex
CREATE INDEX "Quote_patientId_idx" ON "Quote"("patientId");

-- CreateIndex
CREATE INDEX "Quote_journeyId_idx" ON "Quote"("journeyId");

-- CreateIndex
CREATE INDEX "Payment_clinicId_idx" ON "Payment"("clinicId");

-- CreateIndex
CREATE INDEX "Payment_clinicId_date_idx" ON "Payment"("clinicId", "date");

-- CreateIndex
CREATE INDEX "Payment_patientId_idx" ON "Payment"("patientId");

-- CreateIndex
CREATE INDEX "Payment_journeyId_idx" ON "Payment"("journeyId");

-- CreateIndex
CREATE INDEX "EvaluationPhoto_evaluationId_idx" ON "EvaluationPhoto"("evaluationId");

-- CreateIndex
CREATE INDEX "PatientJourney_patientId_createdAt_idx" ON "PatientJourney"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "PatientJourney_clinicId_idx" ON "PatientJourney"("clinicId");

-- CreateIndex
CREATE INDEX "StockLot_clinicId_idx" ON "StockLot"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLot_productId_code_key" ON "StockLot"("productId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_reversesId_key" ON "StockMovement"("reversesId");

-- CreateIndex
CREATE INDEX "StockMovement_appointmentId_idx" ON "StockMovement"("appointmentId");

-- CreateIndex
CREATE INDEX "StockMovement_patientId_idx" ON "StockMovement"("patientId");

-- CreateIndex
CREATE INDEX "StockMovement_lotId_idx" ON "StockMovement"("lotId");

-- CreateIndex
CREATE INDEX "StockMovement_clinicId_createdAt_idx" ON "StockMovement"("clinicId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "Expense_clinicId_dueOn_idx" ON "Expense"("clinicId", "dueOn");

-- CreateIndex
CREATE INDEX "Expense_clinicId_paidOn_idx" ON "Expense"("clinicId", "paidOn");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_recurringExpenseId_occurrenceOn_key" ON "Expense"("recurringExpenseId", "occurrenceOn");

-- CreateIndex
CREATE INDEX "ProcedureMaterial_productId_idx" ON "ProcedureMaterial"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcedureMaterial_procedureId_productId_key" ON "ProcedureMaterial"("procedureId", "productId");

-- CreateIndex
CREATE INDEX "Purchase_clinicId_purchasedOn_idx" ON "Purchase"("clinicId", "purchasedOn");

-- CreateIndex
CREATE INDEX "PurchaseItem_purchaseId_idx" ON "PurchaseItem"("purchaseId");

-- CreateIndex
CREATE INDEX "PurchaseItem_productId_idx" ON "PurchaseItem"("productId");

-- CreateIndex
CREATE INDEX "PurchaseItem_lotId_idx" ON "PurchaseItem"("lotId");

-- CreateIndex
CREATE INDEX "RecurringExpense_clinicId_idx" ON "RecurringExpense"("clinicId");

-- CreateIndex
CREATE INDEX "PendingStockOutput_clinicId_status_idx" ON "PendingStockOutput"("clinicId", "status");

-- CreateIndex
CREATE INDEX "PendingStockOutput_appointmentId_idx" ON "PendingStockOutput"("appointmentId");

-- AddForeignKey
ALTER TABLE "ClinicMembership" ADD CONSTRAINT "ClinicMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ClinicMembership" ADD CONSTRAINT "ClinicMembership_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PatientObservation" ADD CONSTRAINT "PatientObservation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "PatientJourney"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PatientProcedure" ADD CONSTRAINT "PatientProcedure_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PatientProcedure" ADD CONSTRAINT "PatientProcedure_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PatientProcedure" ADD CONSTRAINT "PatientProcedure_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "PatientJourney"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PatientProcedurePhotoSession" ADD CONSTRAINT "PatientProcedurePhotoSession_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "PatientProcedure"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "PatientJourney"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "PatientJourney"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "PatientJourney"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "EvaluationPhoto" ADD CONSTRAINT "EvaluationPhoto_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PatientJourney" ADD CONSTRAINT "PatientJourney_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PatientJourney" ADD CONSTRAINT "PatientJourney_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "StockMovement"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_recurringExpenseId_fkey" FOREIGN KEY ("recurringExpenseId") REFERENCES "RecurringExpense"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProcedureMaterial" ADD CONSTRAINT "ProcedureMaterial_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "Procedure"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProcedureMaterial" ADD CONSTRAINT "ProcedureMaterial_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PendingStockOutput" ADD CONSTRAINT "PendingStockOutput_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PendingStockOutput" ADD CONSTRAINT "PendingStockOutput_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PendingStockOutput" ADD CONSTRAINT "PendingStockOutput_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PendingStockOutput" ADD CONSTRAINT "PendingStockOutput_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- Keep the legacy Product.cost column synchronized for deployed application versions.
CREATE OR REPLACE FUNCTION "product_cost_compat"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."cost" IS NOT NULL AND COALESCE(NEW."costCents", 0) = 0 THEN
      NEW."costCents" := NEW."cost" * 100;
    END IF;
  ELSIF NEW."cost" IS DISTINCT FROM OLD."cost" AND NEW."costCents" = OLD."costCents" THEN
    NEW."costCents" := NEW."cost" * 100;
  END IF;

  NEW."cost" := ROUND(NEW."costCents" / 100.0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "product_cost_compat"
BEFORE INSERT OR UPDATE ON "Product"
FOR EACH ROW EXECUTE FUNCTION "product_cost_compat"();

