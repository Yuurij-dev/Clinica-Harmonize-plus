import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { materialDetail } from "@/lib/stock";
import { isStockUnit } from "@/lib/stock-rules";

async function adminUser(requireActiveTrial = false) {
  const user = await getCurrentUser({ requireActiveTrial });
  if (!user) return { error: NextResponse.json({ message: "Não autenticado." }, { status: 401 }) };
  if (user.role !== "ADMIN") return { error: NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 }) };
  return { user };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await adminUser();
  if (error) return error;
  const product = await materialDetail(user.clinicId, (await params).id);
  if (!product) return NextResponse.json({ message: "Material não encontrado." }, { status: 404 });
  return NextResponse.json({ product });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await adminUser(true);
  if (error) return error;
  const id = (await params).id;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const current = await prisma.product.findFirst({ where: { id, clinicId: user.clinicId }, select: { id: true, unit: true } });
  if (!current) return NextResponse.json({ message: "Material não encontrado." }, { status: 404 });

  const text = (key: string) => typeof body?.[key] === "string" && String(body[key]).trim() ? String(body[key]).trim() : undefined;
  const data: { name?: string; category?: string; supplier?: string; unit?: string; costCents?: number; minStock?: number; archivedAt?: Date | null } = {
    name: text("name"), category: text("category"), supplier: text("supplier"),
  };
  if (body?.unit !== undefined && body.unit !== current.unit) {
    if (!isStockUnit(body.unit)) return NextResponse.json({ message: "Unidade inválida." }, { status: 400 });
    const movements = await prisma.stockMovement.count({ where: { clinicId: user.clinicId, productId: id } });
    if (movements) return NextResponse.json({ message: "A unidade não pode ser trocada depois que o material teve movimentações." }, { status: 409 });
    data.unit = body.unit;
  }
  if (body?.costCents !== undefined) {
    const costCents = Number(body.costCents);
    if (!Number.isInteger(costCents) || costCents < 0) return NextResponse.json({ message: "Informe um custo válido." }, { status: 400 });
    data.costCents = costCents;
  }
  if (body?.minStock !== undefined) {
    const minStock = Number(body.minStock);
    if (!Number.isFinite(minStock) || minStock < 0) return NextResponse.json({ message: "Informe um estoque mínimo válido." }, { status: 400 });
    data.minStock = minStock;
  }
  if (typeof body?.archived === "boolean") data.archivedAt = body.archived ? new Date() : null;
  if (data.name) {
    const duplicate = await prisma.product.findFirst({ where: { clinicId: user.clinicId, name: data.name, NOT: { id } }, select: { id: true } });
    if (duplicate) return NextResponse.json({ message: "Já existe um material com esse nome." }, { status: 409 });
  }

  await prisma.product.update({ where: { id }, data });
  return NextResponse.json({ product: await materialDetail(user.clinicId, id) });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await adminUser(true);
  if (error) return error;
  const id = (await params).id;
  const product = await prisma.product.findFirst({ where: { id, clinicId: user.clinicId }, select: { id: true } });
  if (!product) return NextResponse.json({ message: "Material não encontrado." }, { status: 404 });
  const movements = await prisma.stockMovement.count({ where: { clinicId: user.clinicId, productId: id } });
  if (movements) return NextResponse.json({ message: "Este material já teve movimentações. Arquive-o em vez de apagar." }, { status: 409 });
  await prisma.product.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
