-- CreateTable
CREATE TABLE "ClinicalDocument" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "journeyId" TEXT,
    "encounterType" TEXT,
    "encounterId" TEXT,
    "category" TEXT NOT NULL DEFAULT 'OUTROS',
    "name" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageDriver" TEXT NOT NULL DEFAULT 'db',
    "storageKey" TEXT,
    "signatureStatus" TEXT NOT NULL DEFAULT 'NAO_APLICAVEL',
    "uploadedBy" TEXT NOT NULL,
    "uploadedByName" TEXT NOT NULL,
    "uploadedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "archivedAt" TIMESTAMPTZ(6),
    "archivedBy" TEXT,
    "archiveReason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ClinicalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalDocumentBlob" (
    "documentId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "ClinicalDocumentBlob_pkey" PRIMARY KEY ("documentId")
);

-- CreateTable
CREATE TABLE "ClinicalPhoto" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "journeyId" TEXT,
    "encounterType" TEXT,
    "encounterId" TEXT,
    "phase" TEXT NOT NULL DEFAULT 'OUTRA',
    "category" TEXT NOT NULL DEFAULT 'Outra',
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageDriver" TEXT NOT NULL DEFAULT 'db',
    "storageKey" TEXT,
    "takenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT NOT NULL,
    "uploadedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "archivedAt" TIMESTAMPTZ(6),
    "archivedBy" TEXT,

    CONSTRAINT "ClinicalPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalPhotoBlob" (
    "photoId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "ClinicalPhotoBlob_pkey" PRIMARY KEY ("photoId")
);

-- CreateTable
CREATE TABLE "ClinicalFileAudit" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "fileKind" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "fileName" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalFileAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClinicalDocument_clinicId_patientId_archivedAt_uploadedAt_idx" ON "ClinicalDocument"("clinicId", "patientId", "archivedAt", "uploadedAt");

-- CreateIndex
CREATE INDEX "ClinicalDocument_clinicId_patientId_category_idx" ON "ClinicalDocument"("clinicId", "patientId", "category");

-- CreateIndex
CREATE INDEX "ClinicalDocument_journeyId_idx" ON "ClinicalDocument"("journeyId");

-- CreateIndex
CREATE INDEX "ClinicalPhoto_clinicId_patientId_archivedAt_takenAt_idx" ON "ClinicalPhoto"("clinicId", "patientId", "archivedAt", "takenAt");

-- CreateIndex
CREATE INDEX "ClinicalPhoto_journeyId_idx" ON "ClinicalPhoto"("journeyId");

-- CreateIndex
CREATE INDEX "ClinicalFileAudit_clinicId_patientId_createdAt_idx" ON "ClinicalFileAudit"("clinicId", "patientId", "createdAt");

-- CreateIndex
CREATE INDEX "ClinicalFileAudit_fileId_idx" ON "ClinicalFileAudit"("fileId");

-- AddForeignKey
ALTER TABLE "ClinicalDocument" ADD CONSTRAINT "ClinicalDocument_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ClinicalDocument" ADD CONSTRAINT "ClinicalDocument_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ClinicalDocumentBlob" ADD CONSTRAINT "ClinicalDocumentBlob_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ClinicalDocument"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ClinicalPhoto" ADD CONSTRAINT "ClinicalPhoto_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ClinicalPhoto" ADD CONSTRAINT "ClinicalPhoto_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ClinicalPhotoBlob" ADD CONSTRAINT "ClinicalPhotoBlob_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "ClinicalPhoto"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ClinicalFileAudit" ADD CONSTRAINT "ClinicalFileAudit_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

