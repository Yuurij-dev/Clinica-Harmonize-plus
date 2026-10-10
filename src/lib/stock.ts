import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { clinicToday, dateOnly } from "./clinic-time";
import { lotBalance, lotStatus, materialBalance } from "./stock-rules";

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
