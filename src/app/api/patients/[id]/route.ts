import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { duplicateCpfResponse, rejectInvalidCpf } from "@/lib/patient-cpf";
import { canSeeFullCpf, cpfForRole, isMaskedCpf } from "@/lib/patient-cpf-mask";
import { patientListSelect, withCurrentStage } from "@/lib/patient-list-server";
import { isPatientIdFormat } from "@/lib/patient-list-rules";
import { prisma } from "@/lib/prisma";
import { denyUnless } from "@/lib/api-guards";

// Um paciente no mesmo formato de um item da lista (abrir o perfil fora da página carregada, ex.: vindo da Agenda).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
  const denied = denyUnless(user, "patients:access");
  if (denied) return denied;
  const patientId = (await params).id;
  if (!isPatientIdFormat(patientId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const patient = await prisma.patient.findFirst({ where: { id: patientId, clinicId: user.clinicId }, select: patientListSelect });
  if (!patient) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const [withStage] = await withCurrentStage(user.clinicId, [patient]);
  return NextResponse.json({ patient: cpfForRole(user.role, withStage, user.rolePermissions) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
  const denied = denyUnless(user, "patients:manage");
  if (denied) return denied;

  const body = await request.json().catch(() => null) as { name?: string; cpf?: string; phone?: string; age?: number } | null;
  const name = body?.name?.trim();
  // cpf ausente ou mascarado (STAFF não vê o CPF inteiro) = manter o CPF atual; "" = limpar, exceto para STAFF, que não
  // apaga um CPF que não enxerga (o pedido vazio é ignorado e o CPF é mantido, sem erro).
  const keepCpf = typeof body?.cpf !== "string" || isMaskedCpf(body.cpf) || (!body.cpf.trim() && !canSeeFullCpf(user.role, user.rolePermissions));
  const cpf = keepCpf ? undefined : body?.cpf?.trim() || null;
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
  }).catch((error: unknown) => duplicateCpfResponse(error) ?? Promise.reject(error));
  if (patient instanceof NextResponse) return patient;
  if (!patient.count) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });

  const updated = await prisma.patient.findFirst({ where: { id, clinicId: user.clinicId } });
  return NextResponse.json({ patient: cpfForRole(user.role, updated, user.rolePermissions) });
}
