import { clinicToday, dateOnly } from "./clinic-time";
import { prisma } from "./prisma";
import { lotBalances, technicalSheetSelect } from "./stock";
import { allocateLots } from "./stock-rules";
import { suggestSessionMaterials, type QuoteLine } from "./session-materials-rules";

type DraftSession = { id: string; status: string; materials: string; materialsSeededAt: Date | null };

// Preenche UMA vez os materiais do rascunho com a ficha técnica atual dos procedimentos do orçamento
// (quantidade da ficha x quantidade do item) e sugere os lotes por validade. Só age em rascunho vazio
// ainda não semeado; depois disso o profissional é o dono da lista (mesmo que remova tudo).
// Não mexe no estoque: a baixa continua só na finalização. Falha aqui nunca impede a sessão.
// Roda DEPOIS do commit da criação (fora da transação): um erro SQL aqui não pode abortar a criação.
// O updateMany condicional garante que só uma chamada semeia; quem perde relê a sessão já semeada.
export async function seedDraftMaterials<T extends DraftSession>(input: { clinicId: string; session: T; lines: QuoteLine[] }): Promise<T> {
  const { clinicId, session, lines } = input;
  const tx = prisma;
  if (session.status !== "Rascunho" || session.materialsSeededAt || !isEmptyList(session.materials)) return session;
  try {
    const procedureIds = [...new Set(lines.map((line) => line.procedureId).filter(Boolean))];
    const procedures = procedureIds.length ? await tx.procedure.findMany({ where: { clinicId, id: { in: procedureIds } }, select: { id: true, ...technicalSheetSelect } }) : [];
    const suggestions = suggestSessionMaterials(
      procedures.map((procedure) => ({ procedureId: procedure.id, items: procedure.technicalSheet.map((row) => ({ productId: row.productId, name: row.product.name, kind: row.product.kind, unit: row.product.unit, quantity: row.quantity, archived: Boolean(row.product.archivedAt) })) })),
      lines,
    );
    let materials = "[]";
    if (suggestions.length) {
      const today = clinicToday();
      const lots = await tx.stockLot.findMany({ where: { clinicId, productId: { in: suggestions.map((item) => item.productId) }, expiresOn: { gte: new Date(`${today}T00:00:00Z`) } }, select: { id: true, productId: true, code: true, expiresOn: true } });
      const balances = await lotBalances(clinicId, { lotId: { in: lots.map((lot) => lot.id) } }, tx);
      materials = JSON.stringify(suggestions.map((item) => {
        const productLots = lots.filter((lot) => lot.productId === item.productId).map((lot) => ({ ...lot, expiresOn: dateOnly(lot.expiresOn), balance: balances.get(lot.id) ?? 0 }));
        const { allocations } = allocateLots(item.quantity, productLots, today);
        return {
          productId: item.productId, name: item.name, unit: item.unit, quantity: item.quantity,
          allocations: allocations.map((allocation) => {
            const lot = productLots.find((candidate) => candidate.id === allocation.lotId)!;
            return { lotId: lot.id, code: lot.code, expiresOn: lot.expiresOn, quantity: allocation.quantity, availableAtSave: lot.balance };
          }),
        };
      }));
    }
    const seededAt = new Date();
    const claimed = await tx.patientProcedureSession.updateMany({ where: { id: session.id, clinicId, status: "Rascunho", materialsSeededAt: null, materials: "[]" }, data: { materials, materialsSeededAt: seededAt } });
    if (claimed.count) return { ...session, materials, materialsSeededAt: seededAt };
    return (await prisma.patientProcedureSession.findFirst({ where: { id: session.id, clinicId } })) as T | null ?? session;
  } catch (error) {
    console.error("Não foi possível preencher os materiais da sessão pela ficha técnica.", error);
    return session;
  }
}

function isEmptyList(value: string) {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) && parsed.length === 0; } catch { return false; }
}
