import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { parseDateOnly } from "@/lib/clinic-time";
import { prisma } from "@/lib/prisma";
import { findOrCreateLot, materialDetail, movementTypes, StockError } from "@/lib/stock";
import { validateQuantity } from "@/lib/stock-rules";

// Saldo inicial: entrada de um lote que já está na prateleira, sem compra e sem despesa.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const productId = (await params).id;
  const body = await request.json().catch(() => null) as { lotCode?: string; expiresOn?: string; quantity?: number } | null;
  const product = await prisma.product.findFirst({ where: { id: productId, clinicId: user.clinicId, archivedAt: null }, select: { id: true, unit: true } });
  if (!product) return NextResponse.json({ message: "Material não encontrado." }, { status: 404 });
  const code = body?.lotCode?.trim();
  const expiresOn = parseDateOnly(body?.expiresOn);
  const quantity = Number(body?.quantity);
  if (!code || !expiresOn) return NextResponse.json({ message: "Informe o lote e a validade." }, { status: 400 });
  const quantityError = validateQuantity(quantity, product.unit);
  if (quantityError) return NextResponse.json({ message: quantityError }, { status: 400 });

  try {
    await prisma.$transaction(async (tx) => {
      const lot = await findOrCreateLot(tx, { clinicId: user.clinicId, productId, code, expiresOn });
      await tx.stockMovement.create({ data: { clinicId: user.clinicId, productId, lotId: lot.id, type: movementTypes.initial, quantity, notes: "Saldo inicial", userId: user.id, userName: user.name } });
    });
  } catch (error) {
    if (error instanceof StockError) return NextResponse.json({ message: error.message }, { status: 409 });
    throw error;
  }
  return NextResponse.json({ product: await materialDetail(user.clinicId, productId) }, { status: 201 });
}
