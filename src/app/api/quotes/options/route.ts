import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const [patients, procedures, products, clinic] = await Promise.all([
    prisma.patient.findMany({ where: { clinicId: user.clinicId }, orderBy: { name: "asc" }, select: { id: true, name: true, cpf: true } }),
    prisma.procedure.findMany({ where: { clinicId: user.clinicId }, orderBy: { name: "asc" }, select: { id: true, name: true, category: true, materials: true, price: true } }),
    prisma.product.findMany({ where: { clinicId: user.clinicId }, orderBy: { name: "asc" }, select: { name: true, unit: true } }),
    prisma.clinic.findUnique({ where: { id: user.clinicId }, select: { laborCost: true, facilityCost: true, medicationCost: true } }),
  ]);

  return NextResponse.json({ patients, procedures, products, costs: clinic ?? { laborCost: 0, facilityCost: 0, medicationCost: 0 } });
}
