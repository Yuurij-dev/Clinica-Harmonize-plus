// Escolhe qual membership a sessão representa. `memberships` vem ordenada por id asc.
// activeClinicId null, de clínica que saiu/foi apagada ou desconhecida cai na primeira (comportamento anterior).
export function pickMembership<T extends { clinic: { id: string } }>(memberships: T[], activeClinicId: string | null | undefined): T | undefined {
  if (activeClinicId) {
    const active = memberships.find((membership) => membership.clinic.id === activeClinicId);
    if (active) return active;
  }
  return memberships[0];
}
