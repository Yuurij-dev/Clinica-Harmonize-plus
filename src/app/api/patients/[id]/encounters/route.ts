import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyUnless } from "@/lib/api-guards";
import { clinicToday } from "@/lib/clinic-time";
import { evaluationEncounter, followUpDraftEncounter, followUpEncounter, sessionEncounter, sortEncounters } from "@/lib/clinical-record-rules";
import { prisma } from "@/lib/prisma";

const maxPerType = 200;

type PhotoCountRow = { kind: string; id: string; count: number };

async function countPhotos(clinicId: string, patientId: string, ids: { session: string[]; followup: string[]; draft: string[] }) {
  const counts = new Map<string, number>();
  const empty = (list: string[]) => list.length === 0;
  const query = (table: string, kind: string, idColumn: string, list: string[], scope: Prisma.Sql) => empty(list) ? [] : prisma.$queryRaw<PhotoCountRow[]>(Prisma.sql`
    SELECT ${kind}::text AS kind, t.${Prisma.raw(`"${idColumn}"`)} AS id, (CASE WHEN json_typeof(t."photos"::json) = 'array' THEN json_array_length(t."photos"::json) ELSE 0 END)::int AS count
      FROM ${Prisma.raw(`"${table}"`)} t ${scope} AND t.${Prisma.raw(`"${idColumn}"`)} = ANY(${list}::text[])`);
  const scopes = {
    session: Prisma.sql`WHERE t."clinicId" = ${clinicId} AND t."patientId" = ${patientId}`,
    followup: Prisma.sql`WHERE t."clinicId" = ${clinicId} AND t."patientId" = ${patientId}`,
    draft: Prisma.sql`INNER JOIN "PatientProcedureSession" s ON s."id" = t."sessionId" WHERE s."clinicId" = ${clinicId} AND s."patientId" = ${patientId}`,
  };
  const jobs: Array<[string, string, string, string[]]> = [["PatientProcedureSession", "session", "id", ids.session], ["PatientProcedureFollowUp", "followup", "id", ids.followup], ["PatientProcedureFollowUpDraft", "draft", "sessionId", ids.draft]];
  for (const [table, kind, idColumn, list] of jobs) {
    try {
      for (const row of await query(table, kind, idColumn, list, scopes[kind as keyof typeof scopes])) counts.set(`${row.kind}:${row.id}`, Number(row.count));
    } catch {
      // JSON inválido em alguma linha: tenta uma a uma e conta 0 só nas ruins.
      for (const id of list) {
        try {
          for (const row of await query(table, kind, idColumn, [id], scopes[kind as keyof typeof scopes])) counts.set(`${row.kind}:${row.id}`, Number(row.count));
        } catch { counts.set(`${kind}:${id}`, 0); }
      }
    }
  }
  return counts;
}

