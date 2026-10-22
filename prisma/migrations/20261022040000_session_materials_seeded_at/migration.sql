-- AlterTable
-- Marca a sessão cujos materiais já foram preenchidos pela ficha técnica (aditivo, nullable; sem backfill).
ALTER TABLE "PatientProcedureSession" ADD COLUMN "materialsSeededAt" TIMESTAMPTZ(6);
