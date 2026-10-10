import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseTechnicalSheet, serializeTechnicalSheet, technicalSheetSelect } from "@/lib/stock";

const procedureSelect = { id: true, name: true, category: true, price: true, durationMinutes: true, margin: true, materialsNeedReview: true, ...technicalSheetSelect } as const;

function serializeProcedure<T extends { technicalSheet: Parameters<typeof serializeTechnicalSheet>[0] }>({ technicalSheet, ...procedure }: T) {
  return { ...procedure, technicalSheet: serializeTechnicalSheet(technicalSheet) };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const procedures = await prisma.procedure.findMany({ where: { clinicId: user.clinicId }, orderBy: { name: "asc" }, select: procedureSelect });
  return NextResponse.json({ procedures: procedures.map(serializeProcedure) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const category = typeof body?.category === "string" ? body.category.trim() : "";
  const price = Number(body?.price);
  const durationMinutes = Number(body?.durationMinutes);
  const margin = Number(body?.margin);
  if (!name || !category || !Number.isFinite(price) || !Number.isInteger(durationMinutes) || !Number.isFinite(margin)) {
    return NextResponse.json({ message: "Preencha os dados do procedimento." }, { status: 400 });
  }
  const sheet = await parseTechnicalSheet(user.clinicId, body?.technicalSheet ?? []);
  if ("error" in sheet) return NextResponse.json({ message: sheet.error }, { status: 400 });
  const procedure = await prisma.procedure.create({
    data: {
      clinicId: user.clinicId, name, category, materials: sheet.description,
      price: Math.max(0, Math.round(price)), durationMinutes: Math.max(1, durationMinutes), margin: Math.max(0, Math.min(100, margin)),
      technicalSheet: { create: sheet.items },
    },
    select: procedureSelect,
  });
  return NextResponse.json({ procedure: serializeProcedure(procedure) }, { status: 201 });
}
