import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const observationSelect = { id: true, text: true, authorName: true, createdAt: true } as const;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientId = (await params).id;
  const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId: user.clinicId }, select: { id: true } });
  if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const observations = await prisma.patientObservation.findMany({ where: { patientId, clinicId: user.clinicId }, orderBy: { createdAt: "desc" }, select: observationSelect });
  return NextResponse.json({ observations });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientId = (await params).id;
  const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId: user.clinicId }, select: { id: true } });
  if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const body = await request.json().catch(() => null) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ message: "Escreva a observação." }, { status: 400 });
  if (text.length > 2000) return NextResponse.json({ message: "A observação deve ter no máximo 2000 caracteres." }, { status: 400 });
  const observation = await prisma.patientObservation.create({ data: { clinicId: user.clinicId, patientId, text, authorName: user.name }, select: observationSelect });
  return NextResponse.json({ observation }, { status: 201 });
}
