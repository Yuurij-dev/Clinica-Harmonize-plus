import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyUnless } from "@/lib/api-guards";
import { observationKindsFor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
  const patientId = (await params).id;
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: user.clinicId },
    select: {
      id: true,
      _count: { select: { appointments: true, procedureRecords: true, evaluations: true, quotes: true, payments: true } },
    },
  });
  if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });

  const [appointments, procedures, evaluations, quotes, payments, observations, photoCount] = await Promise.all([
    prisma.appointment.findMany({ where: { patientId, clinicId: user.clinicId }, orderBy: [{ date: "desc" }, { time: "desc" }], take: 12, select: { date: true, time: true, procedure: true, professional: true, status: true, materialsCheck: true } }),
    prisma.patientProcedure.findMany({ where: { patientId, clinicId: user.clinicId }, orderBy: { performedAt: "desc" }, take: 12, select: { name: true, professional: true, performedAt: true } }),
    prisma.evaluation.findMany({ where: { patientId, clinicId: user.clinicId }, orderBy: { createdAt: "desc" }, take: 12, select: { professional: true, createdAt: true } }),
    prisma.quote.findMany({ where: { patientId, clinicId: user.clinicId }, orderBy: { createdAt: "desc" }, take: 12, select: { items: true, status: true, createdAt: true } }),
    prisma.payment.findMany({ where: { patientId, clinicId: user.clinicId }, orderBy: { date: "desc" }, take: 12, select: { valueCents: true, status: true, date: true, method: true } }),
    prisma.patientObservation.findMany({ where: { patientId, clinicId: user.clinicId, kind: { in: observationKindsFor(user.role, user.rolePermissions) } }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, text: true, kind: true, createdAt: true } }),
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT
      (SELECT COUNT(*) FROM "EvaluationPhoto" ep INNER JOIN "Evaluation" e ON e."id" = ep."evaluationId" WHERE e."patientId" = ${patientId} AND e."clinicId" = ${user.clinicId})
      + (SELECT COUNT(*) FROM "PatientProcedure" pp WHERE pp."patientId" = ${patientId} AND pp."clinicId" = ${user.clinicId} AND pp."beforePhoto" IS NOT NULL AND pp."beforePhoto" <> '')
      + (SELECT COUNT(*) FROM "PatientProcedure" pp WHERE pp."patientId" = ${patientId} AND pp."clinicId" = ${user.clinicId} AND pp."afterPhoto" IS NOT NULL AND pp."afterPhoto" <> '')
      + (SELECT COUNT(*) FROM "PatientProcedurePhotoSession" ps INNER JOIN "PatientProcedure" pp ON pp."id" = ps."procedureId" WHERE pp."patientId" = ${patientId} AND pp."clinicId" = ${user.clinicId} AND ps."beforePhoto" IS NOT NULL AND ps."beforePhoto" <> '')
      + (SELECT COUNT(*) FROM "PatientProcedurePhotoSession" ps INNER JOIN "PatientProcedure" pp ON pp."id" = ps."procedureId" WHERE pp."patientId" = ${patientId} AND pp."clinicId" = ${user.clinicId} AND ps."afterPhoto" IS NOT NULL AND ps."afterPhoto" <> '')
      + COALESCE((SELECT SUM(json_array_length("photos"::json)) FROM "PatientProcedureFollowUp" WHERE "patientId" = ${patientId} AND "clinicId" = ${user.clinicId}), 0) AS count`,
  ]);

  const events = [
    ...appointments.map((item) => ({ kind: "Agendamento", title: item.procedure, detail: `${item.status} · ${item.professional}`, date: item.date.toISOString(), status: item.status })),
    ...procedures.map((item) => ({ kind: "Procedimento", title: item.name, detail: `Responsável: ${item.professional}`, date: item.performedAt.toISOString() })),
    ...evaluations.map((item) => ({ kind: "Avaliação", title: "Avaliação clínica", detail: item.professional || "Profissional não informado", date: item.createdAt.toISOString() })),
    ...quotes.map((item) => ({ kind: "Orçamento", title: item.items, detail: item.status, date: item.createdAt.toISOString(), status: item.status })),
    ...payments.map((item) => ({ kind: "Pagamento", title: "Pagamento registrado", detail: `${(item.valueCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · ${item.method} · ${item.status}`, date: item.date.toISOString(), status: item.status })),
    ...observations.map((item) => ({ kind: item.kind === "clinical" ? "Observação clínica" : "Observação administrativa", title: item.kind === "clinical" ? "Observação clínica" : "Observação administrativa", detail: item.text, date: item.createdAt.toISOString() })),
    ...appointments.filter((item) => item.materialsCheck === "pending").map((item) => ({ kind: "Material", title: "Conferência de materiais pendente", detail: item.procedure, date: item.date.toISOString(), status: "Pendente" })),
    ...quotes.filter((item) => ["Pendente", "Aguardando aprovação"].includes(item.status)).map((item) => ({ kind: "Orçamento", title: "Orçamento aguardando aprovação", detail: item.items, date: item.createdAt.toISOString(), status: item.status })),
  ].sort((left, right) => right.date.localeCompare(left.date));

  return NextResponse.json({
    events: events.slice(0, 30),
    observations,
    counts: { appointments: patient._count.appointments, procedures: patient._count.procedureRecords, evaluations: patient._count.evaluations, quotes: patient._count.quotes, payments: patient._count.payments, photos: Number(photoCount[0]?.count ?? 0) },
  });
}
