export type QuoteLineInput = { procedureId: string; quantity: number; discountCents: number };
export type QuotePriceSource = { id: string; name: string; priceCents: number };

export function formatMoneyInput(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function parseMoneyInput(value: string) {
  const input = value.trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (!input) return 0;
  let whole = input;
  let fraction = "";
  if (input.includes(",")) {
    const parts = input.split(",");
    if (parts.length !== 2 || !/^\d{0,2}$/.test(parts[1]) || !/^[\d.]+$/.test(parts[0])) return null;
    whole = parts[0].replace(/\./g, "");
    fraction = parts[1];
  } else if (/^\d+\.\d{0,2}$/.test(input)) {
    [whole, fraction] = input.split(".");
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(input)) {
    whole = input.replace(/\./g, "");
  } else if (!/^\d+$/.test(input)) {
    return null;
  }
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0") || 0);
  return Number.isSafeInteger(cents) ? cents : null;
}

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
