import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const patients = await prisma.patient.findMany({
    where: { clinicId: user.clinicId },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, cpf: true, phone: true, age: true, status: true,
      lastVisit: true, nextReturn: true, totalValue: true,
      procedureRecords: { orderBy: { performedAt: "desc" }, take: 1, select: { id: true } },
    },
  });
  const procedureIds = patients.flatMap((patient) => patient.procedureRecords.map((record) => record.id));
  const [withBefore, withAfter, approvedQuotes, anyQuotes, attended, evaluationsWithPhotos] = await Promise.all([
    prisma.patientProcedure.findMany({ where: { id: { in: procedureIds }, clinicId: user.clinicId, AND: [{ beforePhoto: { not: null } }, { beforePhoto: { not: "" } }] }, select: { id: true } }),
    prisma.patientProcedure.findMany({ where: { id: { in: procedureIds }, clinicId: user.clinicId, AND: [{ afterPhoto: { not: null } }, { afterPhoto: { not: "" } }] }, select: { id: true } }),
    prisma.quote.findMany({ where: { clinicId: user.clinicId, status: { in: ["Aprovado", "Pago"] } }, select: { patientId: true }, distinct: ["patientId"] }),
    prisma.quote.findMany({ where: { clinicId: user.clinicId }, select: { patientId: true }, distinct: ["patientId"] }),
    prisma.appointment.findMany({ where: { clinicId: user.clinicId, status: { in: ["Atendido", "Finalizado"] } }, select: { patientId: true }, distinct: ["patientId"] }),
    prisma.evaluation.findMany({ where: { clinicId: user.clinicId, photos: { some: {} } }, select: { patientId: true }, distinct: ["patientId"] }),
  ]);
  const beforeIds = new Set(withBefore.map((record) => record.id));
  const afterIds = new Set(withAfter.map((record) => record.id));
  const approvedPatientIds = new Set(approvedQuotes.map((quote) => quote.patientId));
  const quotedPatientIds = new Set(anyQuotes.map((quote) => quote.patientId));
  const attendedPatientIds = new Set(attended.map((appointment) => appointment.patientId));
  const evaluatedPatientIds = new Set(evaluationsWithPhotos.map((evaluation) => evaluation.patientId));
  return NextResponse.json({ patients: patients.map(({ procedureRecords, ...patient }) => {
    const latestProcedureId = procedureRecords[0]?.id;
    const currentStage = latestProcedureId && afterIds.has(latestProcedureId) ? "return"
      : (latestProcedureId && beforeIds.has(latestProcedureId)) || approvedPatientIds.has(patient.id) ? "procedure"
      : attendedPatientIds.has(patient.id) ? "return"
      : quotedPatientIds.has(patient.id) || evaluatedPatientIds.has(patient.id) ? "quote"
      : "evaluation";
    return { ...patient, currentStage };
  }) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null) as {
    name?: string;
    cpf?: string;
    phone?: string;
    age?: number;
    status?: string;
    lastVisit?: string;
    nextReturn?: string;
    totalValue?: number;
  } | null;

  const name = body?.name?.trim();
  const cpf = body?.cpf?.trim() || undefined;
  const phone = body?.phone?.trim();
  const age = Number(body?.age);
  if (!name || !phone || !Number.isInteger(age) || age < 0 || age > 130) {
    return NextResponse.json({ message: "Nome, telefone e idade válida são obrigatórios." }, { status: 400 });
  }

  const patient = await prisma.patient.create({
    data: {
      name,
      cpf,
      phone,
      age,
      status: body?.status?.trim() || "Ativa",
      lastVisit: parseDate(body?.lastVisit),
      nextReturn: parseDate(body?.nextReturn),
      totalValue: Number.isFinite(body?.totalValue) ? Math.max(0, Number(body?.totalValue)) : 0,
      clinicId: user.clinicId,
    },
  });
  return NextResponse.json({ patient }, { status: 201 });
}

function parseDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
