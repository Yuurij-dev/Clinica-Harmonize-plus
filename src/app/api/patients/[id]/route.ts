import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { rejectInvalidCpf } from "@/lib/patient-cpf";
import { patientListSelect, withCurrentStage } from "@/lib/patient-list-server";
import { isPatientIdFormat } from "@/lib/patient-list-rules";
import { prisma } from "@/lib/prisma";

// Um paciente no mesmo formato de um item da lista (abrir o perfil fora da página carregada, ex.: vindo da Agenda).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientId = (await params).id;
  if (!isPatientIdFormat(patientId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId: user.clinicId }, select: patientListSelect });
  if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const [withStage] = await withCurrentStage(user.clinicId, [patient]);
  return NextResponse.json({ patient: withStage });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null) as { name?: string; cpf?: string; phone?: string; age?: number } | null;
  const name = body?.name?.trim();
  const cpf = body?.cpf?.trim() || null;
  const phone = body?.phone?.trim();
  const age = Number(body?.age);
  if (!name || !phone || !Number.isInteger(age) || age < 0 || age > 130) {
    return NextResponse.json({ message: "Nome, telefone e idade válida são obrigatórios." }, { status: 400 });
  }

  const id = (await params).id;
  if (!isPatientIdFormat(id)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const cpfError = await rejectInvalidCpf(user.clinicId, cpf, id);
  if (cpfError) return cpfError;

  const patient = await prisma.patient.updateMany({
    where: { id, clinicId: user.clinicId },
    data: { name, cpf, phone, age },
  });
  if (!patient.count) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });

  const updated = await prisma.patient.findFirst({ where: { id, clinicId: user.clinicId } });
  return NextResponse.json({ patient: updated });
}
