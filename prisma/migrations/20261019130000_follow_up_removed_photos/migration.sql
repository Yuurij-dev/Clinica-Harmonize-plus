ALTER TABLE "PatientProcedureFollowUp" ADD COLUMN "removedPhotoIds" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "PatientProcedureFollowUpDraft" ADD COLUMN "removedPhotoIds" TEXT NOT NULL DEFAULT '[]';
