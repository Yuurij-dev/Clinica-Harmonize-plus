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

export function formatQuantity(quantity: number, unit: string) {
  const value = roundQuantity(quantity).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  if (unit === "unidade") return `${value} un`;
  if (unit === "frasco") return `${value} ${Math.abs(quantity) === 1 ? "frasco" : "frascos"}`;
  return `${value} ${unit}`;
}

export function validateQuantity(quantity: number, unit: string) {
  if (!Number.isFinite(quantity) || quantity <= 0) return "A quantidade deve ser maior que zero.";
  if (unit !== "ml" && !Number.isInteger(quantity)) return `Use um número inteiro para ${unit}.`;
  if (roundQuantity(quantity) !== quantity) return "Use no máximo 3 casas decimais.";
  return null;
}
