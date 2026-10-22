import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseCreateProcedure } from "@/lib/procedure-catalog-rules";
import { lockAsset, procedureSelect, serializeProcedure } from "@/lib/procedure-server";
import { parseTechnicalSheet } from "@/lib/stock";

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
  const clinicId = user.clinicId;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const parsed = parseCreateProcedure(body);
  if (!parsed.ok) return NextResponse.json({ message: parsed.message }, { status: 400 });
  const input = parsed.data;
  const sheet = await parseTechnicalSheet(clinicId, body?.technicalSheet ?? []);
  if ("error" in sheet) return NextResponse.json({ message: sheet.error }, { status: 400 });

  let name: string;
  let catalogItemId: string | null = null;
  let imageAssetId: string | null = null;
  let imageCatalogItemId: string | null = null;
  if (input.mode === "catalog") {
    const item = await prisma.procedureCatalogItem.findFirst({ where: { id: input.catalogItemId, active: true }, select: { id: true, name: true } });
    if (!item) return NextResponse.json({ message: "Procedimento do catálogo não encontrado." }, { status: 404 });
    if (await prisma.procedure.findFirst({ where: { clinicId, catalogItemId: item.id }, select: { id: true } })) {
      return NextResponse.json({ message: "Este procedimento do catálogo já está habilitado na clínica." }, { status: 409 });
    }
    name = item.name;
    catalogItemId = item.id;
  } else {
    name = input.name;
    // A imagem enviada precisa ser desta clínica; a existência é conferida de novo, com a linha travada, na transação de criação.
    if (input.imageAssetId) imageAssetId = input.imageAssetId;
    if (input.catalogImageId) {
      if (!await prisma.procedureCatalogItem.findFirst({ where: { id: input.catalogImageId, active: true }, select: { id: true } })) return NextResponse.json({ message: "Imagem da biblioteca não encontrada." }, { status: 400 });
      imageCatalogItemId = input.catalogImageId;
    }
  }
  if (await prisma.procedure.findFirst({ where: { clinicId, name }, select: { id: true } })) return NextResponse.json({ message: "Já existe um procedimento com este nome." }, { status: 409 });

  try {
    // FOR SHARE na imagem: um DELETE concorrente da mesma imagem espera esta transação (e vê "em uso") ou vence (e aqui vira 400).
    const procedure = await prisma.$transaction(async (tx) => {
      if (imageAssetId && !await lockAsset(tx, clinicId, imageAssetId, "share")) return null;
      return tx.procedure.create({
        data: {
          clinicId, name, category: input.category, materials: sheet.description, catalogItemId, imageAssetId, imageCatalogItemId,
          price: input.price, durationMinutes: input.durationMinutes, margin: input.margin,
          technicalSheet: { create: sheet.items },
        },
        select: procedureSelect,
      });
    });
    if (!procedure) return NextResponse.json({ message: "Imagem não encontrada." }, { status: 400 });
    return NextResponse.json({ procedure: serializeProcedure(procedure) }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return NextResponse.json({ message: "Imagem não encontrada." }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = JSON.stringify(error.meta?.target ?? "");
      return NextResponse.json({ message: target.includes("catalogItemId") ? "Este procedimento do catálogo já está habilitado na clínica." : "Já existe um procedimento com este nome." }, { status: 409 });
    }
    throw error;
  }
}
