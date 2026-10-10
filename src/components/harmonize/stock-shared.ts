import { invalidateClientCache } from "@/lib/client-cache";

export type StockMaterial = {
  id: string;
  name: string;
  category: string;
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
  invalidateClientCache("/api/products", ...(productId ? [`/api/products/${productId}`, `/api/products/${productId}/movements`] : []), "/api/quotes/options", "/api/stock/alerts");
}

export function formatDateOnly(value: string) {
  return value.split("-").reverse().join("/");
}
