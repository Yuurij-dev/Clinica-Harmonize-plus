// Materiais da sessão a partir da ficha técnica (regras puras, sem banco). Importado direto pelo
// node:test, por isso não importa outros módulos .ts; o arredondamento de 3 casas repete o de stock-rules.ts.

export const MAX_SESSION_MATERIAL_QUANTITY = 10000; // mesmo limite de isMaterial na API da sessão
export const MAX_SESSION_MATERIALS = 40; // mesmo limite de validateSessionPayload

const scale = 1000;
const round = (value: number) => Math.round(value * scale) / scale;

export type SheetItem = { productId: string; name: string; kind: string; unit: string; quantity: number; archived?: boolean };
export type ProcedureSheet = { procedureId: string; items: SheetItem[] };
export type QuoteLine = { procedureId: string; quantity?: number };
export type SuggestedMaterial = { productId: string; name: string; kind: string; unit: string; quantity: number; procedureIds: string[] };

// Soma, por produto, a quantidade da ficha de cada procedimento do orçamento vezes a quantidade do item.
// Ignora produto arquivado, item sem ficha e quantidade inválida. Só `ml` aceita decimal (3 casas);
// nas demais unidades o total é arredondado PARA CIMA, para nunca sugerir menos do que a ficha pede.
// O total fica limitado a 10000. Ordem: materiais antes de produtos, depois nome (pt-BR) e id.
export function suggestSessionMaterials(sheets: ProcedureSheet[], lines: QuoteLine[]): SuggestedMaterial[] {
  const multipliers = new Map<string, number>();
  for (const line of lines) {
    const quantity = Number.isFinite(line.quantity) ? Math.max(1, Math.floor(Number(line.quantity))) : 1;
    multipliers.set(line.procedureId, (multipliers.get(line.procedureId) ?? 0) + quantity);
  }
  const totals = new Map<string, SuggestedMaterial>();
  for (const sheet of sheets) {
    const multiplier = multipliers.get(sheet.procedureId);
    if (!multiplier) continue;
    for (const item of sheet.items) {
      if (item.archived || !Number.isFinite(item.quantity) || item.quantity <= 0) continue;
      const current = totals.get(item.productId) ?? { productId: item.productId, name: item.name, kind: item.kind, unit: item.unit, quantity: 0, procedureIds: [] };
      current.quantity = round(current.quantity + item.quantity * multiplier);
      if (!current.procedureIds.includes(sheet.procedureId)) current.procedureIds.push(sheet.procedureId);
      totals.set(item.productId, current);
    }
  }
  const rank = (kind: string) => (kind === "material" ? 0 : 1);
  return [...totals.values()]
    .map((item) => {
      const quantity = item.unit === "ml" ? item.quantity : Math.ceil(item.quantity);
      return { ...item, quantity: Math.min(quantity, MAX_SESSION_MATERIAL_QUANTITY) };
    })
    .filter((item) => item.quantity > 0)
    .sort((left, right) => rank(left.kind) - rank(right.kind) || left.name.localeCompare(right.name, "pt-BR") || left.productId.localeCompare(right.productId))
    .slice(0, MAX_SESSION_MATERIALS);
}

export type LotOption = { id: string; code: string; expiresOn: string; balance: number };
export type LotAllocation = { lotId: string; quantity: number; code?: string; expiresOn?: string };

// Ajusta as alocações de lote de uma linha à nova quantidade. Ao reduzir, mantém os primeiros lotes.
// Ao aumentar, completa por validade (vence primeiro sai primeiro) com o saldo que sobra em cada lote,
// descontando o que a própria linha já usa. `missing` é o que não coube nos lotes (vira saída pendente).
export function adjustLotAllocations(allocations: LotAllocation[], quantity: number, lots: LotOption[]) {
  if (!Number.isFinite(quantity) || quantity <= 0) return { allocations: [] as LotAllocation[], missing: 0 };
  const target = round(quantity);
  const kept: LotAllocation[] = [];
  let remaining = target;
  for (const allocation of allocations) {
    const taken = Math.min(remaining, allocation.quantity);
    remaining = round(remaining - taken);
    if (taken > 0) kept.push({ ...allocation, quantity: round(taken) });
  }
  if (remaining > 0) {
    for (const lot of [...lots].filter((candidate) => candidate.balance > 0).sort((left, right) => left.expiresOn.localeCompare(right.expiresOn))) {
      if (remaining <= 0) break;
      const index = kept.findIndex((allocation) => allocation.lotId === lot.id);
      const free = round(lot.balance - (index >= 0 ? kept[index].quantity : 0));
      if (free <= 0) continue;
      const taken = Math.min(remaining, free);
      remaining = round(remaining - taken);
      if (index >= 0) kept[index] = { ...kept[index], quantity: round(kept[index].quantity + taken) };
      else kept.push({ lotId: lot.id, quantity: round(taken), code: lot.code, expiresOn: lot.expiresOn });
    }
  }
  return { allocations: kept, missing: remaining };
}

// Quanto da quantidade informada não está coberto pelas alocações de lote.
export function uncoveredQuantity(quantity: number, allocations: Array<{ quantity: number }>) {
  const missing = round(quantity - allocations.reduce((sum, allocation) => sum + allocation.quantity, 0));
  return missing > 0 ? missing : 0;
}
