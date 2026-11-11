import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { duplicateCpfResponse, rejectInvalidCpf } from "@/lib/patient-cpf";
import { canSeeFullCpf, cpfForRole, maskCpf } from "@/lib/patient-cpf-mask";
import { patientCreatedSelect, patientEditSelect, patientListSelect, withCurrentStage } from "@/lib/patient-list-server";
import { isPatientIdFormat } from "@/lib/patient-list-rules";
import { buildPatientUpdate } from "@/lib/patient-update-rules";
import { prisma } from "@/lib/prisma";
import { denyUnless } from "@/lib/api-guards";

// Um paciente no mesmo formato de um item da lista (abrir o perfil fora da página carregada, ex.: vindo da Agenda).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
  const patientId = (await params).id;
  if (!isPatientIdFormat(patientId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  // ?form=edit: dados para o formulário "Editar dados" (só quem pode gerenciar clientes; CPFs mascarados sem patients:cpf-full).
  if (new URL(request.url).searchParams.get("form") === "edit") {
    const manageDenied = denyUnless(user, "patients:manage");
    if (manageDenied) return manageDenied;
    const record = await prisma.patient.findFirst({ where: { id: patientId, clinicId: user.clinicId }, select: patientEditSelect });
    if (!record) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
    const masked = canSeeFullCpf(user.role, user.rolePermissions) ? record : { ...record, cpf: maskCpf(record.cpf), legalGuardianCpf: maskCpf(record.legalGuardianCpf) };
    return NextResponse.json({ patient: masked });
  }
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

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ message: "Dados do cadastro inválidos." }, { status: 400 });

  const id = (await params).id;
  if (!isPatientIdFormat(id)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  // Registro atual (escopado pela clínica) é a base da edição parcial: campo ausente no corpo = manter.
  const existing = await prisma.patient.findFirst({ where: { id, clinicId: user.clinicId }, select: patientEditSelect });
  if (!existing) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });

  const update = buildPatientUpdate(body, existing, { fullCpf: canSeeFullCpf(user.role, user.rolePermissions) });
  if (!update.ok) return NextResponse.json({ message: update.message, ...(update.fields ? { fields: update.fields } : {}) }, { status: 400 });
  const cpfError = await rejectInvalidCpf(user.clinicId, update.data.cpf as string | null | undefined, id);
  if (cpfError) return cpfError;

  // Nada a gravar (corpo vazio, ou só `age` com data de nascimento no registro): o paciente já foi confirmado acima, então é 200 sem escrita
  // (updateMany com data vazio devolveria count 0 e viraria 404 por engano).
  const patient = Object.keys(update.data).length === 0 ? { count: 1 } : await prisma.patient.updateMany({
    where: { id, clinicId: user.clinicId },
    data: update.data,
  }).catch((error: unknown) => duplicateCpfResponse(error) ?? Promise.reject(error));
  if (patient instanceof NextResponse) return patient;
  if (!patient.count) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });

  // Select enxuto: nunca devolve auditLog nem CPF do responsável.
  const updated = await prisma.patient.findFirst({ where: { id, clinicId: user.clinicId }, select: patientCreatedSelect });
  return NextResponse.json({ patient: cpfForRole(user.role, updated, user.rolePermissions) });
}
