import { invalidateClientCache } from "./client-cache.ts";

// A lista é explícita porque a invalidação casa a chave exata ou "chave?parâmetros", não prefixo de caminho.
export const financeCacheKeys = ["/api/finance/summary", "/api/finance/flow", "/api/finance/movements", "/api/finance/accounts", "/api/expenses", "/api/recurring-expenses"];

export function invalidateFinanceCache() {
  invalidateClientCache(...financeCacheKeys);
}

// Pagamento (receita) criado, recebido, editado ou excluído: lista de /pagamentos, painel, financeiro e a aba do paciente.
export function invalidatePaymentCache(patientId?: string | null) {
  invalidateClientCache("/api/payments", "/api/dashboard/bootstrap", ...financeCacheKeys, ...(patientId ? [`/api/patients/${encodeURIComponent(patientId)}/history`, `/api/patients/${encodeURIComponent(patientId)}/profile`] : []));
}

// Despesa fixa alterada: financeiro inteiro, a lista e o histórico dela (quando o id é conhecido).
export function invalidateRecurringCache(id?: string) {
  invalidateClientCache(...financeCacheKeys, ...(id ? [`/api/recurring-expenses/${encodeURIComponent(id)}`] : []));
}
