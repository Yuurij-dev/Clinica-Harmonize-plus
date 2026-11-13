// Regras puras do relatório de Estoque (sem banco): posição atual, movimentações do período e consumo com custo
// desconhecido ≠ 0. Importado direto pelo node:test. Saldo e situação do lote vêm de stock-rules.ts (lotStatus/roundQuantity).
// Custo: Product.costCents = 0 significa "sem custo cadastrado" (desconhecido), nunca R$ 0,00.
import { lotStatus, manualReasons, roundQuantity, type ManualReason } from "./stock-rules.ts";

export type StockSituation = "ok" | "below_minimum" | "out_of_stock";

export const stockSituationLabels: Record<StockSituation, string> = { ok: "Normal", below_minimum: "Abaixo do mínimo", out_of_stock: "Sem estoque" };

// Custo unitário conhecido (centavos) ou null.
export const knownCost = (costCents: number | null | undefined) => (typeof costCents === "number" && costCents > 0 ? costCents : null);

// ---------- Posição atual ----------

export type PositionProduct = { id: string; name: string; kind: string; unit: string; costCents: number; minStock: number; archived: boolean };
export type PositionLot = { productId: string; expiresOn: string; balance: number };

export type PositionItem = {
  productId: string;
  name: string;
  kind: string;
  unit: string;
  balance: number;
  minStock: number;
  situation: StockSituation;
  unitCostCents: number | null;
  valueCents: number | null;
  nextExpiry: string | null;
  expiredLots: number;
  expiringLots: number;
};

export function stockSituation(balance: number, minStock: number): StockSituation {
  if (balance <= 0) return "out_of_stock";
  return balance < minStock ? "below_minimum" : "ok";
}

// Itens ativos com saldo (soma dos lotes), situação, valor em estoque e validades. Arquivados ficam fora; os que ainda têm saldo são contados.
export function stockPosition(input: { products: PositionProduct[]; lots: PositionLot[]; today: string; warningDays: number }) {
  const lotsByProduct = new Map<string, PositionLot[]>();
  for (const lot of input.lots) lotsByProduct.set(lot.productId, [...(lotsByProduct.get(lot.productId) ?? []), lot]);
  const items: PositionItem[] = [];
  let archivedWithBalance = 0;
  for (const product of input.products) {
    const lots = lotsByProduct.get(product.id) ?? [];
    const balance = roundQuantity(lots.reduce((sum, lot) => sum + lot.balance, 0));
    if (product.archived) {
      if (balance > 0) archivedWithBalance += 1;
      continue;
    }
    const withBalance = lots.filter((lot) => lot.balance > 0);
    const cost = knownCost(product.costCents);
    let expiredLots = 0;
    let expiringLots = 0;
    for (const lot of withBalance) {
      const status = lotStatus(lot.expiresOn, input.today, input.warningDays);
      if (status === "expired") expiredLots += 1;
      else if (status === "expiring") expiringLots += 1;
    }
    items.push({
      productId: product.id,
      name: product.name,
      kind: product.kind,
      unit: product.unit,
      balance,
      minStock: product.minStock,
      situation: stockSituation(balance, product.minStock),
      unitCostCents: cost,
      valueCents: cost === null ? null : Math.round(Math.max(balance, 0) * cost),
      nextExpiry: withBalance.length > 0 ? withBalance.map((lot) => lot.expiresOn).sort()[0] : null,
      expiredLots,
      expiringLots,
    });
  }
  items.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const withStock = items.filter((item) => item.balance > 0);
  const withoutCost = withStock.filter((item) => item.unitCostCents === null);
  const valued = withStock.filter((item) => item.valueCents !== null);
  return {
    items,
    archivedWithBalance,
    summary: {
      items: items.length,
      belowMinimum: items.filter((item) => item.situation === "below_minimum").length,
      outOfStock: items.filter((item) => item.situation === "out_of_stock").length,
      expiredLots: items.reduce((sum, item) => sum + item.expiredLots, 0),
      expiringLots: items.reduce((sum, item) => sum + item.expiringLots, 0),
      // null = nenhum item com saldo tem custo (desconhecido), 0 só quando nada tem saldo.
      totalValueCents: valued.length > 0 ? valued.reduce((sum, item) => sum + (item.valueCents ?? 0), 0) : withStock.length === 0 ? 0 : null,
      itemsWithoutCost: withoutCost.length,
    },
  };
}

