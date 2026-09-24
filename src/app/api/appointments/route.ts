import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const appointments = await prisma.appointment.findMany({
    where: { clinicId: user.clinicId },
    orderBy: [{ date: "asc" }, { time: "asc" }],
    include: { patient: { select: { name: true } } },
  });
  return NextResponse.json({ appointments });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null) as {
    patient?: string;
    patientId?: string;
    procedure?: string;
    professional?: string;
    time?: string;
    date?: string;
    notes?: string;
  } | null;
  const patientName = body?.patient?.trim();
  if ((!body?.patientId && !patientName) || !body?.procedure || !body.professional || !body.time) {
    return NextResponse.json({ message: "Selecione um paciente, procedimento, profissional e horário." }, { status: 400 });
  }

  let patient = body.patientId
    ? await prisma.patient.findFirst({ where: { id: body.patientId, clinicId: user.clinicId } })
    : await prisma.patient.findFirst({ where: { name: patientName, clinicId: user.clinicId } });
  if (body.patientId && !patient) {
    return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  }
  if (!patient) {
    patient = await prisma.patient.create({
      data: { name: patientName ?? "Paciente", phone: "Não informado", age: 0, clinicId: user.clinicId },
    });
  }

  const date = body.date ? new Date(body.date) : new Date();
  if (Number.isNaN(date.getTime())) return NextResponse.json({ message: "Data inválida." }, { status: 400 });

  let openingTime = "08:00";
  let closingTime = "19:00";
  let durationMinutes = 60;
  try {
    const [clinic, procedure] = await Promise.all([
      prisma.clinic.findUnique({ where: { id: user.clinicId }, select: { openingTime: true, closingTime: true } }),
      prisma.procedure.findFirst({ where: { clinicId: user.clinicId, name: body.procedure }, select: { durationMinutes: true } }),
    ]);
    openingTime = clinic?.openingTime ?? openingTime;
    closingTime = clinic?.closingTime ?? closingTime;
    durationMinutes = procedure?.durationMinutes ?? durationMinutes;
  } catch {
    // Keep legacy clinics using the default business hours until the migration is applied.
  }
  const startMinutes = parseClockMinutes(body.time);
  const openingMinutes = parseClockMinutes(openingTime);
  const closingMinutes = parseClockMinutes(closingTime);
  const now = clinicNow();
  const requestedDate = body.date?.slice(0, 10) ?? calendarDateKey(now);
  const today = calendarDateKey(now);
  if (requestedDate < today || (requestedDate === today && startMinutes !== null && startMinutes <= now.getHours() * 60 + now.getMinutes())) {
    return NextResponse.json({ message: "Não é possível agendar em um horário ou data que já passou." }, { status: 400 });
  }
  if (startMinutes === null || openingMinutes === null || closingMinutes === null || startMinutes < openingMinutes || startMinutes + durationMinutes > closingMinutes) {
    return NextResponse.json({ message: `Escolha um horário dentro do funcionamento da clínica (${openingTime} às ${closingTime}).` }, { status: 400 });
  }

  const appointment = await prisma.appointment.create({
    data: {
      date,
      time: body.time,
      patientId: patient.id,
      procedure: body.procedure,
      professional: body.professional,
      notes: body.notes?.trim() ?? "",
      status: "Agendado",
      clinicId: user.clinicId,
    },
    include: { patient: { select: { name: true } } },
  });
  return NextResponse.json({ appointment }, { status: 201 });
}

function parseClockMinutes(value: string | undefined) {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}

function clinicNow() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second));
}

function calendarDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
