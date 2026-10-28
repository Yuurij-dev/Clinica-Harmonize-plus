import { prisma } from "@/lib/prisma";
import { toCents } from "@/lib/finance";
import { quoteLaborCostCents } from "@/lib/quote-cost-rules";

export async function quoteCostSnapshot(clinicId: string, userId: string, role: string) {
  const membershipRequest = role === "PROFESSIONAL"
    ? prisma.clinicMembership.findFirst({
      where: { clinicId, userId, role: "PROFESSIONAL" },
      select: { laborCostCents: true },
    })
    : Promise.resolve(null);

  const [clinic, membership] = await Promise.all([
    prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { laborCost: true, facilityCost: true, medicationCost: true },
    }),
    membershipRequest,
  ]);

  const laborCents = quoteLaborCostCents({
    role,
    clinicLaborCostCents: toCents(clinic?.laborCost ?? 0),
    professionalLaborCostCents: membership?.laborCostCents ?? null,
  });

  return {
    laborCents,
    facilityCents: toCents(clinic?.facilityCost ?? 0),
    medicationCents: toCents(clinic?.medicationCost ?? 0),
  };
}
