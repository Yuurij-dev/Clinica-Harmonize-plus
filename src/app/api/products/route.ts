import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  return NextResponse.json({ products: await prisma.product.findMany({ where: { clinicId: user.clinicId }, orderBy: { name: "asc" } }) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const body = await request.json().catch(() => null) as { name?: string; category?: string; unit?: string; cost?: number; supplier?: string } | null;
  const cost = Number(body?.cost);
  if (!body?.name?.trim() || !body.category?.trim() || !body.unit?.trim() || !body.supplier?.trim() || !Number.isFinite(cost)) return NextResponse.json({ message: "Preencha os dados do material." }, { status: 400 });
  const product = await prisma.product.create({ data: { clinicId: user.clinicId, name: body.name.trim(), category: body.category.trim(), unit: body.unit.trim(), cost: Math.max(0, Math.round(cost)), supplier: body.supplier.trim() } });
  return NextResponse.json({ product }, { status: 201 });
}
