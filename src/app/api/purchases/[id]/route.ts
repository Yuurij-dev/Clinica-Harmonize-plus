import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lotBalances, movementTypes } from "@/lib/stock";
import { roundQuantity } from "@/lib/stock-rules";

// Cancelar a compra desfaz as entradas e cancela as despesas ligadas.
// É recusado se o saldo de algum lote já não cobre o que a compra adicionou
// (parte dele saiu do estoque): nesse caso, corrija com um ajuste.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const body = await request.json().catch(() => null) as { action?: string } | null;
  if (body?.action !== "cancel") return NextResponse.json({ message: "Ação inválida." }, { status: 400 });
  const id = (await params).id;
  const purchase = await prisma.purchase.findFirst({ where: { id, clinicId: user.clinicId }, select: { id: true, status: true, supplier: true, items: { select: { productId: true, lotId: true, quantity: true } } } });
  if (!purchase) return NextResponse.json({ message: "Compra não encontrada." }, { status: 404 });
  if (purchase.status === "cancelled") return NextResponse.json({ message: "Esta compra já está cancelada." }, { status: 409 });

  try {
    await prisma.$transaction(async (tx) => {
      const addedByLot = new Map<string, number>();
      for (const item of purchase.items) addedByLot.set(item.lotId, roundQuantity((addedByLot.get(item.lotId) ?? 0) + item.quantity));
      const balances = await lotBalances(user.clinicId, { lotId: { in: [...addedByLot.keys()] } }, tx);
      for (const [lotId, added] of addedByLot) {
        if ((balances.get(lotId) ?? 0) < added) throw new CancelBlocked();
      }

      for (const item of purchase.items) {
        await tx.stockMovement.create({ data: { clinicId: user.clinicId, productId: item.productId, lotId: item.lotId, type: movementTypes.purchaseCancel, quantity: -item.quantity, purchaseId: purchase.id, notes: `Cancelamento da compra ${purchase.supplier}`, userId: user.id, userName: user.name } });
      }
      await tx.expense.updateMany({ where: { clinicId: user.clinicId, purchaseId: purchase.id }, data: { status: "cancelled", paidOn: null } });
      await tx.purchase.update({ where: { id: purchase.id }, data: { status: "cancelled", cancelledAt: new Date() } });

      // O custo volta para o preço da compra ativa mais recente que sobrou de cada material.
      for (const productId of new Set(purchase.items.map((item) => item.productId))) {
        const latest = await tx.purchaseItem.findFirst({ where: { productId, purchase: { status: "active" } }, orderBy: [{ purchase: { purchasedOn: "desc" } }, { purchase: { createdAt: "desc" } }], select: { unitPriceCents: true } });
        if (latest) await tx.product.update({ where: { id: productId }, data: { costCents: latest.unitPriceCents } });
      }
    });
  } catch (error) {
    if (error instanceof CancelBlocked) return NextResponse.json({ message: "Parte de um lote desta compra já saiu do estoque. Corrija com um ajuste em vez de cancelar." }, { status: 409 });
    throw error;
  }
  return NextResponse.json({ ok: true });
}

class CancelBlocked extends Error {}
