ALTER TABLE "Clinic"
  ADD COLUMN "cnpj" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "address" TEXT,
  ADD COLUMN "appointmentNotificationsEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "appointmentNotificationSoundEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "stockNotificationsEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "requireCancellationReason" BOOLEAN NOT NULL DEFAULT FALSE;
