import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { clinicToday, dateOnly } from "@/lib/clinic-time";
import { prisma } from "@/lib/prisma";
import { clinicWarningDays, lotBalances } from "@/lib/stock";
import { materialBalance, stockAlerts } from "@/lib/stock-rules";

// Resposta pequena e própria para os avisos de estoque (dashboard e sino).
// Carregada ao entrar e depois de movimentações; não entra na consulta periódica da agenda.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });

  const [products, balances, warningDays] = await Promise.all([
    prisma.product.findMany({ where: { clinicId: user.clinicId, archivedAt: null }, select: { id: true, name: true, unit: true, minStock: true, lots: { select: { id: true, code: true, expiresOn: true } } } }),
    lotBalances(user.clinicId),
    clinicWarningDays(user.clinicId),
  ]);
  const alerts = stockAlerts({
    today: clinicToday(),
    warningDays,
    materials: products.map((product) => ({ id: product.id, name: product.name, unit: product.unit, minStock: product.minStock, balance: materialBalance(product.lots.map((lot) => ({ balance: balances.get(lot.id) ?? 0 })), product.minStock).balance })),
    lots: products.flatMap((product) => product.lots.map((lot) => ({ id: lot.id, productId: product.id, productName: product.name, code: lot.code, expiresOn: dateOnly(lot.expiresOn), balance: balances.get(lot.id) ?? 0 }))),
  });
  return NextResponse.json({ alerts });
}
