import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { procedureImageSelect, withImage } from "@/lib/procedure-server";
import { describeTechnicalSheet } from "@/lib/stock-rules";
import { canForUser } from "@/lib/permissions";
import { quoteCostSnapshot } from "@/lib/quote-cost-snapshot";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "quotes:access")) return NextResponse.json({ message: "Seu cargo não tem acesso a orçamentos." }, { status: 403 });

  // Pacientes não vêm mais aqui: os seletores pesquisam sob demanda em /api/patients/lookup.
  const [procedures, clinic, costSnapshot] = await Promise.all([
    prisma.procedure.findMany({
      where: { clinicId: user.clinicId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, category: true, price: true, ...procedureImageSelect, technicalSheet: { orderBy: { product: { name: "asc" } }, select: { quantity: true, product: { select: { name: true, unit: true } } } } },
    }),
    prisma.clinic.findUnique({ where: { id: user.clinicId }, select: { name: true } }),
    quoteCostSnapshot(user.clinicId, user.id, user.role),
  ]);

  // O orçamento usa a ficha técnica: descrição dos materiais e unidade do primeiro material.
  const options = procedures.map(({ technicalSheet, ...procedure }) => {
    const items = technicalSheet.map((item) => ({ name: item.product.name, unit: item.product.unit, quantity: item.quantity }));
    return { ...withImage(procedure), materials: describeTechnicalSheet(items), unit: items[0]?.unit ?? null };
  });
  return NextResponse.json({ procedures: options, clinicName: clinic?.name ?? null, costs: { laborCost: costSnapshot.laborCents / 100, facilityCost: costSnapshot.facilityCents / 100, medicationCost: costSnapshot.medicationCents / 100 } });
}
