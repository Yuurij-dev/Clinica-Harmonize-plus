import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const id = (await params).id;
  const data = {
    name: typeof body?.name === "string" ? body.name.trim() : undefined,
    category: typeof body?.category === "string" ? body.category.trim() : undefined,
    materials: typeof body?.materials === "string" ? body.materials.trim() : undefined,
    price: Number.isFinite(Number(body?.price)) ? Math.max(0, Math.round(Number(body?.price))) : undefined,
    durationMinutes: Number.isInteger(Number(body?.durationMinutes)) ? Math.max(1, Number(body?.durationMinutes)) : undefined,
    margin: Number.isFinite(Number(body?.margin)) ? Math.max(0, Math.min(100, Number(body?.margin))) : undefined,
  };
  const result = await prisma.procedure.updateMany({ where: { id, clinicId: user.clinicId }, data });
  if (!result.count) return NextResponse.json({ message: "Procedimento não encontrado." }, { status: 404 });
  const procedure = await prisma.procedure.findFirst({ where: { id, clinicId: user.clinicId } });
  return NextResponse.json({ procedure });
}
