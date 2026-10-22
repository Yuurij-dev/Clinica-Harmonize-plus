import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { removeStoredBytes } from "./clinical-storage";
import { orphanCutoff, orphanPurgeBatch, resolveProcedureImageRef } from "./procedure-image-rules";
import { serializeTechnicalSheet, technicalSheetSelect } from "./stock";

// Campos mínimos para resolver a imagem por id (sem bytes). Reutilizado por lista de procedimentos, agenda e orçamentos.
export const procedureImageSelect = {
  imageAssetId: true,
  imageCatalogItem: { select: { imageFile: true } },
  catalogItem: { select: { imageFile: true } },
} as const;

type ImageFields = { imageAssetId: string | null; imageCatalogItem: { imageFile: string } | null; catalogItem: { imageFile: string } | null };

export function imageOf(row: ImageFields) {
  return resolveProcedureImageRef({ assetId: row.imageAssetId, libraryImageFile: row.imageCatalogItem?.imageFile, catalogImageFile: row.catalogItem?.imageFile });
}

// Tira os campos internos de imagem e devolve só { image: { kind, url } }.
export function withImage<T extends ImageFields>({ imageAssetId, imageCatalogItem, catalogItem, ...rest }: T) {
  return { ...rest, image: imageOf({ imageAssetId, imageCatalogItem, catalogItem }) };
}

export const procedureSelect = {
  id: true, name: true, category: true, price: true, durationMinutes: true, margin: true, materialsNeedReview: true, catalogItemId: true,
  ...procedureImageSelect, ...technicalSheetSelect,
} as const;

export function serializeProcedure<T extends ImageFields & { technicalSheet: Parameters<typeof serializeTechnicalSheet>[0] }>({ technicalSheet, ...procedure }: T) {
  return { ...withImage(procedure), technicalSheet: serializeTechnicalSheet(technicalSheet) };
}

type Tx = Prisma.TransactionClient;

// Trava a linha da imagem (da clínica) até o fim da transação. FOR SHARE em quem vai vincular (criar/editar procedimento) e FOR UPDATE em quem apaga:
// os dois se excluem, então um vínculo concorrente nunca fica apontando para imagem apagada. Devolve false se a imagem não existe nesta clínica.
export async function lockAsset(tx: Tx, clinicId: string, assetId: string, mode: "share" | "update") {
  const rows = mode === "share"
    ? await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "ProcedureImageAsset" WHERE "id" = ${assetId} AND "clinicId" = ${clinicId} FOR SHARE`
    : await tx.$queryRaw<{ id: string; storageDriver: string; storageKey: string | null }[]>`SELECT "id", "storageDriver", "storageKey" FROM "ProcedureImageAsset" WHERE "id" = ${assetId} AND "clinicId" = ${clinicId} FOR UPDATE`;
  return rows[0] ?? null;
}

export type DeleteAssetResult = "deleted" | "missing" | "in-use";

// Apaga a imagem enviada só se NENHUM procedimento a usa. Dentro de uma transação com a linha travada (FOR UPDATE): apagadores concorrentes
// se enfileiram (o perdedor vê "missing") e quem vincula a imagem ao mesmo tempo ou vence (aqui vê "in-use") ou perde (recebe "imagem não encontrada").
export async function deleteAssetIfUnused(clinicId: string, assetId: string): Promise<DeleteAssetResult> {
  const result = await prisma.$transaction(async (tx) => {
    const asset = await lockAsset(tx, clinicId, assetId, "update") as { id: string; storageDriver: string; storageKey: string | null } | null;
    if (!asset) return { status: "missing" as const };
    if (await tx.procedure.count({ where: { clinicId, imageAssetId: assetId } }) > 0) return { status: "in-use" as const };
    await tx.procedureImageAsset.deleteMany({ where: { id: assetId, clinicId } });
    return { status: "deleted" as const, asset };
  });
  if (result.status === "deleted") await removeStoredBytes(result.asset);
  return result.status;
}

// Limpeza após trocar/remover imagem. Não falha a operação principal.
export async function discardAssetIfUnused(clinicId: string, assetId: string | null) {
  if (!assetId) return;
  try {
    await deleteAssetIfUnused(clinicId, assetId);
  } catch (error) {
    console.error("[procedures] limpeza de imagem não usada falhou", error instanceof Error ? error.message : error);
  }
}

// Descarta órfãos antigos da clínica (sem procedimento e com mais de 24 h), em lote limitado. Nunca toca dado clínico.
export async function purgeOrphanImages(clinicId: string) {
  try {
    const orphans = await prisma.procedureImageAsset.findMany({ where: { clinicId, createdAt: { lt: orphanCutoff() }, procedures: { none: {} } }, select: { id: true }, take: orphanPurgeBatch });
    for (const orphan of orphans) await deleteAssetIfUnused(clinicId, orphan.id);
  } catch (error) {
    console.error("[procedures] purga de imagens órfãs falhou", error instanceof Error ? error.message : error);
  }
}
