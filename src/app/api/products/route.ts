import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listMaterials } from "@/lib/stock";
import { isStockUnit } from "@/lib/stock-rules";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const includeArchived = new URL(request.url).searchParams.get("archived") === "1";
  return NextResponse.json({ products: await listMaterials(user.clinicId, includeArchived) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const body = await request.json().catch(() => null) as { name?: string; category?: string; unit?: string; costCents?: number; supplier?: string; minStock?: number } | null;
  const costCents = Number(body?.costCents);
  const minStock = body?.minStock === undefined ? 0 : Number(body.minStock);
  if (!body?.name?.trim() || !body.category?.trim() || !isStockUnit(body.unit) || !body.supplier?.trim() || !Number.isInteger(costCents) || costCents < 0) return NextResponse.json({ message: "Preencha os dados do material." }, { status: 400 });
  if (!Number.isFinite(minStock) || minStock < 0) return NextResponse.json({ message: "Informe um estoque mínimo válido." }, { status: 400 });
  const duplicate = await prisma.product.findFirst({ where: { clinicId: user.clinicId, name: body.name.trim() }, select: { id: true } });
  if (duplicate) return NextResponse.json({ message: "Já existe um material com esse nome." }, { status: 409 });
  const product = await prisma.product.create({ data: { clinicId: user.clinicId, name: body.name.trim(), category: body.category.trim(), unit: body.unit, costCents, supplier: body.supplier.trim(), minStock } });
  return NextResponse.json({ product: { ...product, balance: 0, belowMinimum: minStock > 0, hasMovements: false } }, { status: 201 });
}
