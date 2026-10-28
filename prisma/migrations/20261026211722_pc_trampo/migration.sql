/*
  Warnings:

  - You are about to drop the column `allergies` on the `Evaluation` table. All the data in the column will be lost.
  - You are about to drop the column `anticoagulantUse` on the `Evaluation` table. All the data in the column will be lost.
  - You are about to drop the column `autoimmuneDiseases` on the `Evaluation` table. All the data in the column will be lost.
  - You are about to drop the column `chiefComplaint` on the `Evaluation` table. All the data in the column will be lost.
  - You are about to drop the column `clinicalNotes` on the `Evaluation` table. All the data in the column will be lost.
  - You are about to drop the column `contraindications` on the `Evaluation` table. All the data in the column will be lost.
  - You are about to drop the column `medicalHistory` on the `Evaluation` table. All the data in the column will be lost.
  - You are about to drop the column `patientGoal` on the `Evaluation` table. All the data in the column will be lost.
  - You are about to drop the column `pregnancyStatus` on the `Evaluation` table. All the data in the column will be lost.
  - You are about to drop the column `previousProcedures` on the `Evaluation` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `Evaluation` table. All the data in the column will be lost.
  - You are about to drop the column `category` on the `EvaluationPhoto` table. All the data in the column will be lost.
  - You are about to drop the column `sortOrder` on the `EvaluationPhoto` table. All the data in the column will be lost.
  - You are about to drop the column `professional` on the `PatientJourney` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `PatientJourney` table. All the data in the column will be lost.
  - You are about to drop the column `procedureSessionId` on the `PendingStockOutput` table. All the data in the column will be lost.
  - You are about to drop the column `catalogItemId` on the `Procedure` table. All the data in the column will be lost.
  - You are about to drop the column `imageAssetId` on the `Procedure` table. All the data in the column will be lost.
  - You are about to drop the column `imageCatalogItemId` on the `Procedure` table. All the data in the column will be lost.
  - You are about to alter the column `price` on the `Procedure` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.
  - You are about to drop the column `approvedAt` on the `Quote` table. All the data in the column will be lost.
  - You are about to drop the column `approvedBy` on the `Quote` table. All the data in the column will be lost.
  - You are about to drop the column `cancelledAt` on the `Quote` table. All the data in the column will be lost.
  - You are about to drop the column `cancelledBy` on the `Quote` table. All the data in the column will be lost.
  - You are about to drop the column `createdBy` on the `Quote` table. All the data in the column will be lost.
  - You are about to drop the column `details` on the `Quote` table. All the data in the column will be lost.
  - You are about to drop the column `evaluationId` on the `Quote` table. All the data in the column will be lost.
  - You are about to drop the column `installments` on the `Quote` table. All the data in the column will be lost.
  - You are about to drop the column `notes` on the `Quote` table. All the data in the column will be lost.
  - You are about to drop the column `refusedAt` on the `Quote` table. All the data in the column will be lost.
  - You are about to drop the column `refusedBy` on the `Quote` table. All the data in the column will be lost.
  - You are about to drop the column `sentAt` on the `Quote` table. All the data in the column will be lost.
  - You are about to drop the column `sentBy` on the `Quote` table. All the data in the column will be lost.
  - You are about to drop the column `updatedBy` on the `Quote` table. All the data in the column will be lost.
  - You are about to drop the column `procedureSessionId` on the `StockMovement` table. All the data in the column will be lost.
  - You are about to drop the `ClinicalDocument` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ClinicalDocumentBlob` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ClinicalFileAudit` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ClinicalPhoto` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ClinicalPhotoBlob` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PatientAnamnesis` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PatientProcedureFollowUp` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PatientProcedureFollowUpDraft` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PatientProcedureSession` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProcedureCatalogItem` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProcedureImageAsset` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProcedureImageBlob` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ClinicalDocument" DROP CONSTRAINT "ClinicalDocument_clinicId_fkey";

-- DropForeignKey
ALTER TABLE "ClinicalDocument" DROP CONSTRAINT "ClinicalDocument_patientId_fkey";

-- DropForeignKey
ALTER TABLE "ClinicalDocumentBlob" DROP CONSTRAINT "ClinicalDocumentBlob_documentId_fkey";

-- DropForeignKey
ALTER TABLE "ClinicalFileAudit" DROP CONSTRAINT "ClinicalFileAudit_clinicId_fkey";

-- DropForeignKey
ALTER TABLE "ClinicalPhoto" DROP CONSTRAINT "ClinicalPhoto_clinicId_fkey";

-- DropForeignKey
ALTER TABLE "ClinicalPhoto" DROP CONSTRAINT "ClinicalPhoto_patientId_fkey";

-- DropForeignKey
ALTER TABLE "ClinicalPhotoBlob" DROP CONSTRAINT "ClinicalPhotoBlob_photoId_fkey";

-- DropForeignKey
ALTER TABLE "PatientAnamnesis" DROP CONSTRAINT "PatientAnamnesis_clinicId_fkey";

-- DropForeignKey
ALTER TABLE "PatientAnamnesis" DROP CONSTRAINT "PatientAnamnesis_patientId_fkey";

-- DropForeignKey
ALTER TABLE "PatientProcedureFollowUp" DROP CONSTRAINT "PatientProcedureFollowUp_appointmentId_fkey";

-- DropForeignKey
ALTER TABLE "PatientProcedureFollowUp" DROP CONSTRAINT "PatientProcedureFollowUp_clinicId_fkey";

-- DropForeignKey
ALTER TABLE "PatientProcedureFollowUp" DROP CONSTRAINT "PatientProcedureFollowUp_journeyId_fkey";

-- DropForeignKey
ALTER TABLE "PatientProcedureFollowUp" DROP CONSTRAINT "PatientProcedureFollowUp_patientId_fkey";

-- DropForeignKey
ALTER TABLE "PatientProcedureFollowUp" DROP CONSTRAINT "PatientProcedureFollowUp_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "PatientProcedureFollowUpDraft" DROP CONSTRAINT "PatientProcedureFollowUpDraft_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "PatientProcedureSession" DROP CONSTRAINT "PatientProcedureSession_clinicId_fkey";

-- DropForeignKey
ALTER TABLE "PatientProcedureSession" DROP CONSTRAINT "PatientProcedureSession_evaluationId_fkey";

-- DropForeignKey
ALTER TABLE "PatientProcedureSession" DROP CONSTRAINT "PatientProcedureSession_journeyId_fkey";

-- DropForeignKey
ALTER TABLE "PatientProcedureSession" DROP CONSTRAINT "PatientProcedureSession_patientId_fkey";

-- DropForeignKey
ALTER TABLE "PatientProcedureSession" DROP CONSTRAINT "PatientProcedureSession_procedureId_fkey";

-- DropForeignKey
ALTER TABLE "PatientProcedureSession" DROP CONSTRAINT "PatientProcedureSession_quoteId_fkey";

-- DropForeignKey
ALTER TABLE "PendingStockOutput" DROP CONSTRAINT "PendingStockOutput_procedureSessionId_fkey";

-- DropForeignKey
ALTER TABLE "Procedure" DROP CONSTRAINT "Procedure_catalogItemId_fkey";

-- DropForeignKey
ALTER TABLE "Procedure" DROP CONSTRAINT "Procedure_imageAssetId_fkey";

-- DropForeignKey
ALTER TABLE "Procedure" DROP CONSTRAINT "Procedure_imageCatalogItemId_fkey";

-- DropForeignKey
ALTER TABLE "ProcedureImageAsset" DROP CONSTRAINT "ProcedureImageAsset_clinicId_fkey";

-- DropForeignKey
ALTER TABLE "ProcedureImageBlob" DROP CONSTRAINT "ProcedureImageBlob_assetId_fkey";

-- DropForeignKey
ALTER TABLE "Quote" DROP CONSTRAINT "Quote_evaluationId_fkey";

-- DropForeignKey
ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_procedureSessionId_fkey";

-- DropIndex
DROP INDEX "PendingStockOutput_procedureSessionId_idx";

-- DropIndex
DROP INDEX "Procedure_clinicId_catalogItemId_key";

-- DropIndex
DROP INDEX "Procedure_imageAssetId_idx";

-- DropIndex
DROP INDEX "Quote_evaluationId_idx";

-- DropIndex
DROP INDEX "StockMovement_procedureSessionId_idx";

-- AlterTable
ALTER TABLE "Evaluation" DROP COLUMN "allergies",
DROP COLUMN "anticoagulantUse",
DROP COLUMN "autoimmuneDiseases",
DROP COLUMN "chiefComplaint",
DROP COLUMN "clinicalNotes",
DROP COLUMN "contraindications",
DROP COLUMN "medicalHistory",
DROP COLUMN "patientGoal",
DROP COLUMN "pregnancyStatus",
DROP COLUMN "previousProcedures",
DROP COLUMN "status";

-- AlterTable
ALTER TABLE "EvaluationPhoto" DROP COLUMN "category",
DROP COLUMN "sortOrder";

-- AlterTable
ALTER TABLE "PatientJourney" DROP COLUMN "professional",
DROP COLUMN "status";

-- AlterTable
ALTER TABLE "PendingStockOutput" DROP COLUMN "procedureSessionId";

-- AlterTable
ALTER TABLE "Procedure" DROP COLUMN "catalogItemId",
DROP COLUMN "imageAssetId",
DROP COLUMN "imageCatalogItemId",
ALTER COLUMN "category" DROP DEFAULT,
ALTER COLUMN "price" SET DATA TYPE INTEGER,
ALTER COLUMN "margin" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Quote" DROP COLUMN "approvedAt",
DROP COLUMN "approvedBy",
DROP COLUMN "cancelledAt",
DROP COLUMN "cancelledBy",
DROP COLUMN "createdBy",
DROP COLUMN "details",
DROP COLUMN "evaluationId",
DROP COLUMN "installments",
DROP COLUMN "notes",
DROP COLUMN "refusedAt",
DROP COLUMN "refusedBy",
DROP COLUMN "sentAt",
DROP COLUMN "sentBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "StockMovement" DROP COLUMN "procedureSessionId";

-- DropTable
DROP TABLE "ClinicalDocument";

-- DropTable
DROP TABLE "ClinicalDocumentBlob";

-- DropTable
DROP TABLE "ClinicalFileAudit";

-- DropTable
DROP TABLE "ClinicalPhoto";

-- DropTable
DROP TABLE "ClinicalPhotoBlob";

-- DropTable
DROP TABLE "PatientAnamnesis";

-- DropTable
DROP TABLE "PatientProcedureFollowUp";

-- DropTable
DROP TABLE "PatientProcedureFollowUpDraft";

-- DropTable
DROP TABLE "PatientProcedureSession";

-- DropTable
DROP TABLE "ProcedureCatalogItem";

-- DropTable
DROP TABLE "ProcedureImageAsset";

-- DropTable
DROP TABLE "ProcedureImageBlob";
