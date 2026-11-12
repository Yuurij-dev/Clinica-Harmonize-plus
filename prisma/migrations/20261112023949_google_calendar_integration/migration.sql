-- CreateTable
CREATE TABLE "GoogleCalendarConnection" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleEmail" TEXT NOT NULL,
    "googleAccountId" TEXT,
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMPTZ(6),
    "scope" TEXT NOT NULL DEFAULT '',
    "connectionType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "lastSyncAt" TIMESTAMPTZ(6),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleCalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleCalendarEvent" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "attendeeEmail" TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'SYNCED',
    "lastSyncedAt" TIMESTAMPTZ(6),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleCalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarSyncJob" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMPTZ(6),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "dedupeKey" TEXT,
    "snapshot" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarNotificationLog" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "recipientUserId" TEXT,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "sentAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarNotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoogleCalendarConnection_clinicId_status_idx" ON "GoogleCalendarConnection"("clinicId", "status");

-- CreateIndex
CREATE INDEX "GoogleCalendarConnection_userId_idx" ON "GoogleCalendarConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleCalendarConnection_clinicId_connectionType_userId_key" ON "GoogleCalendarConnection"("clinicId", "connectionType", "userId");

-- CreateIndex
CREATE INDEX "GoogleCalendarEvent_clinicId_appointmentId_idx" ON "GoogleCalendarEvent"("clinicId", "appointmentId");

-- CreateIndex
CREATE INDEX "GoogleCalendarEvent_connectionId_idx" ON "GoogleCalendarEvent"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleCalendarEvent_appointmentId_connectionId_key" ON "GoogleCalendarEvent"("appointmentId", "connectionId");

-- CreateIndex
CREATE INDEX "CalendarSyncJob_status_nextRetryAt_idx" ON "CalendarSyncJob"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "CalendarSyncJob_clinicId_idx" ON "CalendarSyncJob"("clinicId");

-- CreateIndex
CREATE INDEX "CalendarSyncJob_appointmentId_idx" ON "CalendarSyncJob"("appointmentId");

-- CreateIndex
CREATE INDEX "CalendarSyncJob_dedupeKey_idx" ON "CalendarSyncJob"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarNotificationLog_dedupeKey_key" ON "CalendarNotificationLog"("dedupeKey");

-- CreateIndex
CREATE INDEX "CalendarNotificationLog_clinicId_appointmentId_idx" ON "CalendarNotificationLog"("clinicId", "appointmentId");

-- AddForeignKey
ALTER TABLE "GoogleCalendarConnection" ADD CONSTRAINT "GoogleCalendarConnection_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "GoogleCalendarConnection" ADD CONSTRAINT "GoogleCalendarConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "GoogleCalendarEvent" ADD CONSTRAINT "GoogleCalendarEvent_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "GoogleCalendarEvent" ADD CONSTRAINT "GoogleCalendarEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "GoogleCalendarConnection"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- No máximo uma conexão central (ADMIN) ativa por clínica. Índice parcial: o Prisma não o modela no schema.
CREATE UNIQUE INDEX "GoogleCalendarConnection_one_central_per_clinic_idx" ON "GoogleCalendarConnection"("clinicId") WHERE "connectionType" = 'ADMIN' AND "status" <> 'DISCONNECTED';
