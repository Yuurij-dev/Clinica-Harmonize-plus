export function quoteLaborCostCents({
  role,
  clinicLaborCostCents,
  professionalLaborCostCents,
}: {
  role: string;
  clinicLaborCostCents: number;
  professionalLaborCostCents: number | null;
}) {
  if (role === "PROFESSIONAL" && professionalLaborCostCents !== null) return professionalLaborCostCents;
  return clinicLaborCostCents;
}
