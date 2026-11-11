// Chave por clinica para e-mails ao paciente. Ausente/indefinido conta como ligado (padrao da coluna), igual as outras preferencias.
export const PATIENT_EMAILS_DISABLED_MESSAGE = "O envio de e-mails aos clientes está desativado nas configurações da clínica.";

export function patientEmailsAllowed(clinic: { patientEmailsEnabled?: boolean | null } | null | undefined): boolean {
  return clinic?.patientEmailsEnabled !== false;
}
