import type { StockKind } from "@/lib/stock-rules";
import { invalidateClientCache } from "@/lib/client-cache";

export type StockMaterial = {
  id: string;
  name: string;
  kind: StockKind;
  unit: string;
  costCents: number;
  supplier: string;
  minStock: number;
  archivedAt: string | null;
  balance: number;
  belowMinimum: boolean;
  hasMovements: boolean;
};

// Chaves de cache afetadas por qualquer mudança de material ou saldo.
export function invalidateStockCache(productId?: string) {
  invalidateClientCache("/api/products", ...(productId ? [`/api/products/${productId}`, `/api/products/${productId}/movements`] : []), "/api/quotes/options", "/api/stock/alerts", "/api/stock/pending");
}

export function formatDateOnly(value: string) {
  return value.split("-").reverse().join("/");
}
