import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listMaterials } from "@/lib/stock";
import { isStockKind, isStockUnit } from "@/lib/stock-rules";

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
  const body = await request.json().catch(() => null) as { name?: string; kind?: string; unit?: string; costCents?: number; supplier?: string; minStock?: number } | null;
  const costCents = Number(body?.costCents);
  const minStock = body?.minStock === undefined ? 0 : Number(body.minStock);
  if (!isStockKind(body?.kind)) return NextResponse.json({ message: "Informe se o item é material ou produto." }, { status: 400 });
  if (!body?.name?.trim() || !isStockUnit(body.unit) || !body.supplier?.trim() || !Number.isInteger(costCents) || costCents < 0) return NextResponse.json({ message: "Preencha os dados do item." }, { status: 400 });
  if (!Number.isFinite(minStock) || minStock < 0) return NextResponse.json({ message: "Informe um estoque mínimo válido." }, { status: 400 });
  const duplicate = await prisma.product.findFirst({ where: { clinicId: user.clinicId, name: body.name.trim() }, select: { id: true } });
  if (duplicate) return NextResponse.json({ message: "Já existe um item com esse nome no estoque." }, { status: 409 });
  const product = await prisma.product.create({
    data: { clinicId: user.clinicId, name: body.name.trim(), kind: body.kind, unit: body.unit, costCents, supplier: body.supplier.trim(), minStock },
    select: { id: true, name: true, kind: true, unit: true, costCents: true, supplier: true, minStock: true, archivedAt: true },
  });
  return NextResponse.json({ product: { ...product, balance: 0, belowMinimum: minStock > 0, hasMovements: false } }, { status: 201 });
}
