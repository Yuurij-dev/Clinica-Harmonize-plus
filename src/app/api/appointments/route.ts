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
