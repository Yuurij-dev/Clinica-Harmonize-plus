// Formatação de dados de respostas conforme o plano (puro). Clínica sem o recurso NÃO recebe o dado (nem zerado): omitir é
// diferente de mostrar R$ 0,00. Os registros continuam no banco (downgrade nunca apaga) e voltam se o plano voltar.

// Remove o retrato de custos de Quote.details (string JSON): costs e costTotalCents. Entrada inválida passa como veio.
export function stripQuoteCosts(details: unknown): unknown {
  if (typeof details !== "string" || !details.includes("cost")) return details;
  try {
    const parsed: unknown = JSON.parse(details);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return details;
    const { costs: _costs, costTotalCents: _costTotal, ...rest } = parsed as Record<string, unknown>;
    return JSON.stringify(rest);
  } catch {
    return details;
  }
}

// Retrato de custos já gravado em Quote.details (orçamento criado com o recurso `costs`), ou null se não houver/for inválido.
// Usado no servidor para PRESERVAR o histórico quando a clínica edita o orçamento sem o recurso (nunca recalcula como zero).
export function storedQuoteCosts(details: unknown): { laborCents: number; facilityCents: number; medicationCents: number } | null {
  if (typeof details !== "string" || !details.includes("costs")) return null;
  try {
    const costs = (JSON.parse(details) as { costs?: Record<string, unknown> } | null)?.costs;
    if (!costs || typeof costs !== "object") return null;
    const { laborCents, facilityCents, medicationCents } = costs as Record<string, unknown>;
    const valid = [laborCents, facilityCents, medicationCents].every((value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
    return valid ? { laborCents, facilityCents, medicationCents } as { laborCents: number; facilityCents: number; medicationCents: number } : null;
  } catch {
    return null;
  }
}

// Orçamento calculado SEM o recurso `costs` e sem retrato histórico: não grava costTotalCents (nem zerado), para não virar
// "custo R$ 0,00" falso depois de um upgrade. O total já é subtotal − desconto.
export function quoteWithoutCostFields<T extends { costTotalCents?: number }>(calculated: T): Omit<T, "costTotalCents"> {
  const { costTotalCents: _costTotal, ...rest } = calculated;
  return rest;
}

// Aplica stripQuoteCosts a um orçamento serializado quando a clínica não tem o recurso `costs`.
export function quoteForPlan<T extends { details?: unknown }>(quote: T, canSeeCosts: boolean): T {
  return canSeeCosts || quote.details === undefined ? quote : { ...quote, details: stripQuoteCosts(quote.details) };
}
