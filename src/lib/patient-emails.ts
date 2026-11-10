// E-mails transacionais para o paciente (Resend via sendEmail). Recebem dados ja resolvidos, escapam todo valor dinamico
// e nunca lancam. Datas chegam como "YYYY-MM-DD" (dia da clinica) e horarios como "HH:MM".
import { escapeHtml, sendEmail, type EmailResult } from "./email.ts";

type Deps = { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch };
type Clinic = { clinicName: string; clinicPhone?: string | null; clinicAddress?: string | null };
type Base = Clinic & { to: string; patientName: string };

const formatDay = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
};

export const formatBRL = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function render(patientName: string, lines: Array<{ html: string; text: string }>, clinic: Clinic) {
  const contact = [clinic.clinicPhone?.trim(), clinic.clinicAddress?.trim()].filter((value): value is string => Boolean(value));
  const footerText = [clinic.clinicName, ...contact].join(" · ");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#25263a">
<p>Olá, ${escapeHtml(patientName)},</p>
${lines.map((line) => `<p>${line.html}</p>`).join("\n")}
<p style="font-size:13px;color:#7783a8">${escapeHtml(footerText)}</p>
</div>`;
  const text = `Olá, ${patientName},\n\n${lines.map((line) => line.text).join("\n\n")}\n\n${footerText}`;
  return { html, text };
}

async function deliver(to: string, subject: string, body: { html: string; text: string }, deps: Deps): Promise<EmailResult> {
  try {
    return await sendEmail({ to, subject, ...body }, deps);
  } catch {
    return { sent: false, reason: "network" };
  }
}

export function sendAppointmentConfirmationEmail(
  input: Base & { procedure: string; professional: string; date: string; time: string },
  deps: Deps = {},
): Promise<EmailResult> {
  const when = `${formatDay(input.date)} às ${input.time}`;
  const body = render(input.patientName, [
    { html: `Seu agendamento na clínica <strong>${escapeHtml(input.clinicName)}</strong> foi confirmado.`, text: `Seu agendamento na clínica ${input.clinicName} foi confirmado.` },
    { html: `Procedimento: ${escapeHtml(input.procedure)}<br>Profissional: ${escapeHtml(input.professional)}<br>Data e horário: ${escapeHtml(when)}`, text: `Procedimento: ${input.procedure}\nProfissional: ${input.professional}\nData e horário: ${when}` },
  ], input);
  return deliver(input.to, `Agendamento confirmado — ${input.procedure} em ${formatDay(input.date)}`, body, deps);
}

export function sendAppointmentRescheduledEmail(
  input: Base & { procedure: string; professional: string; oldDate: string; oldTime: string; newDate: string; newTime: string },
  deps: Deps = {},
): Promise<EmailResult> {
  const before = `${formatDay(input.oldDate)} às ${input.oldTime}`;
  const after = `${formatDay(input.newDate)} às ${input.newTime}`;
  const body = render(input.patientName, [
    { html: `Seu agendamento na clínica <strong>${escapeHtml(input.clinicName)}</strong> foi remarcado.`, text: `Seu agendamento na clínica ${input.clinicName} foi remarcado.` },
    { html: `Procedimento: ${escapeHtml(input.procedure)}<br>Profissional: ${escapeHtml(input.professional)}<br>Antes: ${escapeHtml(before)}<br>Novo horário: <strong>${escapeHtml(after)}</strong>`, text: `Procedimento: ${input.procedure}\nProfissional: ${input.professional}\nAntes: ${before}\nNovo horário: ${after}` },
  ], input);
  return deliver(input.to, `Seu agendamento foi remarcado — ${input.procedure}`, body, deps);
}

// Nao inclui o motivo do cancelamento: pode conter nota interna da equipe.
export function sendAppointmentCancelledEmail(
  input: Base & { procedure: string; date: string; time: string },
  deps: Deps = {},
): Promise<EmailResult> {
  const when = `${formatDay(input.date)} às ${input.time}`;
  const body = render(input.patientName, [
    { html: `Seu agendamento de <strong>${escapeHtml(input.procedure)}</strong> em ${escapeHtml(when)} na clínica ${escapeHtml(input.clinicName)} foi cancelado.`, text: `Seu agendamento de ${input.procedure} em ${when} na clínica ${input.clinicName} foi cancelado.` },
    { html: "Se quiser remarcar, entre em contato com a clínica.", text: "Se quiser remarcar, entre em contato com a clínica." },
  ], input);
  return deliver(input.to, `Agendamento cancelado — ${input.procedure}`, body, deps);
}

export function sendQuoteEmail(
  input: Base & { totalCents: number; expires?: string | null; itemCount?: number | null },
  deps: Deps = {},
): Promise<EmailResult> {
  // Omite a contagem quando desconhecida (orçamento legado sem itens estruturados).
  const count = input.itemCount && input.itemCount > 0 ? `, com ${input.itemCount} procedimento${input.itemCount === 1 ? "" : "s"}` : "";
  const total = formatBRL(input.totalCents);
  const lines = [
    { html: `Preparamos seu orçamento na clínica <strong>${escapeHtml(input.clinicName)}</strong>${count}.`, text: `Preparamos seu orçamento na clínica ${input.clinicName}${count}.` },
    { html: `Valor total: <strong>${escapeHtml(total)}</strong>${input.expires ? `<br>Válido até: ${escapeHtml(formatDay(input.expires))}` : ""}`, text: `Valor total: ${total}${input.expires ? `\nVálido até: ${formatDay(input.expires)}` : ""}` },
    { html: "Procure a recepção da clínica para seguir com o atendimento.", text: "Procure a recepção da clínica para seguir com o atendimento." },
  ];
  return deliver(input.to, `Seu orçamento na clínica ${input.clinicName}`, render(input.patientName, lines, input), deps);
}
