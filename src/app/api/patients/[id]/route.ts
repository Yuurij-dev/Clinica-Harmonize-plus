import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
  if (cpf && cpf.replace(/\D/g, "").length !== 11) {
    return NextResponse.json({ message: "Informe um CPF válido com 11 números." }, { status: 400 });
  }
  if (cpf) {
    const duplicate = await prisma.patient.findFirst({ where: { clinicId: user.clinicId, cpf, id: { not: id } }, select: { id: true } });
    if (duplicate) return NextResponse.json({ message: "Este CPF já está cadastrado para outro cliente." }, { status: 409 });
  }

  const patient = await prisma.patient.updateMany({
    where: { id, clinicId: user.clinicId },
    data: { name, cpf, phone, age },
  });
  if (!patient.count) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });

  const updated = await prisma.patient.findFirst({ where: { id, clinicId: user.clinicId } });
  return NextResponse.json({ patient: updated });
}
