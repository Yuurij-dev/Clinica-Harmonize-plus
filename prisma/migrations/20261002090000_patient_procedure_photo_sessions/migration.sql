CREATE TABLE "PatientProcedurePhotoSession" (
    "id" TEXT NOT NULL,
    "procedureId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "beforePhoto" TEXT,
    "afterPhoto" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "PatientProcedurePhotoSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PatientProcedurePhotoSession_procedureId_fkey" FOREIGN KEY ("procedureId") REFERENCES "PatientProcedure"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX "PatientProcedurePhotoSession_procedureId_createdAt_idx" ON "PatientProcedurePhotoSession"("procedureId", "createdAt");
