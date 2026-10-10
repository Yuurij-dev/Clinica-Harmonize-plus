// Regras de estoque puras (sem banco). Importadas direto pelo node:test,
// por isso não usam o atalho "@/" nem sintaxe que exija compilação.

export const stockUnits = ["ml", "unidade", "frasco"] as const;
export type StockUnit = (typeof stockUnits)[number];
export type LotStatus = "valid" | "expiring" | "expired";

const quantityScale = 1000;
const dayMs = 86_400_000;

export function roundQuantity(value: number) {
  return Math.round(value * quantityScale) / quantityScale;
}

export function lotBalance(movements: Array<{ quantity: number }>) {
  return roundQuantity(movements.reduce((sum, movement) => sum + Math.round(movement.quantity * quantityScale), 0) / quantityScale);
}

export function materialBalance(lots: Array<{ balance: number }>, minStock: number) {
  const balance = lotBalance(lots.map((lot) => ({ quantity: lot.balance })));
  return { balance, belowMinimum: balance < minStock };
}

// Datas no formato YYYY-MM-DD, já no fuso da clínica.
export function daysUntil(date: string, today: string) {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / dayMs);
}

// O lote vale até o dia da validade, inclusive.
export function lotStatus(expiresOn: string, today: string, warningDays: number): LotStatus {
  const days = daysUntil(expiresOn, today);
  if (days < 0) return "expired";
  return days <= warningDays ? "expiring" : "valid";
}

export function isStockUnit(value: unknown): value is StockUnit {
  return typeof value === "string" && (stockUnits as readonly string[]).includes(value);
}

// Lê quantidades digitadas no formato brasileiro ("1.000,25").
export function parseQuantity(text: string) {
  const normalized = text.trim().replace(/\./g, "").replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN;
}

function formatNumber(quantity: number) {
  return roundQuantity(quantity).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

export function formatQuantity(quantity: number, unit: string) {
  const value = formatNumber(quantity);
  if (unit === "unidade") return `${value} un`;
  if (unit === "frasco") return `${value} ${Math.abs(quantity) === 1 ? "frasco" : "frascos"}`;
  return `${value} ${unit}`;
}

export type StockAlert = { kind: "expired" | "expiring" | "below_minimum" | "pending"; productId: string; lotId?: string; message: string };

// Avisos de estoque: lotes vencidos ou vencendo (com saldo) e materiais abaixo do mínimo.
// Recebe só materiais e lotes ativos (não arquivados). Ordem: vencidos, vencendo, mínimo.
export function stockAlerts(input: {
  materials: Array<{ id: string; name: string; unit: string; balance: number; minStock: number }>;
  lots: Array<{ id: string; productId: string; productName: string; code: string; expiresOn: string; balance: number }>;
  today: string;
  warningDays: number;
}) {
  const lotAlerts: StockAlert[] = input.lots
    .filter((lot) => lot.balance > 0 && lotStatus(lot.expiresOn, input.today, input.warningDays) !== "valid")
    .sort((left, right) => left.expiresOn.localeCompare(right.expiresOn))
    .map((lot) => {
      const days = daysUntil(lot.expiresOn, input.today);
      const prefix = `Lote ${lot.code} de ${lot.productName}`;
      if (days < 0) return { kind: "expired", productId: lot.productId, lotId: lot.id, message: `${prefix} venceu em ${lot.expiresOn.split("-").reverse().join("/")}` };
      return { kind: "expiring", productId: lot.productId, lotId: lot.id, message: days === 0 ? `${prefix} vence hoje` : `${prefix} vence em ${days} ${days === 1 ? "dia" : "dias"}` };
    });
  const minimumAlerts: StockAlert[] = input.materials
    .filter((material) => material.balance < material.minStock)
    .map((material) => ({ kind: "below_minimum", productId: material.id, message: `${material.name} abaixo do mínimo (${formatNumber(material.balance)} de ${formatQuantity(material.minStock, material.unit)})` }));
  return [...lotAlerts, ...minimumAlerts];
}

export const manualReasons = {
  loss: "Perda/quebra",
  expired: "Vencimento",
  internal_use: "Uso interno/amostra",
  count: "Correção de contagem",
} as const;
export type ManualReason = keyof typeof manualReasons;

// Saída manual: observação obrigatória e nunca mais que o saldo do lote.
// A correção de contagem pode somar (direction "in") ou tirar do saldo.
export function manualMovement(input: { reason: string; direction?: "in" | "out"; quantity: number; unit: string; lotBalance: number; notes: string }) {
  if (!(input.reason in manualReasons)) return { error: "Motivo inválido." };
  if (!input.notes.trim()) return { error: "A observação é obrigatória." };
  const quantityError = validateQuantity(input.quantity, input.unit);
  if (quantityError) return { error: quantityError };
  const adds = input.reason === "count" && input.direction === "in";
  if (!adds && input.quantity > input.lotBalance) return { error: `A saída é maior que o saldo do lote (${formatQuantity(input.lotBalance, input.unit)}).` };
  return { type: input.reason === "count" ? "count_adjustment" : "manual_out", quantity: adds ? input.quantity : -input.quantity };
}

export function normalizeName(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
}

// Converte o texto livre antigo ("Toxina botulínica, Agulha") em itens de ficha técnica,
// comparando nomes sem acento e sem diferença de maiúsculas. Quantidade inicial 1, para revisão.
export function convertMaterialsText(text: string, products: Array<{ id: string; name: string }>) {
  const names = text.split(",").map(normalizeName).filter(Boolean);
  const items: Array<{ productId: string; quantity: number }> = [];
  for (const name of names) {
    const product = products.find((candidate) => normalizeName(candidate.name) === name);
    if (product && !items.some((item) => item.productId === product.id)) items.push({ productId: product.id, quantity: 1 });
  }
  return items;
}

export function describeTechnicalSheet(items: Array<{ name: string; unit: string; quantity: number }>) {
  return items.map((item) => `${formatQuantity(item.quantity, item.unit)} ${item.name}`).join(", ");
}

export function validateQuantity(quantity: number, unit: string) {
  if (!Number.isFinite(quantity) || quantity <= 0) return "A quantidade deve ser maior que zero.";
  if (unit !== "ml" && !Number.isInteger(quantity)) return `Use um número inteiro para ${unit}.`;
  if (roundQuantity(quantity) !== quantity) return "Use no máximo 3 casas decimais.";
  return null;
}
