import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Mesma regra no cadastro e na edição: 11 números e único na clínica. Devolve a resposta de erro ou null.
export async function rejectInvalidCpf(clinicId: string, cpf: string | null | undefined, patientId?: string) {
  if (!cpf) return null;
  if (cpf.replace(/\D/g, "").length !== 11) return NextResponse.json({ message: "Informe um CPF válido com 11 números." }, { status: 400 });
  const duplicate = await prisma.patient.findFirst({ where: { clinicId, cpf, ...(patientId ? { id: { not: patientId } } : {}) }, select: { id: true } });
  return duplicate ? NextResponse.json({ message: "Este CPF já está cadastrado para outro cliente." }, { status: 409 }) : null;
}
