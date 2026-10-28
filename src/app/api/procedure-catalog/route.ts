import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { filterCatalog, parseCatalogListParams } from "@/lib/procedure-catalog-rules";
import { isSafeCatalogImageFile } from "@/lib/procedure-image-rules";

// Catálogo padrão (global, somente leitura) com a marca de habilitação da clínica da sessão.
// Busca ?q= sem acento/caixa; ?limit= (máx. 100) e ?offset=. Sem bytes de imagem: só a URL estática.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "procedures:access")) return NextResponse.json({ message: "Seu cargo não tem acesso aos procedimentos." }, { status: 403 });
  const { q, limit, offset } = parseCatalogListParams(new URL(request.url).searchParams);
  const [items, enabled] = await Promise.all([
    prisma.procedureCatalogItem.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, slug: true, name: true, imageFile: true, imageAlt: true } }),
    prisma.procedure.findMany({ where: { clinicId: user.clinicId, catalogItemId: { not: null } }, select: { id: true, catalogItemId: true } }),
  ]);
  const procedureByItem = new Map(enabled.map((row) => [row.catalogItemId, row.id]));
  const filtered = filterCatalog(items, q);
  return NextResponse.json({
    total: filtered.length,
    items: filtered.slice(offset, offset + limit).map((item) => ({
      id: item.id, slug: item.slug, name: item.name, imageUrl: isSafeCatalogImageFile(item.imageFile) ? item.imageFile : null, imageAlt: item.imageAlt,
      enabled: procedureByItem.has(item.id), procedureId: procedureByItem.get(item.id) ?? null,
    })),
  });
}
