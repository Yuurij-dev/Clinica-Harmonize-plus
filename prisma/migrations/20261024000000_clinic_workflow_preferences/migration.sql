ALTER TABLE "Clinic"
  ADD COLUMN "autoMarkMissedAppointmentsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "autoCompleteAppointmentsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "autoAdvancePatientJourneyEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "allowAppointmentsOutsideHours" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Patient" ADD COLUMN "manualJourneyStage" TEXT;
