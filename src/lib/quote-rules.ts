export type QuoteLineInput = { procedureId: string; quantity: number; discountCents: number };
export type QuotePriceSource = { id: string; name: string; priceCents: number };

export function calculateQuote(lines: QuoteLineInput[], catalog: QuotePriceSource[], costs: { laborCents: number; facilityCents: number; medicationCents: number }) {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 50) return null;
  const items = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const procedure = catalog.find((item) => item.id === line.procedureId);
    if (!procedure || !Number.isSafeInteger(procedure.priceCents) || procedure.priceCents < 0 || seen.has(line.procedureId) || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 50 || !Number.isInteger(line.discountCents) || line.discountCents < 0) return null;
    seen.add(line.procedureId);
    const subtotalCents = procedure.priceCents * line.quantity;
    if (!Number.isSafeInteger(subtotalCents) || line.discountCents > subtotalCents) return null;
    items.push({ procedureId: procedure.id, name: procedure.name, quantity: line.quantity, unitPriceCents: procedure.priceCents, discountCents: line.discountCents, subtotalCents: subtotalCents - line.discountCents });
  }
  const subtotalCents = items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  const discountCents = items.reduce((sum, item) => sum + item.discountCents, 0);
  if (![costs.laborCents, costs.facilityCents, costs.medicationCents].every((cost) => Number.isSafeInteger(cost) && cost >= 0)) return null;
  const costTotalCents = costs.laborCents + costs.facilityCents + costs.medicationCents;
  const totalCents = subtotalCents - discountCents + costTotalCents;
  if (![subtotalCents, discountCents, costTotalCents, totalCents].every(Number.isSafeInteger) || totalCents < 0) return null;
  return { items, subtotalCents, discountCents, costTotalCents, totalCents };
}
