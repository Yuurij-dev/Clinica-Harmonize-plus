import { toCents } from "./finance";
import { prisma } from "./prisma";
import { calculateQuote, type QuoteLineInput } from "./quote-rules";

export const quotePaymentMethods = ["Cartão de crédito", "Cartão de débito", "Pix", "Dinheiro", "Boleto", "Transferência"];

// Calcula o orçamento com os preços atuais da clínica e guarda junto o retrato dos custos; null se as linhas forem inválidas.
// Mesmo cálculo na criação e na edição: o JSON salvo em Quote.details é { ...calculado, costs }.
export async function quoteDetails(lines: QuoteLineInput[], clinicId: string) {
  const procedures = await prisma.procedure.findMany({ where: { clinicId }, select: { id: true, name: true, price: true } });
  const costs = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { laborCost: true, facilityCost: true, medicationCost: true } });
  const costSnapshot = { laborCents: toCents(costs?.laborCost ?? 0), facilityCents: toCents(costs?.facilityCost ?? 0), medicationCents: toCents(costs?.medicationCost ?? 0) };
  const calculated = calculateQuote(lines, procedures.map((procedure) => ({ id: procedure.id, name: procedure.name, priceCents: toCents(procedure.price) })), costSnapshot);
  return calculated ? { ...calculated, costs: costSnapshot } : null;
}
