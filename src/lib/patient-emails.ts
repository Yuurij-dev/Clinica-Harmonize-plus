// E-mails transacionais para o paciente (Resend via sendEmail). Recebem dados ja resolvidos, escapam todo valor dinamico
// e nunca lancam. Datas chegam como "YYYY-MM-DD" (dia da clinica) e horarios como "HH:MM".
import { sendEmail, type EmailAttachment, type EmailResult } from "./email.ts";
import { formatPhone, formatCnpj, onlyDigits } from "./input-masks.ts";
import { composeEmail, heading, paragraph, infoCard, highlight, note, type Block, type Row } from "./email-layout.ts";

type Deps = { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch };
type Clinic = { clinicName: string; clinicPhone?: string | null; clinicCnpj?: string | null; clinicAddress?: string | null };
type Base = Clinic & { to: string; patientName: string };

const formatDay = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
};

export const formatBRL = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Rodapé rotulado: nome da clínica e, abaixo, cada dado com seu rótulo. Telefone/CNPJ recebem máscara só
// quando têm o número certo de dígitos; fora disso vão como estão (não mascara dado inválido como se fosse válido).
function clinicFooterRows(clinic: Clinic): Row[] {
  const phone = clinic.clinicPhone?.trim();
  const cnpj = clinic.clinicCnpj?.trim();
  const address = clinic.clinicAddress?.trim();
  const rows: Array<Row | null> = [
    phone ? ["Telefone", [10, 11].includes(onlyDigits(phone).length) ? formatPhone(phone) : phone] : null,
    cnpj ? ["CNPJ", onlyDigits(cnpj).length === 14 ? formatCnpj(cnpj) : cnpj] : null,
    address ? ["Endereço", address] : null,
  ];
  return rows.filter((row): row is Row => row !== null);
}

function deliverPatient(input: Base, subject: string, preheader: string, blocks: Block[], deps: Deps, attachments?: EmailAttachment[]): Promise<EmailResult> {
  const body = composeEmail({ preheader, greeting: input.patientName, blocks, clinic: { name: input.clinicName, rows: clinicFooterRows(input) } });
  return deliver(input.to, subject, body, deps, attachments);
}

async function deliver(to: string, subject: string, body: { html: string; text: string }, deps: Deps, attachments?: EmailAttachment[]): Promise<EmailResult> {
  try {
    return await sendEmail({ to, subject, ...body, ...(attachments?.length ? { attachments } : {}) }, deps);
  } catch {
    return { sent: false, reason: "network" };
  }
}

export function sendAppointmentConfirmationEmail(
  input: Base & { procedure: string; professional: string; date: string; time: string },
  deps: Deps = {},
): Promise<EmailResult> {
  const when = `${formatDay(input.date)} às ${input.time}`;
  return deliverPatient(input, `Agendamento confirmado — ${input.procedure} em ${formatDay(input.date)}`, "Seu agendamento foi confirmado.", [
    heading("Agendamento confirmado"),
    paragraph(`Seu agendamento na clínica ${input.clinicName} foi confirmado. Aguardamos você no horário abaixo.`),
    infoCard([["Procedimento", input.procedure], ["Profissional", input.professional], ["Data e horário", when]]),
  ], deps);
}

export function sendAppointmentRescheduledEmail(
  input: Base & { procedure: string; professional: string; oldDate: string; oldTime: string; newDate: string; newTime: string },
  deps: Deps = {},
): Promise<EmailResult> {
  const before = `${formatDay(input.oldDate)} às ${input.oldTime}`;
  const after = `${formatDay(input.newDate)} às ${input.newTime}`;
  return deliverPatient(input, `Seu agendamento foi remarcado — ${input.procedure}`, "Seu agendamento foi remarcado.", [
    heading("Agendamento remarcado"),
    paragraph(`Seu agendamento na clínica ${input.clinicName} foi remarcado. Veja o novo horário:`),
    highlight("Novo horário", after),
    infoCard([["Procedimento", input.procedure], ["Profissional", input.professional]]),
    note(`Antes: ${before}`),
  ], deps);
}

// Nao inclui o motivo do cancelamento: pode conter nota interna da equipe.
export function sendAppointmentCancelledEmail(
  input: Base & { procedure: string; date: string; time: string },
  deps: Deps = {},
): Promise<EmailResult> {
  const when = `${formatDay(input.date)} às ${input.time}`;
  return deliverPatient(input, `Agendamento cancelado — ${input.procedure}`, "Seu agendamento foi cancelado.", [
    heading("Agendamento cancelado"),
    paragraph(`Seu agendamento na clínica ${input.clinicName} foi cancelado.`),
    infoCard([["Procedimento", input.procedure], ["Data e horário", when]]),
    paragraph("Se quiser remarcar, entre em contato com a clínica."),
  ], deps);
}

export function sendQuoteEmail(
  input: Base & { totalCents: number; expires?: string | null; itemCount?: number | null; attachment?: EmailAttachment },
  deps: Deps = {},
): Promise<EmailResult> {
  // Omite a contagem quando desconhecida (orçamento legado sem itens estruturados).
  const count = input.itemCount && input.itemCount > 0 ? `, com ${input.itemCount} procedimento${input.itemCount === 1 ? "" : "s"}` : "";
  const blocks: Block[] = [
    heading("Seu orçamento"),
    paragraph(`Preparamos seu orçamento na clínica ${input.clinicName}${count}.`),
    highlight("Valor total", formatBRL(input.totalCents)),
  ];
  if (input.expires) blocks.push(note(`Válido até: ${formatDay(input.expires)}`));
  blocks.push(paragraph("Procure a recepção da clínica para seguir com o atendimento."));
  return deliverPatient(input, `Seu orçamento na clínica ${input.clinicName}`, "Seu orçamento está pronto.", blocks, deps, input.attachment ? [input.attachment] : undefined);
}
