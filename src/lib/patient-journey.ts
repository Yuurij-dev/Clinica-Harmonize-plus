import { prisma } from "@/lib/prisma";

export async function ensurePatientJourney(patientId: string, clinicId: string, requestedJourneyId?: string | null) {
  if (requestedJourneyId) {
    const requested = await prisma.patientJourney.findFirst({
      where: { id: requestedJourneyId, patientId, clinicId },
    });
    if (requested) return requested;
  }

  const existing = await prisma.patientJourney.findFirst({
    where: { patientId, clinicId },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;

  return prisma.$transaction(async (transaction) => {
    const journey = await transaction.patientJourney.create({
      data: { patientId, clinicId, name: "Jornada 1" },
    });
    await Promise.all([
      transaction.appointment.updateMany({ where: { patientId, clinicId, journeyId: null }, data: { journeyId: journey.id } }),
      transaction.patientProcedure.updateMany({ where: { patientId, clinicId, journeyId: null }, data: { journeyId: journey.id } }),
      transaction.evaluation.updateMany({ where: { patientId, clinicId, journeyId: null }, data: { journeyId: journey.id } }),
      transaction.quote.updateMany({ where: { patientId, clinicId, journeyId: null }, data: { journeyId: journey.id } }),
      transaction.payment.updateMany({ where: { patientId, clinicId, journeyId: null }, data: { journeyId: journey.id } }),
    ]);
    return journey;
  });
}
