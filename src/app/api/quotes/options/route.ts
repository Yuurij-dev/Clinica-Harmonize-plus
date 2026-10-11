import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { describeTechnicalSheet } from "@/lib/stock-rules";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });

  const [patients, procedures, clinic] = await Promise.all([
    prisma.patient.findMany({ where: { clinicId: user.clinicId }, orderBy: { name: "asc" }, select: { id: true, name: true, cpf: true } }),
    prisma.procedure.findMany({
      where: { clinicId: user.clinicId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, category: true, price: true, technicalSheet: { orderBy: { product: { name: "asc" } }, select: { quantity: true, product: { select: { name: true, unit: true } } } } },
    }),
    prisma.clinic.findUnique({ where: { id: user.clinicId }, select: { laborCost: true, facilityCost: true, medicationCost: true } }),
  ]);

  // O orçamento usa a ficha técnica: descrição dos materiais e unidade do primeiro material.
  const options = procedures.map(({ technicalSheet, ...procedure }) => {
    const items = technicalSheet.map((item) => ({ name: item.product.name, unit: item.product.unit, quantity: item.quantity }));
    return { ...procedure, materials: describeTechnicalSheet(items), unit: items[0]?.unit ?? null };
  });
  return NextResponse.json({ patients, procedures: options, costs: clinic ?? { laborCost: 0, facilityCost: 0, medicationCost: 0 } });
}
