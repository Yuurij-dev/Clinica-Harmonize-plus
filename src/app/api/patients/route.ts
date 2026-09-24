import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const patients = await prisma.patient.findMany({
    where: { clinicId: user.clinicId },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { appointments: true, evaluations: true } },
      evaluations: { select: { photos: { select: { id: true } } } },
      quotes: { orderBy: { createdAt: "desc" }, select: { status: true } },
      appointments: { select: { status: true } },
      procedureRecords: { orderBy: { performedAt: "desc" }, take: 1, select: { beforePhoto: true, afterPhoto: true } },
    },
  });
  return NextResponse.json({ patients: patients.map((patient) => ({ ...patient, currentStage: resolveCurrentStage(patient) })) });
}

function resolveCurrentStage(patient: { evaluations: Array<{ photos: Array<{ id: string }> }>; quotes: Array<{ status: string }>; appointments: Array<{ status: string }>; procedureRecords: Array<{ beforePhoto: string | null; afterPhoto: string | null }> }) {
  const procedure = patient.procedureRecords[0];
  if (procedure?.afterPhoto) return "return";
  if (procedure?.beforePhoto || patient.quotes.some((quote) => ["Aprovado", "Pago"].includes(quote.status))) return "procedure";
  if (patient.appointments.some((appointment) => ["Atendido", "Finalizado"].includes(appointment.status))) return "return";
  if (patient.quotes.length || patient.evaluations.some((evaluation) => evaluation.photos.length > 0)) return "quote";
  return "evaluation";
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
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
