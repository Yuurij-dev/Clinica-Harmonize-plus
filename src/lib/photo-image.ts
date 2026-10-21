import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { detectFileType } from "./clinical-files-rules";
import { readStoredBytes } from "./clinical-storage";
import { parsePhotoRef } from "./photo-gallery-rules";

export type PhotoBytes = { bytes: Uint8Array; mime: string; name: string };

// Decodifica "data:image/...;base64,...." sem regex sobre a string inteira.
export function bytesFromDataUrl(value: string | null | undefined): Uint8Array | null {
  if (!value || !value.startsWith("data:image/")) return null;
  const comma = value.indexOf(",");
  if (comma < 0 || !value.slice(0, comma).endsWith(";base64")) return null;
  return new Uint8Array(Buffer.from(value.slice(comma + 1), "base64"));
}

// Foto dentro de um JSON (sessão/retorno): extrai só o imageUrl do elemento pedido, no banco.
async function jsonPhoto(table: "PatientProcedureSession" | "PatientProcedureFollowUp", rowId: string, photoId: string, clinicId: string, patientId: string) {
  const rows = await prisma.$queryRaw<Array<{ url: string | null }>>(Prisma.sql`
    SELECT e.value->>'imageUrl' AS url
      FROM ${Prisma.raw(`"${table}"`)} t, jsonb_array_elements(CASE WHEN jsonb_typeof(t."photos"::jsonb) = 'array' THEN t."photos"::jsonb ELSE '[]'::jsonb END) WITH ORDINALITY AS e(value, n)
     WHERE t."id" = ${rowId} AND t."clinicId" = ${clinicId} AND t."patientId" = ${patientId}
       AND jsonb_typeof(e.value) = 'object'
       AND (e.value->>'id' = ${photoId} OR (e.value->>'id' IS NULL AND ${photoId} = 'idx' || (e.n - 1)::text))
     LIMIT 1`);
  return rows[0]?.url ?? null;
}

// Resolve os bytes de qualquer fonte de foto, sempre escopados por clínica e paciente.
export async function loadPhotoBytes(clinicId: string, patientId: string, ref: string): Promise<PhotoBytes | null> {
  const parsed = parsePhotoRef(ref);
  if (!parsed) return null;
  const { source, parts } = parsed;
  let bytes: Uint8Array | null = null;
  let name = "foto";
  if (source === "evaluation" && parts.length === 1) {
    const photo = await prisma.evaluationPhoto.findFirst({ where: { id: parts[0], evaluation: { clinicId, patientId } }, select: { imageUrl: true, name: true } });
    bytes = bytesFromDataUrl(photo?.imageUrl); name = photo?.name ?? name;
  } else if ((source === "session" || source === "followup") && parts.length === 2) {
    if (source === "followup") {
      // Mesma regra da galeria: foto removida do retorno não é servida por essa referência (outra fonte legítima continua valendo pela sua ref).
      const followUp = await prisma.patientProcedureFollowUp.findFirst({ where: { id: parts[0], clinicId, patientId }, select: { removedPhotoIds: true } });
      if (!followUp) return null;
      let removed: unknown = [];
      try { removed = JSON.parse(followUp.removedPhotoIds); } catch { removed = []; }
      if (Array.isArray(removed) && removed.includes(parts[1])) return null;
    }
    const url = await jsonPhoto(source === "session" ? "PatientProcedureSession" : "PatientProcedureFollowUp", parts[0], parts[1], clinicId, patientId);
    bytes = bytesFromDataUrl(url);
  } else if (source === "legacy" && parts.length === 3 && (parts[2] === "before" || parts[2] === "after")) {
    const column = parts[2] === "before" ? "beforePhoto" : "afterPhoto";
    if (parts[0] === "procedure") {
      const row = await prisma.patientProcedure.findFirst({ where: { id: parts[1], clinicId, patientId }, select: { beforePhoto: true, afterPhoto: true } });
      bytes = bytesFromDataUrl(row?.[column]);
    } else if (parts[0] === "photosession") {
      const row = await prisma.patientProcedurePhotoSession.findFirst({ where: { id: parts[1], procedure: { clinicId, patientId } }, select: { beforePhoto: true, afterPhoto: true } });
      bytes = bytesFromDataUrl(row?.[column]);
    }
  } else if (source === "gallery" && parts.length === 1) {
    const row = await prisma.clinicalPhoto.findFirst({ where: { id: parts[0], clinicId, patientId }, select: { id: true, name: true, storageDriver: true, storageKey: true } });
    if (row) { bytes = await readStoredBytes("photo", row.id, row); name = row.name; }
  }
  if (!bytes) return null;
  const detected = detectFileType(bytes);
  if (!detected?.isImage) return null;
  return { bytes, mime: detected.mime, name };
}
