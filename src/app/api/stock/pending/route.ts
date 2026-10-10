import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { clinicToday, dateOnly } from "@/lib/clinic-time";
import { prisma } from "@/lib/prisma";
import { lotBalances } from "@/lib/stock";

// Pendências de estoque: saídas que ficaram sem saldo e conferências de materiais ainda não feitas.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const today = new Date(`${clinicToday()}T00:00:00Z`);
  const [outputs, checks, balances] = await Promise.all([
    prisma.pendingStockOutput.findMany({
      where: { clinicId: user.clinicId, status: "pending" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, quantity: true, attendanceKind: true, attendanceName: true, attendanceDate: true, patient: { select: { name: true } },
        product: { select: { id: true, name: true, unit: true, lots: { where: { expiresOn: { gte: today } }, orderBy: { expiresOn: "asc" }, select: { id: true, code: true, expiresOn: true } } } },
      },
    }),
    prisma.appointment.findMany({ where: { clinicId: user.clinicId, status: "Atendido", materialsCheck: "pending" }, orderBy: { date: "desc" }, take: 100, select: { id: true, procedure: true, date: true, time: true, patient: { select: { name: true } } } }),
    lotBalances(user.clinicId),
  ]);
  return NextResponse.json({
    outputs: outputs.map(({ product, patient, ...output }) => ({
      ...output,
      patientName: patient?.name ?? null,
      product: { id: product.id, name: product.name, unit: product.unit },
      lots: product.lots.map((lot) => ({ id: lot.id, code: lot.code, expiresOn: dateOnly(lot.expiresOn), balance: balances.get(lot.id) ?? 0 })).filter((lot) => lot.balance > 0),
    })),
    checks: checks.map(({ patient, ...check }) => ({ ...check, patientName: patient.name })),
  });
}
