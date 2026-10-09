import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });

  const [appointments, patients, quotes, payments] = await Promise.all([
    prisma.appointment.findMany({ where: { clinicId: user.clinicId }, orderBy: [{ date: "asc" }, { time: "asc" }], select: { id: true, date: true, time: true, procedure: true, status: true, patient: { select: { name: true } } } }),
    prisma.patient.findMany({ where: { clinicId: user.clinicId }, orderBy: { createdAt: "desc" }, take: 100, select: { name: true, status: true, lastVisit: true, createdAt: true } }),
    prisma.quote.findMany({ where: { clinicId: user.clinicId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, items: true, total: true, status: true, patient: { select: { name: true } } } }),
    prisma.payment.findMany({ where: { clinicId: user.clinicId }, orderBy: { date: "desc" }, take: 100, select: { value: true, status: true, date: true } }),
  ]);
  return NextResponse.json({ appointments, patients, quotes, payments });
}
