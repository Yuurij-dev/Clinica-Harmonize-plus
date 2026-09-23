import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const procedures = await prisma.procedure.findMany({
    where: { clinicId: user.clinicId },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ procedures });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const category = typeof body?.category === "string" ? body.category.trim() : "";
  const materials = typeof body?.materials === "string" ? body.materials.trim() : "";
  const price = Number(body?.price);
  const durationMinutes = Number(body?.durationMinutes);
  const margin = Number(body?.margin);
  if (!name || !category || !materials || !Number.isFinite(price) || !Number.isInteger(durationMinutes) || !Number.isFinite(margin)) {
    return NextResponse.json({ message: "Preencha os dados do procedimento." }, { status: 400 });
  }
  const procedure = await prisma.procedure.create({
    data: { clinicId: user.clinicId, name, category, materials, price: Math.max(0, Math.round(price)), durationMinutes: Math.max(1, durationMinutes), margin: Math.max(0, Math.min(100, margin)) },
  });
  return NextResponse.json({ procedure }, { status: 201 });
}
