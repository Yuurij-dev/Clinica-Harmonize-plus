import type { SectionId } from "../types/clinic";

// Destinos fixos da barra inferior quando o papel enxerga mais seções do que cabem nela.
export const mobilePrimarySections: SectionId[] = ["agenda", "clientes", "orcamentos", "pagamentos"];

export type QuickCreate = "appointment" | "client" | "quote" | "payment";

// Criações rápidas do botão "+" e a seção em que cada uma abre (mesmos destinos de openCreate).
export const quickCreateTargets: Array<{ id: QuickCreate; label: string; section: SectionId }> = [
  { id: "appointment", label: "Novo agendamento", section: "agenda" },
  { id: "client", label: "Novo cliente", section: "clientes" },
  { id: "quote", label: "Novo orçamento", section: "orcamentos" },
  { id: "payment", label: "Registrar pagamento", section: "pagamentos" },
];

/** Divide as seções permitidas entre a barra inferior e a folha "Mais". Deriva de visibleSections; não repete regra de permissão. */
export function splitMobileSections(allowed: SectionId[]) {
  const bar = allowed.length > mobilePrimarySections.length ? mobilePrimarySections.filter((section) => allowed.includes(section)) : allowed;
  return { bar, more: allowed.filter((section) => !bar.includes(section)) };
}

export function quickCreateFor(allowed: SectionId[]) {
  return quickCreateTargets.filter((target) => allowed.includes(target.section));
}
