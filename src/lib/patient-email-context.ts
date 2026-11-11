import { prisma } from "@/lib/prisma";
import { patientEmailsAllowed } from "@/lib/patient-email-rules";

// Destinatario + dados da clinica para os e-mails ao paciente. Escopado por clinicId; sem e-mail cadastrado ou chave da clinica desligada => null (nao e erro).
export async function loadPatientEmailContext(clinicId: string, patientId: string) {
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId },
    select: { name: true, email: true, clinic: { select: { name: true, phone: true, cnpj: true, address: true, patientEmailsEnabled: true } } },
  });
  const to = patient?.email?.trim();
  if (!patient || !patient.clinic || !to || !patientEmailsAllowed(patient.clinic)) return null;
  return { to, patientName: patient.name, clinicName: patient.clinic.name, clinicPhone: patient.clinic.phone, clinicCnpj: patient.clinic.cnpj, clinicAddress: patient.clinic.address };
}
