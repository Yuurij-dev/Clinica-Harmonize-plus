import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { appointmentHasPassed, clinicNow } from "@/lib/clinic-time";
import { prisma } from "@/lib/prisma";

async function getPatient(patientId: string, clinicId: string) {
  return prisma.patient.findFirst({ where: { id: patientId, clinicId }, select: { id: true, clinicId: true } });
}

const journeyProgressSelect = {
  id: true,
  name: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
  evaluations: { take: 1, select: { id: true } },
  quotes: { select: { id: true, status: true, createdAt: true } },
  appointments: { orderBy: [{ date: "desc" }, { time: "desc" }], select: { id: true, date: true, time: true, procedure: true, professional: true, status: true } },
  procedures: { orderBy: { performedAt: "desc" }, take: 10, select: { id: true, name: true, professional: true, performedAt: true } },
  procedureSessions: { orderBy: { performedAt: "desc" }, take: 20, select: { id: true, procedureId: true, quoteId: true, professional: true, performedAt: true, status: true } },
  _count: { select: { procedures: true, appointments: true, procedureSessions: true } },
} satisfies Prisma.PatientJourneySelect;

type JourneyRow = Prisma.PatientJourneyGetPayload<{ select: typeof journeyProgressSelect }>;

// As fotos são base64 grandes: só os ids das jornadas que têm foto saem do banco.
async function serializeJourneys(patientId: string, clinicId: string, journeys: JourneyRow[]) {
  const now = clinicNow();
  const photoCounts = journeys.length ? await prisma.$queryRaw<Array<{ journeyId: string; category: string; count: bigint }>>`
    SELECT "journeyId", category, SUM(amount)::bigint AS count
    FROM (
      SELECT "journeyId", 'before' AS category, COUNT(*) AS amount FROM "PatientProcedure" WHERE "patientId" = ${patientId} AND "clinicId" = ${clinicId} AND "journeyId" IS NOT NULL AND "beforePhoto" IS NOT NULL AND "beforePhoto" <> '' GROUP BY "journeyId"
      UNION ALL
      SELECT "journeyId", 'after' AS category, COUNT(*) AS amount FROM "PatientProcedure" WHERE "patientId" = ${patientId} AND "clinicId" = ${clinicId} AND "journeyId" IS NOT NULL AND "afterPhoto" IS NOT NULL AND "afterPhoto" <> '' GROUP BY "journeyId"
      UNION ALL
      SELECT p."journeyId", 'before' AS category, COUNT(*) AS amount FROM "PatientProcedurePhotoSession" s INNER JOIN "PatientProcedure" p ON p."id" = s."procedureId" WHERE p."patientId" = ${patientId} AND p."clinicId" = ${clinicId} AND p."journeyId" IS NOT NULL AND s."beforePhoto" IS NOT NULL AND s."beforePhoto" <> '' GROUP BY p."journeyId"
      UNION ALL
      SELECT p."journeyId", 'after' AS category, COUNT(*) AS amount FROM "PatientProcedurePhotoSession" s INNER JOIN "PatientProcedure" p ON p."id" = s."procedureId" WHERE p."patientId" = ${patientId} AND p."clinicId" = ${clinicId} AND p."journeyId" IS NOT NULL AND s."afterPhoto" IS NOT NULL AND s."afterPhoto" <> '' GROUP BY p."journeyId"
      UNION ALL
      SELECT e."journeyId", 'evaluation' AS category, COUNT(*) AS amount FROM "EvaluationPhoto" ep INNER JOIN "Evaluation" e ON e."id" = ep."evaluationId" WHERE e."patientId" = ${patientId} AND e."clinicId" = ${clinicId} AND e."journeyId" IS NOT NULL GROUP BY e."journeyId"
      UNION ALL
      SELECT "journeyId", 'session' AS category, SUM(json_array_length("photos"::json)) AS amount FROM "PatientProcedureSession" WHERE "patientId" = ${patientId} AND "clinicId" = ${clinicId} AND "journeyId" IS NOT NULL GROUP BY "journeyId"
      UNION ALL
      SELECT "journeyId", 'followup' AS category, SUM(json_array_length("photos"::json)) AS amount FROM "PatientProcedureFollowUp" WHERE "patientId" = ${patientId} AND "clinicId" = ${clinicId} GROUP BY "journeyId"
    ) photos GROUP BY "journeyId", category` : [];
  const photoCountByJourney = new Map<string, number>();
  const beforeIds = new Set<string>();
  const afterIds = new Set<string>();
  for (const photo of photoCounts) {
    photoCountByJourney.set(photo.journeyId, (photoCountByJourney.get(photo.journeyId) ?? 0) + Number(photo.count));
    if (photo.category === "before") beforeIds.add(photo.journeyId);
    if (photo.category === "after") afterIds.add(photo.journeyId);
  }
  return journeys.map((journey) => ({
    id: journey.id,
    name: journey.name,
    createdAt: journey.createdAt,
    hasEvaluation: journey.evaluations.length > 0,
    hasPaidQuote: journey.quotes.some((quote) => ["Pago", "Aprovado"].includes(quote.status)),
    hasProcedure: journey.procedureSessions.some((session) => session.status === "Concluída") || journey.procedures.some((procedure) => !journey.procedureSessions.some((session) => session.procedureId === procedure.id)),
    hasBeforePhoto: beforeIds.has(journey.id),
    hasAfterPhoto: afterIds.has(journey.id),
    hasReturn: journey.appointments.some((appointment) => appointment.procedure.toLocaleLowerCase("pt-BR").includes("retorno") && ["Atendido", "Finalizado"].includes(appointment.status)),
    status: journey.archivedAt ? "Cancelado" : journey.status,
    sessionCount: journey._count.procedureSessions,
    latestCompletedSessionId: journey.procedureSessions.find((session) => session.status === "Concluída")?.id ?? null,
    latestCompletedQuoteId: journey.procedureSessions.find((session) => session.status === "Concluída")?.quoteId ?? null,
    procedureCount: journey._count.procedures,
    photoCount: photoCountByJourney.get(journey.id) ?? 0,
    professional: journey.procedureSessions[0]?.professional || journey.procedures[0]?.professional || journey.appointments[0]?.professional || "Não informado",
    nextAppointment: journey.appointments.filter((appointment) => appointment.status === "Agendado" && !appointmentHasPassed(appointment, now)).sort((left, right) => left.date.getTime() - right.date.getTime() || left.time.localeCompare(right.time))[0] ?? null,
    lastActivityAt: [journey.updatedAt, ...journey.appointments.map((item) => item.date), ...journey.procedures.map((item) => item.performedAt), ...journey.procedureSessions.map((item) => item.performedAt), ...journey.quotes.map((item) => item.createdAt)].sort((left, right) => right.getTime() - left.getTime())[0],
  }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientId = (await params).id;
  if (!await getPatient(patientId, user.clinicId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const journeys = await prisma.patientJourney.findMany({ where: { patientId, clinicId: user.clinicId }, orderBy: { createdAt: "asc" }, select: journeyProgressSelect });
  return NextResponse.json({ journeys: await serializeJourneys(patientId, user.clinicId, journeys) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientId = (await params).id;
  if (!await getPatient(patientId, user.clinicId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const body = await request.json().catch(() => null) as { name?: string } | null;
  const count = await prisma.patientJourney.count({ where: { patientId, clinicId: user.clinicId } });
  const journey = await prisma.patientJourney.create({ data: { patientId, clinicId: user.clinicId, name: body?.name?.trim() || `Jornada ${count + 1}` }, select: journeyProgressSelect });
  const [serialized] = await serializeJourneys(patientId, user.clinicId, [journey]);
  return NextResponse.json({ journey: serialized }, { status: 201 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientId = (await params).id;
  if (!await getPatient(patientId, user.clinicId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const body = await request.json().catch(() => null) as { journeyId?: string; name?: string } | null;
  const name = body?.name?.trim();
  if (!body?.journeyId || !name) return NextResponse.json({ message: "Informe um nome para a jornada." }, { status: 400 });
  const result = await prisma.patientJourney.updateMany({ where: { id: body.journeyId, patientId, clinicId: user.clinicId }, data: { name } });
  if (!result.count) return NextResponse.json({ message: "Jornada não encontrada." }, { status: 404 });
  const journey = await prisma.patientJourney.findFirst({ where: { id: body.journeyId, patientId, clinicId: user.clinicId }, select: journeyProgressSelect });
  return NextResponse.json({ journey: journey ? (await serializeJourneys(patientId, user.clinicId, [journey]))[0] : null });
}
