import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Jornada ativa pedida, ou a ativa mais antiga. Sem nenhuma, cria a primeira e passa para ela os registros sem jornada.
export async function ensurePatientJourney(patientId: string, clinicId: string, requestedJourneyId?: string | null, tx?: Prisma.TransactionClient) {
  const db = tx ?? prisma;
  if (requestedJourneyId) {
    const requested = await db.patientJourney.findFirst({
      where: { id: requestedJourneyId, patientId, clinicId, archivedAt: null },
    });
    if (requested) return requested;
  }

  const existing = await db.patientJourney.findFirst({
    where: { patientId, clinicId, archivedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;

  // Com `tx` (chamador já dentro de transação, ex.: sob advisory lock) reaproveita a conexão em vez de abrir outra.
  const create = async (transaction: Prisma.TransactionClient) => {
    // Dois pedidos simultâneos de um paciente sem jornada: o segundo espera a trava e reaproveita a jornada do primeiro.
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`patient-journey:${patientId}`}))`;
    const created = await transaction.patientJourney.findFirst({ where: { patientId, clinicId, archivedAt: null }, orderBy: { createdAt: "asc" } });
    if (created) return created;
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
  };
  return tx ? create(tx) : prisma.$transaction(create);
}
