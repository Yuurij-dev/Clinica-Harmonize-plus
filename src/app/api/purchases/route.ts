import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { dateOnly, parseDateOnly } from "@/lib/clinic-time";
import { splitInstallments } from "@/lib/finance-rules";
import { prisma } from "@/lib/prisma";
import { findOrCreateLot, movementTypes, StockError } from "@/lib/stock";
import { validateQuantity } from "@/lib/stock-rules";

type ItemInput = { productId?: unknown; lotCode?: unknown; expiresOn?: unknown; quantity?: unknown; unitPriceCents?: unknown };

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const purchases = await prisma.purchase.findMany({
    where: { clinicId: user.clinicId },
    orderBy: [{ purchasedOn: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      id: true, supplier: true, invoiceNumber: true, purchasedOn: true, paymentMethod: true, installments: true, status: true,
      items: { select: { quantity: true, unitPriceCents: true, product: { select: { name: true, unit: true } }, lot: { select: { code: true } } } },
      expenses: { select: { status: true } },
    },
  });
  return NextResponse.json({
    purchases: purchases.map(({ items, expenses, ...purchase }) => ({
      ...purchase,
      purchasedOn: dateOnly(purchase.purchasedOn),
      totalCents: items.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPriceCents), 0),
      items: items.map((item) => ({ name: item.product.name, unit: item.product.unit, lotCode: item.lot.code, quantity: item.quantity, unitPriceCents: item.unitPriceCents })),
      paidInstallments: expenses.filter((expense) => expense.status === "paid").length,
    })),
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const body = await request.json().catch(() => null) as { supplier?: string; invoiceNumber?: string; purchasedOn?: string; paymentMethod?: string; installments?: number; firstDueOn?: string; paid?: boolean; items?: ItemInput[] } | null;
  const supplier = body?.supplier?.trim();
  const purchasedOn = parseDateOnly(body?.purchasedOn);
  const firstDueOn = parseDateOnly(body?.firstDueOn ?? body?.purchasedOn);
  const installments = Number(body?.installments ?? 1);
  if (!supplier || !purchasedOn || !firstDueOn || !body?.paymentMethod?.trim()) return NextResponse.json({ message: "Informe fornecedor, data, forma de pagamento e vencimento." }, { status: 400 });
  if (!Number.isInteger(installments) || installments < 1 || installments > 24) return NextResponse.json({ message: "Informe de 1 a 24 parcelas." }, { status: 400 });
  if (!Array.isArray(body.items) || !body.items.length) return NextResponse.json({ message: "Adicione pelo menos um item à compra." }, { status: 400 });

  const products = await prisma.product.findMany({ where: { clinicId: user.clinicId, archivedAt: null, id: { in: body.items.map((item) => String(item.productId ?? "")) } }, select: { id: true, name: true, unit: true } });
  const items: Array<{ product: { id: string; name: string; unit: string }; lotCode: string; expiresOn: Date; quantity: number; unitPriceCents: number }> = [];
  for (const raw of body.items) {
    const product = products.find((candidate) => candidate.id === raw.productId);
    const lotCode = typeof raw.lotCode === "string" ? raw.lotCode.trim() : "";
    const expiresOn = parseDateOnly(raw.expiresOn);
    const quantity = Number(raw.quantity);
    const unitPriceCents = Number(raw.unitPriceCents);
    if (!product) return NextResponse.json({ message: "Material da compra não encontrado." }, { status: 400 });
    if (!lotCode || !expiresOn) return NextResponse.json({ message: `${product.name}: informe o lote e a validade.` }, { status: 400 });
    const quantityError = validateQuantity(quantity, product.unit);
    if (quantityError) return NextResponse.json({ message: `${product.name}: ${quantityError}` }, { status: 400 });
    if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) return NextResponse.json({ message: `${product.name}: informe o preço unitário.` }, { status: 400 });
    items.push({ product, lotCode, expiresOn, quantity, unitPriceCents });
  }
  const totalCents = items.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPriceCents), 0);
  if (totalCents <= 0) return NextResponse.json({ message: "O total da compra deve ser maior que zero." }, { status: 400 });

  try {
    const purchase = await prisma.$transaction(async (tx) => {
      const created = await tx.purchase.create({
        data: { clinicId: user.clinicId, supplier, invoiceNumber: body.invoiceNumber?.trim() || null, purchasedOn, paymentMethod: body.paymentMethod!.trim(), installments, userId: user.id, userName: user.name },
      });
      for (const item of items) {
        const lot = await findOrCreateLot(tx, { clinicId: user.clinicId, productId: item.product.id, code: item.lotCode, expiresOn: item.expiresOn });
        await tx.purchaseItem.create({ data: { purchaseId: created.id, productId: item.product.id, lotId: lot.id, quantity: item.quantity, unitPriceCents: item.unitPriceCents } });
        await tx.stockMovement.create({ data: { clinicId: user.clinicId, productId: item.product.id, lotId: lot.id, type: movementTypes.purchase, quantity: item.quantity, purchaseId: created.id, notes: `Compra ${supplier}`, userId: user.id, userName: user.name } });
        // O custo do material passa a ser o preço desta compra se ela for a mais recente do material.
        const newer = await tx.purchaseItem.count({ where: { productId: item.product.id, purchase: { status: "active", purchasedOn: { gt: purchasedOn }, id: { not: created.id } } } });
        if (!newer) await tx.product.update({ where: { id: item.product.id }, data: { costCents: item.unitPriceCents } });
      }
      const label = `Compra ${supplier}${body.invoiceNumber?.trim() ? ` · NF ${body.invoiceNumber.trim()}` : ""}`;
      for (const part of splitInstallments(totalCents, installments, dateOnly(firstDueOn))) {
        const dueOn = new Date(`${part.dueOn}T00:00:00Z`);
        await tx.expense.create({
          data: {
            clinicId: user.clinicId, description: installments > 1 ? `${label} (${part.number}/${installments})` : label,
            category: "Materiais/Estoque", amountCents: part.amountCents, dueOn, paymentMethod: body.paymentMethod!.trim(),
            status: body.paid ? "paid" : "open", paidOn: body.paid ? dueOn : null, source: "purchase", purchaseId: created.id, installmentNumber: part.number, createdById: user.id,
          },
        });
      }
      return created;
    });
    return NextResponse.json({ purchase: { id: purchase.id, totalCents } }, { status: 201 });
  } catch (error) {
    if (error instanceof StockError) return NextResponse.json({ message: error.message }, { status: 409 });
    throw error;
  }
}