// Lista unificada e enxuta de atendimentos do paciente, derivada de avaliações, sessões de procedimento e retornos.
// Sem imagens: as contagens de fotos vêm de agregação (json_array_length / _count), nunca do base64.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
  const denied = denyUnless(user, "clinical:read");
  if (denied) return denied;
  const patientId = (await params).id;
  const clinicId = user.clinicId;
  const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId }, select: { id: true } });
  if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });

  const [evaluations, sessions, followUps, drafts, pendingOutputs, journeys, nextReturn] = await Promise.all([
    prisma.evaluation.findMany({
      where: { patientId, clinicId }, orderBy: { createdAt: "desc" }, take: maxPerType,
      select: { id: true, journeyId: true, professional: true, status: true, createdAt: true, chiefComplaint: true, patientGoal: true, clinicalNotes: true, _count: { select: { photos: true } } },
    }),
    prisma.patientProcedureSession.findMany({
      where: { patientId, clinicId }, orderBy: { performedAt: "desc" }, take: maxPerType,
      select: { id: true, journeyId: true, quoteId: true, procedureName: true, treatedAreas: true, technique: true, professional: true, status: true, performedAt: true, startedAt: true, observations: true, complications: true },
    }),
    prisma.patientProcedureFollowUp.findMany({
      where: { patientId, clinicId }, orderBy: { occurredAt: "desc" }, take: maxPerType,
      select: { id: true, journeyId: true, sessionId: true, occurredAt: true, professional: true, complaints: true, observations: true, guidanceText: true, session: { select: { procedureName: true, treatedAreas: true } } },
    }),
    prisma.patientProcedureFollowUpDraft.findMany({
      where: { session: { patientId, clinicId } }, take: maxPerType,
      select: { sessionId: true, complaints: true, guidanceText: true, observations: true, complications: true, updatedAt: true, session: { select: { journeyId: true, procedureName: true, treatedAreas: true, professional: true } } },
    }),
    prisma.pendingStockOutput.findMany({ where: { clinicId, patientId, status: "pending", procedureSessionId: { not: null } }, select: { procedureSessionId: true } }),
    prisma.patientJourney.findMany({ where: { patientId, clinicId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, name: true, status: true, professional: true, createdAt: true, archivedAt: true } }),
    prisma.appointment.findFirst({
      where: { patientId, clinicId, status: "Agendado", procedure: { contains: "retorno", mode: "insensitive" }, date: { gte: new Date(`${clinicToday()}T00:00:00-03:00`) } },
      orderBy: [{ date: "asc" }, { time: "asc" }],
      select: { id: true, journeyId: true, date: true, time: true, procedure: true, professional: true, notes: true },
    }),
  ]);

  // Contagem de fotos só dos registros já selecionados; uma linha com JSON corrompido vale 0 e não derruba a lista.
  const photos = await countPhotos(clinicId, patientId, { session: sessions.map((row) => row.id), followup: followUps.map((row) => row.id), draft: drafts.map((row) => row.sessionId) });
  const journeyNames = new Map(journeys.map((journey) => [journey.id, journey.name]));
  const sessionsWithPendingMaterials = new Set(pendingOutputs.flatMap((output) => output.procedureSessionId ? [output.procedureSessionId] : []));
  const nameOf = (journeyId: string | null) => (journeyId ? journeyNames.get(journeyId) ?? "" : "");

  const items = sortEncounters([
    ...evaluations.map((row) => evaluationEncounter({ ...row, createdAt: row.createdAt.toISOString(), journeyName: nameOf(row.journeyId), photoCount: row._count.photos })),
    ...sessions.map((row) => sessionEncounter({ ...row, performedAt: row.performedAt.toISOString(), startedAt: row.startedAt?.toISOString() ?? null, journeyName: nameOf(row.journeyId), photoCount: photos.get(`session:${row.id}`) ?? 0, pendingMaterials: sessionsWithPendingMaterials.has(row.id) })),
    ...followUps.map((row) => followUpEncounter({ ...row, procedureName: row.session.procedureName, treatedAreas: row.session.treatedAreas, occurredAt: row.occurredAt.toISOString(), journeyName: nameOf(row.journeyId), photoCount: photos.get(`followup:${row.id}`) ?? 0 })),
    // Rascunho de retorno sem nada preenchido não é um atendimento em andamento.
    ...drafts.filter((row) => row.complaints.trim() || row.guidanceText.trim() || row.observations.trim() || row.complications.trim() || (photos.get(`draft:${row.sessionId}`) ?? 0) > 0)
      .map((row) => followUpDraftEncounter({ sessionId: row.sessionId, journeyId: row.session.journeyId, journeyName: nameOf(row.session.journeyId), procedureName: row.session.procedureName, treatedAreas: row.session.treatedAreas, professional: row.session.professional, updatedAt: row.updatedAt.toISOString(), complaints: row.complaints, observations: row.observations, photoCount: photos.get(`draft:${row.sessionId}`) ?? 0 })),
  ]);

  return NextResponse.json({
    items,
    journeys: journeys.filter((journey) => !journey.archivedAt).map((journey) => ({ id: journey.id, name: journey.name, status: journey.status, professional: journey.professional, createdAt: journey.createdAt })),
    nextReturn,
    truncated: [evaluations, sessions, followUps].some((list) => list.length >= maxPerType),
  });
}
