import { getCurrentUser } from "@/lib/auth";
import { denyUnless } from "@/lib/api-guards";
import { can } from "@/lib/permissions";
import { loadPhotoBytes } from "@/lib/photo-image";
import { prisma } from "@/lib/prisma";
import { parsePhotoRef, photoRef } from "@/lib/photo-gallery-rules";
import { Prisma } from "@prisma/client";
import { recordReadAudit } from "@/lib/clinical-files-server";

const json = (message: string, status: number) => Response.json({ message }, { status });

// A miniatura é servida sob demanda; o JSON da lista de pacientes nunca inclui bytes nem base64 de fotos.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return json("Não autenticado.", 401);
  const denied = denyUnless(user, "patients:access");
  if (denied) return denied;
  if (!can(user.role, "clinical:read", user.rolePermissions)) return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });

  const patientId = (await params).id;
  const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId: user.clinicId }, select: { id: true, profilePhotoRef: true } });
  if (!patient) return json("Paciente não encontrado.", 404);

  const selected = patient.profilePhotoRef ? await loadUsablePhoto(user.clinicId, patientId, patient.profilePhotoRef) : null;
  const chosen = selected ? patient.profilePhotoRef! : await findFallbackRef(user.clinicId, patientId);
  if (!chosen) return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  const photo = selected ?? await loadPhotoBytes(user.clinicId, patientId, chosen);
  if (!photo) return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });

  const parsed = chosen.split(":");
  const auditId = parsed[0] === "gallery" ? parsed[1] : chosen;
  await recordReadAudit(user, patientId, "PHOTO", auditId, "VIEW", { fileName: photo.name }, 10);
  const thumbnail = await makeAvatarThumbnail(photo.bytes);
  if (!thumbnail) return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  return new Response(thumbnail as Uint8Array<ArrayBuffer>, { headers: { "Content-Type": "image/jpeg", "Content-Length": String(thumbnail.length), "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" } });
}

async function makeAvatarThumbnail(bytes: Uint8Array) {
  try {
    const { default: sharp } = await import("sharp");
    const result = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "none" }).rotate().resize({ width: 112, height: 112, fit: "cover", position: "attention", withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
    return new Uint8Array(result);
  } catch {
    return null;
  }
}

