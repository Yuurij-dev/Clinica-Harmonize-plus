import { prisma } from "./prisma";
import type { SetupSnapshot } from "./setup-rules";

export type SetupSnapshotData = SetupSnapshot & {
  appointmentNotificationsEnabled: boolean;
  appointmentNotificationSoundEnabled: boolean;
  stockNotificationsEnabled: boolean;
  expiryWarningDays: number;
  /** Convites por e-mail ainda pendentes: informativo, não conclui a etapa de equipe. */
  pendingInvitations: number;
};

/**
 * Contagens da clínica para o assistente de configuração. Tudo escopado por `clinicId` (o da sessão), só `count` e
 * uma linha da clínica: nada de listas. Profissional = vínculo com cargo PROFESSIONAL; material/produto = ativo (não arquivado).
 */
export async function loadSetupSnapshot(clinicId: string): Promise<SetupSnapshotData | null> {
  const [clinic, professionalCount, procedureCount, materialCount, productCount, recurringExpenseCount, pendingInvitations] = await Promise.all([
    prisma.clinic.findUnique({
      where: { id: clinicId },
      select: {
        name: true, phone: true, address: true, openingTime: true, closingTime: true, professionalOpeningTime: true, professionalClosingTime: true,
        appointmentNotificationsEnabled: true, appointmentNotificationSoundEnabled: true, stockNotificationsEnabled: true, expiryWarningDays: true,
      },
    }),
    prisma.clinicMembership.count({ where: { clinicId, role: "PROFESSIONAL" } }),
    prisma.procedure.count({ where: { clinicId } }),
    prisma.product.count({ where: { clinicId, kind: "material", archivedAt: null } }),
    prisma.product.count({ where: { clinicId, kind: "produto", archivedAt: null } }),
    prisma.recurringExpense.count({ where: { clinicId } }),
    prisma.clinicInvitation.count({ where: { clinicId, status: "PENDING", expiresAt: { gt: new Date() } } }),
  ]);
  if (!clinic) return null;
  return { ...clinic, professionalCount, procedureCount, materialCount, productCount, recurringExpenseCount, pendingInvitations };
}
