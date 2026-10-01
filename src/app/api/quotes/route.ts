import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensurePatientJourney } from "@/lib/patient-journey";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const searchParams = new URL(request.url).searchParams;
  const patientId = searchParams.get("patientId");
  const journeyId = searchParams.get("journeyId");
  const quotes = await prisma.quote.findMany({
    where: { clinicId: user.clinicId, ...(patientId ? { patientId } : {}), ...(journeyId ? { journeyId } : {}) },
    orderBy: { createdAt: "desc" },
    include: { patient: { select: { name: true } } },
  });
  return NextResponse.json({ quotes });
}

export async function POST(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const body = await request.json().catch(() => null) as { patient?: string; patientId?: string; journeyId?: string; items?: string; total?: number; expires?: string; paymentMethod?: string } | null;
  const patient = body?.patientId ? await prisma.patient.findFirst({ where: { id: body.patientId, clinicId: user.clinicId } }) : body?.patient ? await prisma.patient.findFirst({ where: { name: body.patient, clinicId: user.clinicId } }) : null;
  const total = Number(body?.total);
  if (!patient || !body?.items?.trim() || !Number.isFinite(total)) return NextResponse.json({ message: "Selecione um paciente e preencha o orçamento." }, { status: 400 });
  const journey = await ensurePatientJourney(patient.id, user.clinicId, body.journeyId);
  const paymentMethod = ["Cartão de crédito", "Cartão de débito", "Pix"].includes(body?.paymentMethod ?? "") ? body?.paymentMethod : "Cartão de crédito";
  const quote = await prisma.quote.create({ data: { clinicId: user.clinicId, patientId: patient.id, journeyId: journey.id, items: body.items.trim(), total: Math.max(0, Math.round(total)), paymentMethod, expires: parseDate(body.expires) }, include: { patient: { select: { name: true } } } });
  return NextResponse.json({ quote }, { status: 201 });
}

function parseDate(value?: string) {
  if (!value) return undefined;
  const parts = value.split("/");
  if (parts.length === 3) {
    const date = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
