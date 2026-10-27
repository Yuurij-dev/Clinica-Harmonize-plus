import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyUnless } from "@/lib/api-guards";
import { appointmentHasPassed, clinicNow } from "@/lib/clinic-time";
import { approvedProcedureNames, isProcedureAppointmentName, splitCombinedProcedureName } from "@/lib/procedure-session-rules";
import { prisma } from "@/lib/prisma";

async function getPatient(patientId: string, clinicId: string) {
  return prisma.patient.findFirst({ where: { id: patientId, clinicId }, select: { id: true, clinicId: true } });
}

const journeyProgressSelect = {
  id: true,
  name: true,
  professional: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
  evaluations: { orderBy: { createdAt: "asc" }, take: 1, select: { id: true, professional: true } },
  quotes: { select: { id: true, status: true, createdAt: true, items: true, details: true } },
  appointments: { orderBy: [{ date: "desc" }, { time: "desc" }], select: { id: true, date: true, time: true, procedure: true, professional: true, status: true } },
  procedures: { orderBy: { performedAt: "desc" }, take: 10, select: { id: true, name: true, professional: true, performedAt: true } },
  procedureSessions: { orderBy: { performedAt: "desc" }, take: 20, select: { id: true, procedureId: true, procedureName: true, quoteId: true, professional: true, performedAt: true, startedAt: true, status: true } },
  _count: { select: { procedures: true, appointments: true, procedureSessions: true } },
} satisfies Prisma.PatientJourneySelect;

type JourneyRow = Prisma.PatientJourneyGetPayload<{ select: typeof journeyProgressSelect }>;

