import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { denyUnless } from "@/lib/api-guards";
import { canArchiveFiles, canDeleteFiles, checkUpload, isPhotoPhase, maxUploadBytes, photoCategoryNames, sanitizeFileName } from "@/lib/clinical-files-rules";
import { auditEntry, findPatientScoped, readUploadForm, resolveLinks, sha256 } from "@/lib/clinical-files-server";
import { prepareStorage, removeStoredBytes } from "@/lib/clinical-storage";
import { buildGalleryIndex, type FollowUpRow, type LegacyRow, type SessionPhotoMeta, type SessionRow } from "@/lib/photo-gallery-rules";

type RawSession = { id: string; journeyId: string; evaluationId: string; procedureName: string; treatedAreas: string; professional: string; performedAt: Date; photos: unknown };
type RawFollowUp = { id: string; sessionId: string; journeyId: string; occurredAt: Date; professional: string; procedureName: string; photos: unknown; removedPhotoIds: string };
type RawLegacy = { id: string; journeyId: string | null; name: string; professional: string; performedAt: Date; hasBefore: boolean; hasAfter: boolean };
type RawLegacySession = { id: string; procedureId: string; name: string; hasBefore: boolean; hasAfter: boolean };

// Remove imageUrl no próprio banco: o índice nunca carrega base64.
// Ordem garantida (ORDER BY ordinalidade) e itens que não são objeto viram {"__invalid":true}: preservam o índice idxN usado como id de foto sem id.
const stripped = (column: Prisma.Sql) => Prisma.sql`COALESCE((SELECT jsonb_agg(CASE WHEN jsonb_typeof(e.value) = 'object' THEN e.value - 'imageUrl' ELSE '{"__invalid": true}'::jsonb END ORDER BY e.n) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${column}::jsonb) = 'array' THEN ${column}::jsonb ELSE '[]'::jsonb END) WITH ORDINALITY AS e(value, n)), '[]'::jsonb)`;

function metas(value: unknown): SessionPhotoMeta[] {
  const list = typeof value === "string" ? safeParse(value) : value;
  // Mesmo índice do SQL: item que não é objeto vira marcador inválido em vez de ser descartado (senão idxN desloca).
  return Array.isArray(list) ? list.map((item): SessionPhotoMeta => item && typeof item === "object" && !Array.isArray(item) ? item as SessionPhotoMeta : { __invalid: true }) : [];
}
function safeParse(text: string): unknown { try { return JSON.parse(text); } catch { return []; } }

