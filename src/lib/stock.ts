import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { clinicToday, dateOnly } from "./clinic-time";
import { describeTechnicalSheet, lotBalance, lotStatus, materialBalance, validateQuantity } from "./stock-rules";

export type StockTransaction = Prisma.TransactionClient;

export const movementTypes = {
  initial: "initial",
  purchase: "purchase",
  attendance: "attendance",
  manualOut: "manual_out",
  countAdjustment: "count_adjustment",
  reversal: "reversal",
  purchaseCancel: "purchase_cancel",
} as const;

export async function clinicWarningDays(clinicId: string) {
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { expiryWarningDays: true } });
  return clinic?.expiryWarningDays ?? 30;
}

// Saldo de cada lote (soma das movimentações) numa única consulta agrupada.
export async function lotBalances(clinicId: string, where: Prisma.StockMovementWhereInput = {}, client: StockTransaction | typeof prisma = prisma) {
  const groups = await client.stockMovement.groupBy({ by: ["lotId"], where: { clinicId, ...where }, _sum: { quantity: true } });
  return new Map(groups.map((group) => [group.lotId, lotBalance([{ quantity: group._sum.quantity ?? 0 }])]));
}

export async function listMaterials(clinicId: string, includeArchived = false) {
  const [products, balances, movementCounts] = await Promise.all([
    prisma.product.findMany({
      where: { clinicId, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: { name: "asc" },
      select: { id: true, name: true, category: true, unit: true, costCents: true, supplier: true, minStock: true, archivedAt: true, lots: { select: { id: true } } },
    }),
    lotBalances(clinicId),
    prisma.stockMovement.groupBy({ by: ["productId"], where: { clinicId }, _count: { _all: true } }),
  ]);
  const withMovements = new Set(movementCounts.map((group) => group.productId));
  return products.map(({ lots, ...product }) => ({
    ...product,
    ...materialBalance(lots.map((lot) => ({ balance: balances.get(lot.id) ?? 0 })), product.minStock),
    hasMovements: withMovements.has(product.id),
  }));
}

export async function materialDetail(clinicId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, clinicId },
    select: {
      id: true, name: true, category: true, unit: true, costCents: true, supplier: true, minStock: true, archivedAt: true,
      lots: { orderBy: { expiresOn: "asc" }, select: { id: true, code: true, expiresOn: true } },
    },
  });
  if (!product) return null;
  const [balances, warningDays, movementCount] = await Promise.all([
    lotBalances(clinicId, { productId }),
    clinicWarningDays(clinicId),
    prisma.stockMovement.count({ where: { clinicId, productId } }),
  ]);
  const today = clinicToday();
  const lots = product.lots.map((lot) => {
    const expiresOn = dateOnly(lot.expiresOn);
    return { id: lot.id, code: lot.code, expiresOn, balance: balances.get(lot.id) ?? 0, status: lotStatus(expiresOn, today, warningDays) };
  });
  return { ...product, lots, ...materialBalance(lots, product.minStock), hasMovements: movementCount > 0, warningDays };
}

// Encontra o lote do material pelo código ou cria um novo. Recusa o mesmo código com outra validade.
export async function findOrCreateLot(tx: StockTransaction, input: { clinicId: string; productId: string; code: string; expiresOn: Date }) {
  const existing = await tx.stockLot.findUnique({ where: { productId_code: { productId: input.productId, code: input.code } } });
  if (existing) {
    if (existing.clinicId !== input.clinicId) throw new StockError("Lote inválido.");
    if (dateOnly(existing.expiresOn) !== dateOnly(input.expiresOn)) throw new StockError(`O lote ${input.code} já está cadastrado com validade ${dateOnly(existing.expiresOn).split("-").reverse().join("/")}.`);
    return existing;
  }
  return tx.stockLot.create({ data: input });
}

export class StockError extends Error {}

export const technicalSheetSelect = {
  technicalSheet: { orderBy: { product: { name: "asc" } }, select: { productId: true, quantity: true, product: { select: { name: true, unit: true, archivedAt: true } } } },
} as const;

type TechnicalSheetRow = { productId: string; quantity: number; product: { name: string; unit: string; archivedAt: Date | null } };

export function serializeTechnicalSheet(rows: TechnicalSheetRow[]) {
  return rows.map((row) => ({ productId: row.productId, name: row.product.name, unit: row.product.unit, quantity: row.quantity, archived: Boolean(row.product.archivedAt) }));
}

// Valida a ficha técnica recebida: materiais da clínica, sem repetição e quantidade válida para a unidade.
// Materiais arquivados só são aceitos se já estavam na ficha do procedimento.
export async function parseTechnicalSheet(clinicId: string, value: unknown, currentProductIds: string[] = []) {
  if (!Array.isArray(value)) return { error: "Ficha técnica inválida." } as const;
  const items = value.map((item) => ({ productId: String((item as { productId?: unknown })?.productId ?? ""), quantity: Number((item as { quantity?: unknown })?.quantity) }));
  if (new Set(items.map((item) => item.productId)).size !== items.length) return { error: "Um material aparece mais de uma vez na ficha técnica." } as const;
  const products = await prisma.product.findMany({ where: { clinicId, id: { in: items.map((item) => item.productId) } }, select: { id: true, name: true, unit: true, archivedAt: true } });
  for (const item of items) {
    const product = products.find((candidate) => candidate.id === item.productId);
    if (!product || (product.archivedAt && !currentProductIds.includes(product.id))) return { error: "Material da ficha técnica não encontrado." } as const;
    const quantityError = validateQuantity(item.quantity, product.unit);
    if (quantityError) return { error: `${product.name}: ${quantityError}` } as const;
  }
  const description = describeTechnicalSheet(items.map((item) => {
    const product = products.find((candidate) => candidate.id === item.productId)!;
    return { name: product.name, unit: product.unit, quantity: item.quantity };
  }));
  return { items, description } as const;
}

// Trava os lotes até o fim da transação, para duas saídas simultâneas não passarem do saldo.
export async function lockLots(tx: StockTransaction, lotIds: string[]) {
  const ids = [...new Set(lotIds)].sort();
  if (ids.length) await tx.$queryRaw`SELECT "id" FROM "StockLot" WHERE "id" = ANY(${ids}) FOR UPDATE`;
}
