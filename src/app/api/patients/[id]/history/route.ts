import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patient = await prisma.patient.findFirst({
    where: { id: (await params).id, clinicId: user.clinicId },
    include: {
      appointments: { orderBy: [{ date: "desc" }, { time: "desc" }] },
      payments: { orderBy: { date: "desc" } },
      quotes: { orderBy: { createdAt: "desc" }, select: { id: true, items: true, status: true, createdAt: true } },
      procedureRecords: { orderBy: { performedAt: "desc" } },
      evaluations: { include: { photos: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });

  const clinic = await prisma.clinic.findUnique({ where: { id: user.clinicId }, select: { appointmentToleranceMinutes: true } });
  const now = clinicNow();
  const toleranceMinutes = clinic?.appointmentToleranceMinutes ?? 15;
  const overdue = patient.appointments.filter((appointment) => appointment.status === "Agendado" && appointmentHasPassed(appointment.date, appointment.time, now, toleranceMinutes));
  if (overdue.length) {
    await prisma.appointment.updateMany({ where: { clinicId: user.clinicId, id: { in: overdue.map((appointment) => appointment.id) } }, data: { status: "Faltou" } });
  }
  const appointments = patient.appointments.map((appointment) => overdue.some((item) => item.id === appointment.id) ? { ...appointment, status: "Faltou" } : appointment);

  return NextResponse.json({ patient: { ...patient, appointments, appointmentToleranceMinutes: toleranceMinutes } });
}

function clinicNow() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, minutes: Number(values.hour) * 60 + Number(values.minute) };
}

function appointmentHasPassed(date: Date, time: string, now: { date: string; minutes: number }, toleranceMinutes: number) {
  const appointmentDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  if (appointmentDate < now.date) return true;
  if (appointmentDate > now.date) return false;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes + toleranceMinutes <= now.minutes;
}
