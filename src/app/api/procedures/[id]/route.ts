import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseTechnicalSheet, serializeTechnicalSheet, technicalSheetSelect } from "@/lib/stock";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const id = (await params).id;
  const current = await prisma.procedure.findFirst({ where: { id, clinicId: user.clinicId }, select: { technicalSheet: { select: { productId: true } } } });
  if (!current) return NextResponse.json({ message: "Procedimento não encontrado." }, { status: 404 });
  const data = {
    name: typeof body?.name === "string" ? body.name.trim() : undefined,
    category: typeof body?.category === "string" ? body.category.trim() : undefined,
    price: Number.isFinite(Number(body?.price)) ? Math.max(0, Math.round(Number(body?.price))) : undefined,
    durationMinutes: Number.isInteger(Number(body?.durationMinutes)) ? Math.max(1, Number(body?.durationMinutes)) : undefined,
    margin: Number.isFinite(Number(body?.margin)) ? Math.max(0, Math.min(100, Number(body?.margin))) : undefined,
  };
  const sheet = body?.technicalSheet === undefined ? null : await parseTechnicalSheet(user.clinicId, body.technicalSheet, current.technicalSheet.map((item) => item.productId));
  if (sheet && "error" in sheet) return NextResponse.json({ message: sheet.error }, { status: 400 });

  // Salvar a ficha técnica tira a marca de revisão da conversão automática.
  const procedure = await prisma.$transaction(async (tx) => {
    if (sheet) await tx.procedureMaterial.deleteMany({ where: { procedureId: id } });
    return tx.procedure.update({
      where: { id },
      data: { ...data, ...(sheet ? { materials: sheet.description, materialsNeedReview: false, technicalSheet: { create: sheet.items } } : {}) },
      select: { id: true, name: true, category: true, price: true, durationMinutes: true, margin: true, materialsNeedReview: true, ...technicalSheetSelect },
    });
  });
  const { technicalSheet, ...rest } = procedure;
  return NextResponse.json({ procedure: { ...rest, technicalSheet: serializeTechnicalSheet(technicalSheet) } });
}
