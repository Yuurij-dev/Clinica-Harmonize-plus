import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePatchProcedure } from "@/lib/procedure-catalog-rules";
import { isValidId } from "@/lib/procedure-catalog-rules";
import { discardAssetIfUnused, lockAsset, procedureSelect, serializeProcedure } from "@/lib/procedure-server";
import { parseTechnicalSheet } from "@/lib/stock";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const clinicId = user.clinicId;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const id = (await params).id;
  if (!isValidId(id)) return NextResponse.json({ message: "Procedimento não encontrado." }, { status: 404 });
  const current = await prisma.procedure.findFirst({ where: { id, clinicId }, select: { name: true, imageAssetId: true, technicalSheet: { select: { productId: true } } } });
  if (!current) return NextResponse.json({ message: "Procedimento não encontrado." }, { status: 404 });
  const parsed = parsePatchProcedure(body);
  if (!parsed.ok) return NextResponse.json({ message: parsed.message }, { status: 400 });
  const { image, ...fields } = parsed.data;

  if (fields.name && fields.name !== current.name && await prisma.procedure.findFirst({ where: { clinicId, name: fields.name, NOT: { id } }, select: { id: true } })) {
    return NextResponse.json({ message: "Já existe um procedimento com este nome." }, { status: 409 });
  }
  // Trocar/remover imagem: a enviada precisa ser desta clínica; a da biblioteca precisa existir e estar ativa.
  let imageData: { imageAssetId: string | null; imageCatalogItemId: string | null } | undefined;
  if (image) {
    if (image.catalogImageId && !await prisma.procedureCatalogItem.findFirst({ where: { id: image.catalogImageId, active: true }, select: { id: true } })) return NextResponse.json({ message: "Imagem da biblioteca não encontrada." }, { status: 400 });
    imageData = { imageAssetId: image.assetId, imageCatalogItemId: image.catalogImageId };
  }
  const sheet = body?.technicalSheet === undefined ? null : await parseTechnicalSheet(clinicId, body.technicalSheet, current.technicalSheet.map((item) => item.productId));
  if (sheet && "error" in sheet) return NextResponse.json({ message: sheet.error }, { status: 400 });

  // Salvar a ficha técnica tira a marca de revisão da conversão automática.
  try {
    const procedure = await prisma.$transaction(async (tx) => {
      // FOR SHARE na imagem nova: ver comentário em POST /api/procedures.
      if (imageData?.imageAssetId && !await lockAsset(tx, clinicId, imageData.imageAssetId, "share")) return null;
      if (sheet) await tx.procedureMaterial.deleteMany({ where: { procedureId: id, procedure: { clinicId } } });
      return tx.procedure.update({
        where: { id, clinicId },
        data: { ...fields, ...imageData, ...(sheet ? { materials: sheet.description, materialsNeedReview: false, technicalSheet: { create: sheet.items } } : {}) },
        select: procedureSelect,
      });
    });
    if (!procedure) return NextResponse.json({ message: "Imagem não encontrada." }, { status: 400 });
    if (imageData && current.imageAssetId && current.imageAssetId !== imageData.imageAssetId) await discardAssetIfUnused(clinicId, current.imageAssetId);
    return NextResponse.json({ procedure: serializeProcedure(procedure) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return NextResponse.json({ message: "Imagem não encontrada." }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ message: "Já existe um procedimento com este nome." }, { status: 409 });
    throw error;
  }
}