// JSON malformado em alguma linha derruba a consulta em SQL; nesse caso lê linha a linha pelo Prisma e descarta o que não for lista.
async function sessionRows(clinicId: string, patientId: string): Promise<RawSession[]> {
  try {
    return await prisma.$queryRaw<RawSession[]>(Prisma.sql`SELECT s."id", s."journeyId", s."evaluationId", s."procedureName", s."treatedAreas", s."professional", s."performedAt", ${stripped(Prisma.sql`s."photos"`)} AS photos FROM "PatientProcedureSession" s WHERE s."clinicId" = ${clinicId} AND s."patientId" = ${patientId}`);
  } catch {
    const rows = await prisma.patientProcedureSession.findMany({ where: { clinicId, patientId }, select: { id: true, journeyId: true, evaluationId: true, procedureName: true, treatedAreas: true, professional: true, performedAt: true, photos: true } });
    return rows.map((row) => ({ ...row, photos: metas(row.photos).map(({ ...rest }) => { delete (rest as Record<string, unknown>).imageUrl; return rest; }) }));
  }
}
async function followUpRows(clinicId: string, patientId: string): Promise<RawFollowUp[]> {
  try {
    return await prisma.$queryRaw<RawFollowUp[]>(Prisma.sql`SELECT f."id", f."sessionId", f."journeyId", f."occurredAt", f."professional", s."procedureName", f."removedPhotoIds", ${stripped(Prisma.sql`f."photos"`)} AS photos FROM "PatientProcedureFollowUp" f INNER JOIN "PatientProcedureSession" s ON s."id" = f."sessionId" WHERE f."clinicId" = ${clinicId} AND f."patientId" = ${patientId}`);
  } catch {
    const rows = await prisma.patientProcedureFollowUp.findMany({ where: { clinicId, patientId }, select: { id: true, sessionId: true, journeyId: true, occurredAt: true, professional: true, photos: true, removedPhotoIds: true, session: { select: { procedureName: true } } } });
    return rows.map(({ session, ...row }) => ({ ...row, procedureName: session.procedureName, photos: metas(row.photos).map(({ ...rest }) => { delete (rest as Record<string, unknown>).imageUrl; return rest; }) }));
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user.role, "clinical:read");
  if (denied) return denied;
  const patientId = (await params).id;
  const clinicId = user.clinicId;
  if (!await findPatientScoped(clinicId, patientId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });

  const [evaluations, sessions, followUps, legacyRows, legacySessionRows, uploads, journeys] = await Promise.all([
    // EvaluationPhoto não tem clinicId: o escopo vem da avaliação.
    prisma.evaluation.findMany({ where: { clinicId, patientId }, select: { id: true, journeyId: true, professional: true, status: true, createdAt: true, photos: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, category: true, width: true, height: true, annotations: true, createdAt: true } } } }),
    sessionRows(clinicId, patientId),
    followUpRows(clinicId, patientId),
    prisma.$queryRaw<RawLegacy[]>(Prisma.sql`SELECT p."id", p."journeyId", p."name", p."professional", p."performedAt", (p."beforePhoto" IS NOT NULL AND p."beforePhoto" <> '') AS "hasBefore", (p."afterPhoto" IS NOT NULL AND p."afterPhoto" <> '') AS "hasAfter" FROM "PatientProcedure" p WHERE p."clinicId" = ${clinicId} AND p."patientId" = ${patientId}`),
    prisma.$queryRaw<RawLegacySession[]>(Prisma.sql`SELECT ps."id", ps."procedureId", ps."name", (ps."beforePhoto" IS NOT NULL AND ps."beforePhoto" <> '') AS "hasBefore", (ps."afterPhoto" IS NOT NULL AND ps."afterPhoto" <> '') AS "hasAfter" FROM "PatientProcedurePhotoSession" ps INNER JOIN "PatientProcedure" p ON p."id" = ps."procedureId" WHERE p."clinicId" = ${clinicId} AND p."patientId" = ${patientId}`),
    prisma.clinicalPhoto.findMany({ where: { clinicId, patientId }, select: { id: true, journeyId: true, encounterType: true, encounterId: true, phase: true, category: true, name: true, width: true, height: true, takenAt: true, uploadedByName: true, archivedAt: true } }),
    prisma.patientJourney.findMany({ where: { clinicId, patientId }, select: { id: true, name: true, archivedAt: true }, orderBy: { createdAt: "desc" }, take: 200 }),
  ]);

  const legacy: LegacyRow[] = legacyRows.filter((row) => row.hasBefore || row.hasAfter || legacySessionRows.some((session) => session.procedureId === row.id && (session.hasBefore || session.hasAfter))).map((row) => ({
    id: row.id, journeyId: row.journeyId, name: row.name, professional: row.professional, performedAt: row.performedAt.toISOString(), hasBefore: row.hasBefore, hasAfter: row.hasAfter,
    sessions: legacySessionRows.filter((session) => session.procedureId === row.id).map((session) => ({ id: session.id, name: session.name, hasBefore: session.hasBefore, hasAfter: session.hasAfter })),
  }));
  const sessionList: SessionRow[] = sessions.map((row) => ({ ...row, performedAt: row.performedAt.toISOString(), photos: metas(row.photos) }));
  const followUpList: FollowUpRow[] = followUps.map((row) => ({ id: row.id, sessionId: row.sessionId, journeyId: row.journeyId, occurredAt: row.occurredAt.toISOString(), professional: row.professional, procedureName: row.procedureName, photos: metas(row.photos), removedPhotoIds: (() => { const list = safeParse(row.removedPhotoIds); return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : []; })() }));

  const photos = buildGalleryIndex({
    evaluations: evaluations.map((row) => ({ id: row.id, journeyId: row.journeyId, professional: row.professional, status: row.status, createdAt: row.createdAt.toISOString(), photos: row.photos.map((photo) => ({ id: photo.id, name: photo.name, category: photo.category, width: photo.width, height: photo.height, hasAnnotations: photo.annotations.trim() !== "[]" && photo.annotations.trim() !== "", createdAt: photo.createdAt.toISOString() })) })),
    sessions: sessionList, followUps: followUpList, legacy,
    uploads: uploads.map((row) => ({ ...row, takenAt: row.takenAt.toISOString(), archivedAt: row.archivedAt?.toISOString() ?? null })),
    journeyNames: new Map(journeys.map((journey) => [journey.id, journey.name])),
  });
  return NextResponse.json({
    photos,
    journeys: journeys.map((journey) => ({ id: journey.id, name: journey.name })),
    // Atendimentos que aceitam vínculo no upload (avaliações e sessões).
    encounters: [
      ...evaluations.map((row) => ({ type: "evaluation", id: row.id, journeyId: row.journeyId, title: "Avaliação", date: row.createdAt.toISOString() })),
      ...sessionList.map((row) => ({ type: "session", id: row.id, journeyId: row.journeyId, title: row.procedureName, date: row.performedAt })),
    ].sort((a, b) => b.date.localeCompare(a.date)),
    access: { canWrite: user.role === "ADMIN" || user.role === "PROFESSIONAL", canArchive: canArchiveFiles(user.role), canDelete: canDeleteFiles(user.role), maxUploadBytes },
  });
}

