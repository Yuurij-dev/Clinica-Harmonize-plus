import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { canForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { normalizeSearch, parseCatalogListParams } from "@/lib/procedure-catalog-rules";
import { STOCK_CATALOG, filterStockCatalog, findCatalogItem } from "@/lib/stock-catalog";
import { listMaterials } from "@/lib/stock";
import { isStockKind } from "@/lib/stock-rules";

const productSelect = { id: true, name: true, kind: true, unit: true, costCents: true, supplier: true, minStock: true, archivedAt: true } as const;

// Catálogo padrão de materiais e produtos (global, em código) com a marca "já no estoque" da clínica da sessão.
// Busca ?q= sem acento/caixa, ?kind=material|produto, ?limit= (máx. 100) e ?offset=. Só quem gerencia o estoque.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "stock:manage")) return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const { q, limit, offset } = parseCatalogListParams(params);
  const kindParam = params.get("kind");
  const filtered = filterStockCatalog(STOCK_CATALOG, q, isStockKind(kindParam) ? kindParam : undefined);
  const products = await prisma.product.findMany({ where: { clinicId: user.clinicId }, select: { id: true, name: true, archivedAt: true } });
  const productByName = new Map(products.map((product) => [normalizeSearch(product.name), product]));
  return NextResponse.json({
    total: filtered.length,
    items: filtered.slice(offset, offset + limit).map((item) => {
      const product = productByName.get(normalizeSearch(item.name));
      const archived = Boolean(product?.archivedAt);
      return { ...item, enabled: Boolean(product) && !archived, archived, productId: product && !archived ? product.id : null };
    }),
  });
}

// Escolher um item do catálogo cria o Product da clínica (custo 0, sem fornecedor), sem duplicar o que já existe.
export async function POST(request: Request) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  if (!canForUser(user, "stock:manage")) return NextResponse.json({ message: "Acesso restrito a administradores." }, { status: 403 });
  const body = await request.json().catch(() => null) as { slug?: unknown } | null;
  if (typeof body?.slug !== "string" || !body.slug) return NextResponse.json({ message: "Informe o item do catálogo." }, { status: 400 });
  const item = findCatalogItem(body.slug);
  if (!item) return NextResponse.json({ message: "Item do catálogo não encontrado." }, { status: 404 });

  const reuse = async (productId: string) => {
    const product = (await listMaterials(user.clinicId, true)).find((candidate) => candidate.id === productId);
    if (!product) return NextResponse.json({ message: "Não foi possível usar este item agora. Tente novamente." }, { status: 409 });
    return NextResponse.json({ product, created: false });
  };
  const wanted = normalizeSearch(item.name);
  const existing = (await prisma.product.findMany({ where: { clinicId: user.clinicId }, select: { id: true, name: true, archivedAt: true } }))
    .find((product) => normalizeSearch(product.name) === wanted);
  if (existing?.archivedAt) return NextResponse.json({ message: "Este item está arquivado no estoque. Desarquive-o para usar." }, { status: 409 });
  if (existing) return reuse(existing.id);

  try {
    const product = await prisma.product.create({
      data: { clinicId: user.clinicId, name: item.name, kind: item.kind, unit: item.unit, costCents: 0, supplier: "", minStock: 0 },
      select: productSelect,
    });
    return NextResponse.json({ product: { ...product, balance: 0, belowMinimum: false, hasMovements: false }, created: true }, { status: 201 });
  } catch (error) {
    // Corrida: outra requisição criou o mesmo nome (chave única clinicId+name) entre a leitura e a criação.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await prisma.product.findFirst({ where: { clinicId: user.clinicId, name: item.name }, select: { id: true, archivedAt: true } });
      if (winner?.archivedAt) return NextResponse.json({ message: "Este item está arquivado no estoque. Desarquive-o para usar." }, { status: 409 });
      if (winner) return reuse(winner.id);
    }
    throw error;
  }
}