// ---------- Movimentações do período ----------

export const movementTypeLabels: Record<string, string> = {
  initial: "Entrada inicial",
  purchase: "Compra",
  attendance: "Consumo em atendimento",
  manual_out: "Saída manual",
  count_adjustment: "Ajuste de contagem",
  reversal: "Estorno",
  purchase_cancel: "Cancelamento de compra",
};

// "reversal" com reversesId estorna uma movimentação; sem reversesId desfaz o cancelamento de uma compra.
export function movementTypeLabel(type: string, reversesId: string | null = null) {
  if (type === "reversal" && !reversesId) return "Cancelamento de compra desfeito";
  return movementTypeLabels[type] ?? type;
}

// Grupo agregado no banco: tipo + sinal por item. Estornos (originais estornados e seus estornos) ficam fora dos totais.
export type MovementGroup = { productId: string; type: string; sign: "in" | "out"; quantity: number; count: number };
export type MovementProduct = { id: string; name: string; unit: string; kind: string; costCents: number };

// Os grupos dos totais já excluem estornos de movimentação (reversesId): "reversal" que sobra desfaz um cancelamento de compra.
export function groupLabel(type: string, sign: "in" | "out") {
  if (type === "reversal") return movementTypeLabel(type, null);
  const base = movementTypeLabels[type] ?? type;
  return type === "count_adjustment" ? `${base} (${sign === "in" ? "+" : "−"})` : base;
}

const typeOrder = ["initial", "purchase", "count_adjustment", "reversal", "attendance", "manual_out", "purchase_cancel"];