// Uma escolha manual tem precedência; sem ela, uma foto "Depois" vence qualquer "Antes".
async function findFallbackRef(clinicId: string, patientId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ phase: "ANTES" | "DEPOIS"; source: string; id1: string; id2: string | null }>>(Prisma.sql`
    SELECT phase, source, id1, id2 FROM (
      SELECT 'DEPOIS'::text AS phase, 'gallery'::text AS source, p."id" AS id1, NULL::text AS id2, p."takenAt" AS "takenAt" FROM "ClinicalPhoto" p WHERE p."clinicId" = ${clinicId} AND p."patientId" = ${patientId} AND p."archivedAt" IS NULL AND p."phase" = 'DEPOIS'
      UNION ALL
      SELECT 'ANTES', 'gallery', p."id", NULL, p."takenAt" FROM "ClinicalPhoto" p WHERE p."clinicId" = ${clinicId} AND p."patientId" = ${patientId} AND p."archivedAt" IS NULL AND p."phase" = 'ANTES'
      UNION ALL
      SELECT 'DEPOIS', 'legacy-procedure', p."id", NULL, p."performedAt" FROM "PatientProcedure" p WHERE p."clinicId" = ${clinicId} AND p."patientId" = ${patientId} AND p."afterPhoto" IS NOT NULL AND p."afterPhoto" <> ''
      UNION ALL
      SELECT 'ANTES', 'legacy-procedure', p."id", NULL, p."performedAt" FROM "PatientProcedure" p WHERE p."clinicId" = ${clinicId} AND p."patientId" = ${patientId} AND p."beforePhoto" IS NOT NULL AND p."beforePhoto" <> ''
      UNION ALL
      SELECT 'DEPOIS', 'legacy-photosession', ps."id", NULL, ps."updatedAt" FROM "PatientProcedurePhotoSession" ps INNER JOIN "PatientProcedure" p ON p."id" = ps."procedureId" WHERE p."clinicId" = ${clinicId} AND p."patientId" = ${patientId} AND ps."afterPhoto" IS NOT NULL AND ps."afterPhoto" <> ''
      UNION ALL
      SELECT 'ANTES', 'legacy-photosession', ps."id", NULL, ps."updatedAt" FROM "PatientProcedurePhotoSession" ps INNER JOIN "PatientProcedure" p ON p."id" = ps."procedureId" WHERE p."clinicId" = ${clinicId} AND p."patientId" = ${patientId} AND ps."beforePhoto" IS NOT NULL AND ps."beforePhoto" <> ''
      UNION ALL
      SELECT CASE WHEN lower(COALESCE(e.value->>'phase', '')) IN ('depois', 'imediatamente após', 'imediatamente apos') THEN 'DEPOIS' ELSE 'ANTES' END, 'session', s."id", COALESCE(e.value->>'id', 'idx' || (e.n - 1)::text), s."performedAt"
        FROM "PatientProcedureSession" s CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s."photos"::jsonb) = 'array' THEN s."photos"::jsonb ELSE '[]'::jsonb END) WITH ORDINALITY AS e(value, n)
       WHERE s."clinicId" = ${clinicId} AND s."patientId" = ${patientId} AND jsonb_typeof(e.value) = 'object'
         AND lower(COALESCE(e.value->>'phase', '')) IN ('antes', 'depois', 'imediatamente após', 'imediatamente apos')
         AND COALESCE(e.value->>'imageUrl', '') LIKE 'data:image/%' AND COALESCE(e.value->>'sourceEvaluationPhotoId', '') = ''
      UNION ALL
      SELECT CASE WHEN lower(COALESCE(e.value->>'phase', '')) IN ('depois', 'imediatamente após', 'imediatamente apos') THEN 'DEPOIS' ELSE 'ANTES' END, 'followup', f."id", COALESCE(e.value->>'id', 'idx' || (e.n - 1)::text), f."occurredAt"
        FROM "PatientProcedureFollowUp" f CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(f."photos"::jsonb) = 'array' THEN f."photos"::jsonb ELSE '[]'::jsonb END) WITH ORDINALITY AS e(value, n)
       WHERE f."clinicId" = ${clinicId} AND f."patientId" = ${patientId} AND jsonb_typeof(e.value) = 'object'
         AND lower(COALESCE(e.value->>'phase', '')) IN ('antes', 'depois', 'imediatamente após', 'imediatamente apos')
         AND COALESCE(e.value->>'imageUrl', '') LIKE 'data:image/%'
         AND NOT COALESCE(f."removedPhotoIds"::jsonb ? COALESCE(e.value->>'id', 'idx' || (e.n - 1)::text), false)
      UNION ALL
      SELECT 'ANTES', 'evaluation', ep."id", NULL, ep."createdAt" FROM "EvaluationPhoto" ep INNER JOIN "Evaluation" e ON e."id" = ep."evaluationId" WHERE e."clinicId" = ${clinicId} AND e."patientId" = ${patientId}
    ) photos
    ORDER BY CASE WHEN phase = 'DEPOIS' THEN 0 ELSE 1 END, "takenAt" DESC, id1 DESC, id2 DESC NULLS LAST LIMIT 1`);
  const row = rows[0];
  if (!row) return null;
  if (row.source === "gallery") return photoRef("gallery", row.id1);
  if (row.source === "legacy-procedure") return photoRef("legacy", "procedure", row.id1, row.phase === "DEPOIS" ? "after" : "before");
  if (row.source === "legacy-photosession") return photoRef("legacy", "photosession", row.id1, row.phase === "DEPOIS" ? "after" : "before");
  if (row.source === "session") return photoRef("session", row.id1, row.id2 ?? "");
  if (row.source === "followup") return photoRef("followup", row.id1, row.id2 ?? "");
  return photoRef("evaluation", row.id1);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return json("Não autenticado.", 401);
  const denied = denyUnless(user, "patients:access");
  if (denied) return denied;
  if (!can(user.role, "clinical:write", user.rolePermissions)) return json("Acesso restrito à equipe clínica.", 403);
  const patientId = (await params).id;
  const body = await request.json().catch(() => null) as { photoRef?: unknown } | null;
  if (!body || (body.photoRef !== null && (typeof body.photoRef !== "string" || body.photoRef.length > 500))) return json("Foto de perfil inválida.", 400);
  if (!await prisma.patient.findFirst({ where: { id: patientId, clinicId: user.clinicId }, select: { id: true } })) return json("Paciente não encontrado.", 404);
  if (typeof body.photoRef === "string" && !await loadUsablePhoto(user.clinicId, patientId, body.photoRef)) return json("A foto não pertence a este paciente ou não está disponível.", 404);
  await prisma.patient.update({ where: { id: patientId, clinicId: user.clinicId }, data: { profilePhotoRef: body.photoRef as string | null } });
  return Response.json({ ok: true });
}

async function loadUsablePhoto(clinicId: string, patientId: string, ref: string) {
  const parsed = parsePhotoRef(ref);
  if (!parsed) return null;
  if (parsed.source === "gallery") {
    const photo = await prisma.clinicalPhoto.findFirst({ where: { id: parsed.parts[0], clinicId, patientId, archivedAt: null }, select: { id: true } });
    if (!photo) return null;
  }
  return loadPhotoBytes(clinicId, patientId, ref);
}