// As fotos são base64 grandes: só os ids das jornadas que têm foto saem do banco.
async function serializeJourneys(patientId: string, clinicId: string, journeys: JourneyRow[]) {
  const now = clinicNow();
  const journeyIds = journeys.map((journey) => journey.id);
  const photoCounts = journeys.length ? await prisma.$queryRaw<Array<{ journeyId: string; category: string; count: bigint }>>`
    SELECT "journeyId", category, SUM(amount)::bigint AS count
    FROM (
      SELECT "journeyId", 'before' AS category, COUNT(*) AS amount FROM "PatientProcedure" WHERE "patientId" = ${patientId} AND "clinicId" = ${clinicId} AND "journeyId" IN (${Prisma.join(journeyIds)}) AND "beforePhoto" IS NOT NULL AND "beforePhoto" <> '' GROUP BY "journeyId"
      UNION ALL
      SELECT "journeyId", 'after' AS category, COUNT(*) AS amount FROM "PatientProcedure" WHERE "patientId" = ${patientId} AND "clinicId" = ${clinicId} AND "journeyId" IN (${Prisma.join(journeyIds)}) AND "afterPhoto" IS NOT NULL AND "afterPhoto" <> '' GROUP BY "journeyId"
      UNION ALL
      SELECT p."journeyId", 'before' AS category, COUNT(*) AS amount FROM "PatientProcedurePhotoSession" s INNER JOIN "PatientProcedure" p ON p."id" = s."procedureId" WHERE p."patientId" = ${patientId} AND p."clinicId" = ${clinicId} AND p."journeyId" IN (${Prisma.join(journeyIds)}) AND s."beforePhoto" IS NOT NULL AND s."beforePhoto" <> '' GROUP BY p."journeyId"
      UNION ALL
      SELECT p."journeyId", 'after' AS category, COUNT(*) AS amount FROM "PatientProcedurePhotoSession" s INNER JOIN "PatientProcedure" p ON p."id" = s."procedureId" WHERE p."patientId" = ${patientId} AND p."clinicId" = ${clinicId} AND p."journeyId" IN (${Prisma.join(journeyIds)}) AND s."afterPhoto" IS NOT NULL AND s."afterPhoto" <> '' GROUP BY p."journeyId"
      UNION ALL
      SELECT e."journeyId", 'evaluation' AS category, COUNT(*) AS amount FROM "EvaluationPhoto" ep INNER JOIN "Evaluation" e ON e."id" = ep."evaluationId" WHERE e."patientId" = ${patientId} AND e."clinicId" = ${clinicId} AND e."journeyId" IN (${Prisma.join(journeyIds)}) GROUP BY e."journeyId"
      UNION ALL
      SELECT "journeyId", 'session' AS category, SUM(json_array_length("photos"::json)) AS amount FROM "PatientProcedureSession" WHERE "patientId" = ${patientId} AND "clinicId" = ${clinicId} AND "journeyId" IN (${Prisma.join(journeyIds)}) GROUP BY "journeyId"
      UNION ALL
      SELECT "journeyId", 'followup' AS category, SUM(json_array_length("photos"::json)) AS amount FROM "PatientProcedureFollowUp" WHERE "patientId" = ${patientId} AND "clinicId" = ${clinicId} AND "journeyId" IN (${Prisma.join(journeyIds)}) GROUP BY "journeyId"
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
    procedureNames: [...new Set([
      ...journey.procedures.map((procedure) => procedure.name),
      ...journey.procedureSessions.map((session) => session.procedureName),
      ...journey.quotes.flatMap((quote) => [...approvedProcedureNames(quote.details), quote.items]),
      ...journey.appointments.filter((appointment) => !appointment.procedure.toLocaleLowerCase("pt-BR").includes("retorno")).flatMap((appointment) => splitCombinedProcedureName(appointment.procedure)),
    ].map((name) => name.trim()).filter(Boolean))],
    createdAt: journey.createdAt,
    hasEvaluation: journey.evaluations.length > 0,
    hasPaidQuote: journey.quotes.some((quote) => ["Pago", "Aprovado"].includes(quote.status)),
    hasProcedure: journey.procedureSessions.some((session) => session.status === "Concluída") || journey.procedures.some((procedure) => !journey.procedureSessions.some((session) => session.procedureId === procedure.id)),
    hasBeforePhoto: beforeIds.has(journey.id),
    hasAfterPhoto: afterIds.has(journey.id),
    hasReturnScheduled: journey.appointments.some((appointment) => appointment.procedure.toLocaleLowerCase("pt-BR").includes("retorno") && ["Agendado", "Em atendimento", "Atendido", "Finalizado"].includes(appointment.status)),
    hasReturn: journey.appointments.some((appointment) => appointment.procedure.toLocaleLowerCase("pt-BR").includes("retorno") && ["Atendido", "Finalizado"].includes(appointment.status)),
    activeProcedureStartedAt: journey.procedureSessions.find((session) => session.status === "Em execução" && session.startedAt)?.startedAt?.toISOString() ?? null,
    status: journey.archivedAt ? "Cancelado" : journey.status,
    sessionCount: journey._count.procedureSessions,
    latestCompletedSessionId: journey.procedureSessions.find((session) => session.status === "Concluída")?.id ?? null,
    latestCompletedQuoteId: journey.procedureSessions.find((session) => session.status === "Concluída")?.quoteId ?? null,
    procedureCount: journey._count.procedures,
    photoCount: photoCountByJourney.get(journey.id) ?? 0,
    professional: journey.professional || journey.evaluations[0]?.professional || journey.procedureSessions[0]?.professional || journey.procedures[0]?.professional || journey.appointments[0]?.professional || "Não informado",
    nextAppointment: nextScheduled(journey.appointments.filter((appointment) => /^retorno/i.test(appointment.procedure.trim())), now),
    scheduledProcedure: nextScheduled(journey.appointments.filter((appointment) => isProcedureAppointmentName(appointment.procedure)), now),
    lastActivityAt: [journey.updatedAt, ...journey.appointments.map((item) => item.date), ...journey.procedures.map((item) => item.performedAt), ...journey.procedureSessions.map((item) => item.performedAt), ...journey.quotes.map((item) => item.createdAt)].sort((left, right) => right.getTime() - left.getTime())[0],
  }));
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
  const patientId = (await params).id;
  if (!await getPatient(patientId, user.clinicId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const url = new URL(request.url);
  if (url.searchParams.has("page")) {
    const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize")) || 10));
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const status = url.searchParams.get("status") ?? "Todos";
    const stage = url.searchParams.get("stage") ?? "Todas";
    const search = url.searchParams.get("search")?.trim();
    const sort = url.searchParams.get("sort") ?? "recent";
    const hasProcedure: Prisma.PatientJourneyWhereInput[] = [
      { procedureSessions: { some: { status: "Concluída" } } },
      { procedures: { some: { sessions: { none: {} } } } },
    ];
    const hasReturn: Prisma.PatientJourneyWhereInput = { appointments: { some: { procedure: { contains: "retorno", mode: "insensitive" }, status: { in: ["Agendado", "Em atendimento", "Atendido", "Finalizado"] } } } };
    const hasPaidQuote: Prisma.PatientJourneyWhereInput = { quotes: { some: { status: { in: ["Aprovado", "Pago"] } } } };
    const stageWhere: Prisma.PatientJourneyWhereInput[] = stage === "Avaliação" ? [
      { evaluations: { none: {} } },
    ] : stage === "Orçamento" ? [
      { evaluations: { some: {} } }, { NOT: hasPaidQuote },
    ] : stage === "Procedimento" ? [
      { evaluations: { some: {} } }, hasPaidQuote, { NOT: { OR: hasProcedure } },
    ] : stage === "Pós-procedimento" ? [
      { evaluations: { some: {} } }, hasPaidQuote, { OR: hasProcedure }, { NOT: hasReturn },
    ] : stage === "Retorno" ? [
      { evaluations: { some: {} } }, hasPaidQuote, { OR: hasProcedure }, hasReturn,
    ] : stage === "Concluído" ? [
      { status: "Concluído" },
    ] : [];
    const where: Prisma.PatientJourneyWhereInput = {
      patientId,
      clinicId: user.clinicId,
      archivedAt: null,
      status: status === "Todos" ? { not: "Cancelado" } : status,
      ...(stage === "Concluído" ? {} : { NOT: { status: "Concluído" } }),
      ...(stageWhere.length ? { AND: stageWhere } : {}),
      ...(search ? { OR: [
        { name: { contains: search, mode: "insensitive" } },
        { procedures: { some: { name: { contains: search, mode: "insensitive" } } } },
        { procedureSessions: { some: { procedureName: { contains: search, mode: "insensitive" } } } },
        { quotes: { some: { OR: [{ items: { contains: search, mode: "insensitive" } }, { details: { contains: search, mode: "insensitive" } }] } } },
        { appointments: { some: { procedure: { contains: search, mode: "insensitive" } } } },
      ] } : {}),
    };
    const [journeys, total, statusGroups] = await Promise.all([
      prisma.patientJourney.findMany({ where, orderBy: sort === "name" ? [{ name: "asc" }, { createdAt: "desc" }, { id: "asc" }] : [{ createdAt: sort === "oldest" ? "asc" : "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize, select: journeyProgressSelect }),
      prisma.patientJourney.count({ where }),
      prisma.patientJourney.groupBy({ by: ["status"], where: { patientId, clinicId: user.clinicId, archivedAt: null, status: { not: "Cancelado" } }, _count: { _all: true } }),
    ]);
    const summary = statusGroups.reduce((counts, row) => { counts.total += row._count._all; if (row.status === "Em andamento") counts.inProgress += row._count._all; if (row.status === "Concluído") counts.completed += row._count._all; return counts; }, { total: 0, inProgress: 0, completed: 0 });
    return NextResponse.json({ journeys: await serializeJourneys(patientId, user.clinicId, journeys), pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) }, summary });
  }
  const journeys = await prisma.patientJourney.findMany({ where: { patientId, clinicId: user.clinicId }, orderBy: { createdAt: "asc" }, select: journeyProgressSelect });
  return NextResponse.json({ journeys: await serializeJourneys(patientId, user.clinicId, journeys) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
  const patientId = (await params).id;
  if (!await getPatient(patientId, user.clinicId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const body = await request.json().catch(() => null) as { name?: string; professionalId?: string } | null;
  const name = body?.name?.trim();
  if (!name || name.length > 80) return NextResponse.json({ message: "Informe um nome para a jornada com até 80 caracteres." }, { status: 400 });
  if (!body?.professionalId) return NextResponse.json({ message: "Selecione o profissional responsável." }, { status: 400 });
  const professional = await prisma.clinicMembership.findFirst({
    where: { clinicId: user.clinicId, userId: body.professionalId, role: { in: ["ADMIN", "PROFESSIONAL"] } },
    select: { user: { select: { name: true } } },
  });
  if (!professional) return NextResponse.json({ message: "Selecione um profissional ativo da clínica." }, { status: 400 });
  const journey = await prisma.patientJourney.create({ data: { patientId, clinicId: user.clinicId, name, professional: professional.user.name }, select: journeyProgressSelect });
  const [serialized] = await serializeJourneys(patientId, user.clinicId, [journey]);
  return NextResponse.json({ journey: serialized }, { status: 201 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
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

// Próximo agendamento futuro (status Agendado) de uma lista já filtrada por tipo.
function nextScheduled<T extends { status: string; date: Date; time: string }>(appointments: T[], now: ReturnType<typeof clinicNow>) {
  return appointments.filter((appointment) => appointment.status === "Agendado" && !appointmentHasPassed(appointment, now)).sort((left, right) => left.date.getTime() - right.date.getTime() || left.time.localeCompare(right.time))[0] ?? null;
}
