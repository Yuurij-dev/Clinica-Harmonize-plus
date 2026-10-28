import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canForUser } from "@/lib/permissions";
import { clinicToday } from "@/lib/clinic-time";
import { serializePayment, serializeQuote } from "@/lib/finance";
import { addMonths } from "@/lib/finance-rules";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "dashboard:access")) return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });

  // Os gráficos comparam o mês atual com o anterior; os próximos atendimentos vêm do mesmo intervalo, que termina no fim
  // do mês seguinte (sem esse limite, toda a agenda futura vinha a cada abertura do dashboard).
  const monthStart = `${clinicToday().slice(0, 7)}-01`;
  const previousMonthStart = addMonths(monthStart, -1);
  const afterNextMonthStart = addMonths(monthStart, 2);
  const [appointments, appointmentCount, patients, quotes, payments] = await Promise.all([
    prisma.appointment.findMany({ where: { clinicId: user.clinicId, date: { gte: new Date(`${previousMonthStart}T00:00:00-03:00`), lt: new Date(`${afterNextMonthStart}T00:00:00-03:00`) } }, orderBy: [{ date: "asc" }, { time: "asc" }], select: { id: true, date: true, time: true, procedure: true, status: true, patient: { select: { id: true, name: true } } } }),
    prisma.appointment.count({ where: { clinicId: user.clinicId } }),
    prisma.patient.findMany({ where: { clinicId: user.clinicId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, name: true, status: true, lastVisit: true, createdAt: true } }),
    prisma.quote.findMany({ where: { clinicId: user.clinicId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, items: true, totalCents: true, status: true, patient: { select: { id: true, name: true } } } }),
    prisma.payment.findMany({ where: { clinicId: user.clinicId }, orderBy: { date: "desc" }, take: 100, select: { valueCents: true, status: true, date: true } }),
  ]);
  return NextResponse.json({ appointments, appointmentCount, patients, quotes: quotes.map(serializeQuote), payments: payments.map(serializePayment) });
}
