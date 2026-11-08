-- AlterTable
ALTER TABLE "User" ADD COLUMN     "activeClinicId" TEXT;

-- CreateIndex
CREATE INDEX "User_activeClinicId_idx" ON "User"("activeClinicId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_activeClinicId_fkey" FOREIGN KEY ("activeClinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
