import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyUnless } from "@/lib/api-guards";
import { isPatientIdFormat } from "@/lib/patient-list-rules";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user, "patients:access");
  if (denied) return denied;

  const patientId = (await params).id;
  if (!isPatientIdFormat(patientId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId: user.clinicId }, select: { sex: true } });
  if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });

  return NextResponse.json({ sexDefined: Boolean(patient.sex?.trim()) }, { headers: { "Cache-Control": "private, no-store" } });
}