export function summarizeMovements(groups: MovementGroup[], products: Map<string, MovementProduct>) {
  type TypeAcc = { type: string; sign: "in" | "out"; label: string; movements: number; costCents: number; withCost: number; missingCost: number };
  const byType = new Map<string, TypeAcc>();
  type ItemAcc = { productId: string; name: string; unit: string; kind: string; inQuantity: number; outQuantity: number; movements: number };
  const byItem = new Map<string, ItemAcc>();
  for (const group of groups) {
    const product = products.get(group.productId);
    if (!product) continue; // produto de outra clínica ou removido: nunca entra
    const quantity = Math.abs(group.quantity);
    const cost = knownCost(product.costCents);
    const key = `${group.type}:${group.sign}`;
    const acc = byType.get(key) ?? { type: group.type, sign: group.sign, label: groupLabel(group.type, group.sign), movements: 0, costCents: 0, withCost: 0, missingCost: 0 };
    acc.movements += group.count;
    if (cost === null) acc.missingCost += group.count;
    else {
      acc.withCost += group.count;
      acc.costCents += quantity * cost;
    }
    byType.set(key, acc);
    const item = byItem.get(group.productId) ?? { productId: group.productId, name: product.name, unit: product.unit, kind: product.kind, inQuantity: 0, outQuantity: 0, movements: 0 };
    if (group.sign === "in") item.inQuantity += quantity;
    else item.outQuantity += quantity;
    item.movements += group.count;
    byItem.set(group.productId, item);
  }
  const types = [...byType.values()]
    .map((entry) => ({ ...entry, costCents: entry.withCost > 0 ? Math.round(entry.costCents) : null }))
    .sort((a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type) || (a.sign === "in" ? -1 : 1));
  // Sem movimentos do sentido = 0 real (R$ 0,00); null só quando há movimentos e nenhum item tem custo cadastrado.
  const sumCost = (list: typeof types) => {
    if (list.length === 0) return 0;
    const known = list.filter((entry) => entry.costCents !== null);
    return known.length > 0 ? known.reduce((sum, entry) => sum + (entry.costCents ?? 0), 0) : null;
  };
  const entries = types.filter((entry) => entry.sign === "in");
  const exits = types.filter((entry) => entry.sign === "out");
  const items = [...byItem.values()]
    .map((entry) => ({ ...entry, inQuantity: roundQuantity(entry.inQuantity), outQuantity: roundQuantity(entry.outQuantity), netQuantity: roundQuantity(entry.inQuantity - entry.outQuantity) }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return {
    types,
    items,
    totals: {
      entryMovements: entries.reduce((sum, entry) => sum + entry.movements, 0),
      exitMovements: exits.reduce((sum, entry) => sum + entry.movements, 0),
      entryCostCents: sumCost(entries),
      exitCostCents: sumCost(exits),
      movementsWithoutCost: types.reduce((sum, entry) => sum + entry.missingCost, 0),
    },
  };
}

// Texto da coluna "motivo" do histórico. PRIVACIDADE: nunca exporta texto livre (notes/reason digitados pela equipe podem
// citar paciente). Atendimento = nome do procedimento; saída manual = rótulo da lista fixa (manualReasons) quando o motivo
// é um deles (também no ajuste de contagem); estorno = só "Estorno"; demais tipos = vazio (o tipo já aparece na coluna Tipo).
export function movementNote(input: { type: string; reason: string | null; attendanceName: string | null }) {
  if (input.type === "attendance") return (input.attendanceName ?? "").slice(0, 200);
  if (input.type === "reversal") return "Estorno";
  if ((input.type === "manual_out" || input.type === "count_adjustment") && input.reason && Object.prototype.hasOwnProperty.call(manualReasons, input.reason)) return manualReasons[input.reason as ManualReason];
  return "";
}

// ---------- Consumo ----------

export type ConsumptionGroup = { productId: string; quantity: number }; // saída de atendimento válida (quantidade positiva)
export type ConsumptionRow = { productId: string; quantity: number; procedure: string };

export function consumptionByProduct(groups: ConsumptionGroup[], products: Map<string, MovementProduct>) {
  return groups
    .flatMap((group) => {
      const product = products.get(group.productId);
      if (!product) return [];
      const cost = knownCost(product.costCents);
      const quantity = roundQuantity(Math.abs(group.quantity));
      return [{ name: product.name, unit: product.unit, quantity, estimatedCostCents: cost === null ? null : Math.round(quantity * cost) }];
    })
    .sort((a, b) => (b.estimatedCostCents ?? -1) - (a.estimatedCostCents ?? -1) || a.name.localeCompare(b.name, "pt-BR"));
}

// Por procedimento: custo conhecido somado; movimentos de itens sem custo contados à parte (custo parcial ou desconhecido).
export function consumptionByProcedure(rows: ConsumptionRow[], products: Map<string, MovementProduct>) {
  const map = new Map<string, { name: string; movements: number; costCents: number; withCost: number; missingCost: number }>();
  for (const row of rows) {
    const product = products.get(row.productId);
    if (!product) continue;
    const cost = knownCost(product.costCents);
    const entry = map.get(row.procedure) ?? { name: row.procedure, movements: 0, costCents: 0, withCost: 0, missingCost: 0 };
    entry.movements += 1;
    if (cost === null) entry.missingCost += 1;
    else {
      entry.withCost += 1;
      entry.costCents += Math.abs(row.quantity) * cost;
    }
    map.set(row.procedure, entry);
  }
  return [...map.values()]
    .map((entry) => ({ name: entry.name, movements: entry.movements, estimatedCostCents: entry.withCost > 0 ? Math.round(entry.costCents) : null, missingCostMovements: entry.missingCost }))
    .sort((a, b) => (b.estimatedCostCents ?? -1) - (a.estimatedCostCents ?? -1) || a.name.localeCompare(b.name, "pt-BR"));
}
