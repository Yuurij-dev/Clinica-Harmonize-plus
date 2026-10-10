import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { clinicToday, dateOnly } from "@/lib/clinic-time";
import { prisma } from "@/lib/prisma";
import { lockLots, lotBalances, movementTypes } from "@/lib/stock";
import { allocateLots } from "@/lib/stock-rules";

class PendingError extends Error {}

// Conclui uma saída pendente: desconta do lote escolhido (ou dos que vencem primeiro) e
// liga a saída ao mesmo atendimento. Recusa se não houver saldo para a quantidade toda.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const id = (await params).id;
  const body = await request.json().catch(() => null) as { lotId?: string } | null;

  try {
    await prisma.$transaction(async (tx) => {
      const pending = await tx.pendingStockOutput.findFirst({ where: { id, clinicId: user.clinicId, status: "pending" }, select: { id: true, productId: true, quantity: true, appointmentId: true, patientId: true, attendanceKind: true, attendanceName: true, attendanceDate: true, product: { select: { name: true, lots: { select: { id: true, code: true, expiresOn: true } } } } } });
      if (!pending) throw new PendingError("Saída pendente não encontrada ou já concluída.");
      const lots = pending.product.lots;
      await lockLots(tx, lots.map((lot) => lot.id));
      const balances = await lotBalances(user.clinicId, { lotId: { in: lots.map((lot) => lot.id) } }, tx);
      const today = clinicToday();
      const candidates = lots.filter((lot) => !body?.lotId || lot.id === body.lotId).map((lot) => ({ id: lot.id, expiresOn: dateOnly(lot.expiresOn), balance: balances.get(lot.id) ?? 0 }));
      if (body?.lotId && (!candidates.length || candidates[0].expiresOn < today)) throw new PendingError("Escolha um lote válido (não vencido).");
      const { allocations, pending: missing } = allocateLots(pending.quantity, candidates, today);
      if (missing > 0) throw new PendingError(`Saldo insuficiente de ${pending.product.name}. Registre uma compra ou ajuste antes.`);
      for (const allocation of allocations) {
        await tx.stockMovement.create({ data: { clinicId: user.clinicId, productId: pending.productId, lotId: allocation.lotId, type: movementTypes.attendance, quantity: -allocation.quantity, notes: "Saída pendente concluída", userId: user.id, userName: user.name, appointmentId: pending.appointmentId, patientId: pending.patientId, attendanceKind: pending.attendanceKind, attendanceName: pending.attendanceName, attendanceDate: pending.attendanceDate } });
      }
      await tx.pendingStockOutput.update({ where: { id: pending.id }, data: { status: "done", resolvedAt: new Date() } });
    });
  } catch (error) {
    if (error instanceof PendingError) return NextResponse.json({ message: error.message }, { status: 400 });
    throw error;
  }
  return NextResponse.json({ ok: true });
}
