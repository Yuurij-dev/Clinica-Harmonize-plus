-- Tipo da observação: "clinical" (só equipe clínica) ou "administrative" (todos). As existentes ficam clínicas.
ALTER TABLE "PatientObservation" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'clinical';