// Upload de UMA foto por requisição (várias em sequência no cliente). Armazenada como ClinicalPhoto; fotos antigas não são tocadas.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user.role, "clinical:write");
  if (denied) return denied;
  const patientId = (await params).id;
  const clinicId = user.clinicId;
  if (!await findPatientScoped(clinicId, patientId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });

  // 413 antes de bufferizar o corpo.
  const read = await readUploadForm(request);
  if ("response" in read) return read.response;
  const form = read.form;
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ message: "Envie uma foto." }, { status: 400 });
  if (file.size > maxUploadBytes) return NextResponse.json({ message: "A foto excede 4 MB." }, { status: 413 });
  const phase = form.get("phase") || "OUTRA";
  const category = form.get("category") || "Outra";
  const width = Number(form.get("width"));
  const height = Number(form.get("height"));
  if (!isPhotoPhase(phase) || typeof category !== "string" || !(photoCategoryNames as readonly string[]).includes(category)) return NextResponse.json({ message: "Fase ou categoria inválida." }, { status: 400 });
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8000 || height > 8000 || width * height > 25_000_000) return NextResponse.json({ message: "Dimensões da imagem inválidas." }, { status: 400 });
  const takenRaw = form.get("takenAt");
  const takenAt = typeof takenRaw === "string" && takenRaw ? new Date(takenRaw) : new Date();
  if (Number.isNaN(takenAt.getTime()) || takenAt.getTime() > Date.now() + 86_400_000) return NextResponse.json({ message: "Data da foto inválida." }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkUpload(bytes, file.type || undefined, { imageOnly: true });
  if (!check.ok) return NextResponse.json({ message: check.message }, { status: check.status });
  const links = await resolveLinks(clinicId, patientId, { journeyId: form.get("journeyId"), encounterType: form.get("encounterType"), encounterId: form.get("encounterId") }, true);
  if (!links.ok) return NextResponse.json({ message: links.message }, { status: 400 });
  if (links.links.encounterType === "followup") return NextResponse.json({ message: "Vincule a foto a uma avaliação ou procedimento." }, { status: 400 });

  const name = sanitizeFileName(form.get("name") || file.name, "Foto").replace(/\.(jpe?g|png|webp)$/i, "");
  const id = crypto.randomUUID().replace(/-/g, "");
  const stored = await prepareStorage("photo", clinicId, patientId, id, bytes as Uint8Array<ArrayBuffer>, check.file.mime).catch(() => null);
  if (!stored) return NextResponse.json({ message: "Não foi possível gravar a foto." }, { status: 502 });
  const [created] = await prisma.$transaction([prisma.clinicalPhoto.create({
    data: { id, clinicId, patientId, ...links.links, phase, category, name, mimeType: check.file.mime, sizeBytes: bytes.length, width, height, sha256: sha256(bytes), storageDriver: stored.storageDriver, storageKey: stored.storageKey, takenAt, uploadedBy: user.id, uploadedByName: user.name, blob: stored.blob },
    select: { id: true },
  }), auditEntry(user, patientId, "PHOTO", id, "UPLOAD", { fileName: name, category })]).catch(async (error) => { await removeStoredBytes(stored); throw error; });
  return NextResponse.json({ id: created.id }, { status: 201 });
}
