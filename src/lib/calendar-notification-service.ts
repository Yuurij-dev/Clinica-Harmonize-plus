// E-mails (Resend) ao profissional sobre agendamentos: NEW / CHANGED / CANCELLED / REASSIGNED_OUT.
// Independente do Google: falha de um lado não repete nem bloqueia o outro. CalendarNotificationLog.dedupeKey (único) é gravado
// ANTES do envio, então o mesmo estado nunca é enviado duas vezes. E-mail não configurado = não envia e não falha.
import type { PrismaClient } from "@prisma/client";
import { composeEmail, heading, highlight, infoCard, button, note, paragraph, type Block } from "./email-layout.ts";
import { isEmailDeliveryReady, sendEmail, type EmailResult } from "./email.ts";
import { cleanProfessionalName } from "./appointment-conflict-rules.ts";
import { describeChangeParts, formatDay, notificationDedupeKey, notificationSubject, type CalendarNotificationKind, type PlannedNotification } from "./calendar-notification-rules.ts";
import { isValidCalendarEmail, type AppointmentChange, type CalendarAppointmentState } from "./google-calendar-rules.ts";

type Env = Record<string, string | undefined>;

export type GoogleNotice = "invite" | "calendar" | null;

export type NotificationEmailInput = {
  kind: CalendarNotificationKind;
  recipientName: string;
  clinicName: string;
  patientName: string;
  state: CalendarAppointmentState;
  changes: AppointmentChange[];
  /** "invite": convite Google enviado (há agenda central); "calendar": só entrou na agenda Google dele; null: sem Google. */
  googleNotice: GoogleNotice;
  link: string | null;
};

function stateRows(input: NotificationEmailInput): Array<[string, string]> {
  return [
    ["Paciente", input.patientName || "—"],
    ["Procedimento", input.state.procedure.trim() || "—"],
    ["Data", formatDay(input.state.day)],
    ["Horário", `${input.state.time} (${input.state.durationMinutes} min)`],
    ["Profissional", cleanProfessionalName(input.state.professional) || "—"],
  ];
}

const googleText: Record<Exclude<GoogleNotice, null>, Record<CalendarNotificationKind, string>> = {
  invite: {
    NEW: "O convite deste atendimento também foi enviado pelo Google Agenda.",
    CHANGED: "O evento no Google Agenda foi atualizado.",
    CANCELLED: "O evento no Google Agenda foi cancelado.",
    REASSIGNED_OUT: "O evento no Google Agenda foi atualizado.",
  },
  calendar: {
    NEW: "O atendimento também foi adicionado à sua agenda do Google conectada.",
    CHANGED: "O evento na sua agenda do Google foi atualizado.",
    CANCELLED: "O evento na sua agenda do Google foi removido.",
    REASSIGNED_OUT: "O evento na sua agenda do Google foi removido.",
  },
};

/** Monta o e-mail (HTML + texto) na paleta da marca. Todo valor dinâmico é escapado pelo email-layout. */
export function buildCalendarNotificationEmail(input: NotificationEmailInput): { subject: string; html: string; text: string } {
  const when = `${formatDay(input.state.day)} às ${input.state.time}`;
  const blocks: Block[] = [heading(notificationSubject[input.kind])];
  if (input.kind === "NEW") {
    blocks.push(paragraph(`Um agendamento foi atribuído a você na clínica ${input.clinicName}.`), highlight("Data e horário", when), infoCard(stateRows(input)));
  } else if (input.kind === "CHANGED") {
    blocks.push(paragraph(`Um agendamento seu na clínica ${input.clinicName} foi alterado.`));
    if (input.changes.length) blocks.push(infoCard(input.changes.map(describeChangeParts)));
    blocks.push(highlight("Novo horário", when), infoCard(stateRows(input)));
  } else if (input.kind === "CANCELLED") {
    blocks.push(paragraph(`Um agendamento seu na clínica ${input.clinicName} foi cancelado.`), highlight("Horário cancelado", when, "danger"), infoCard(stateRows(input)));
  } else {
    blocks.push(paragraph(`Um agendamento da clínica ${input.clinicName} foi atribuído a outro profissional e saiu da sua agenda.`));
    const professionalChange = input.changes.find((change) => change.field === "professional");
    if (professionalChange) blocks.push(infoCard([describeChangeParts(professionalChange)]));
    blocks.push(highlight("Horário", when, "danger"), infoCard(stateRows(input)));
  }
  if (input.link) blocks.push(button(input.link, "Abrir no Harmonize+"));
  if (input.googleNotice) blocks.push(note(googleText[input.googleNotice][input.kind]));
  const body = composeEmail({ preheader: `${notificationSubject[input.kind]}: ${when}.`, greeting: input.recipientName, blocks, clinic: { name: input.clinicName, rows: [] } });
  return { subject: `${notificationSubject[input.kind]} — ${formatDay(input.state.day)} às ${input.state.time}`, ...body };
}

export type NotificationDeps = {
  db: Pick<PrismaClient, "calendarNotificationLog" | "clinicMembership" | "clinic" | "googleCalendarConnection">;
  send?: (input: { to: string; subject: string; html: string; text: string }) => Promise<EmailResult>;
  isReady?: () => boolean;
  env?: Env;
  appLink?: string | null;
};

const isUniqueViolation = (error: unknown) => (error as { code?: unknown } | null)?.code === "P2002";

export type NotificationSummary = { sent: number; failed: number; skipped: number };

/**
 * Envia os e-mails planejados. `actorUserId`: quem fez a alteração não recebe e-mail da própria ação.
 * Nunca lança: qualquer falha vira contagem.
 */
export async function sendCalendarNotifications(deps: NotificationDeps, input: { clinicId: string; appointmentId: string; patientName: string; planned: PlannedNotification[]; actorUserId?: string | null }): Promise<NotificationSummary> {
  const summary: NotificationSummary = { sent: 0, failed: 0, skipped: 0 };
  try {
    const ready = (deps.isReady ?? (() => isEmailDeliveryReady(deps.env)))();
    if (!ready || !input.planned.length) {
      summary.skipped = input.planned.length;
      return summary;
    }
    const send = deps.send ?? ((email) => sendEmail(email, deps.env ? { env: deps.env } : {}));
    const [clinic, connections] = await Promise.all([
      deps.db.clinic.findUnique({ where: { id: input.clinicId }, select: { name: true } }),
      deps.db.googleCalendarConnection.findMany({ where: { clinicId: input.clinicId, status: "CONNECTED" }, select: { connectionType: true, userId: true } }),
    ]);
    const centralConnected = connections.some((connection) => connection.connectionType === "ADMIN");

    for (const item of input.planned) {
      try {
        if (item.recipientUserId === input.actorUserId) {
          summary.skipped += 1;
          continue;
        }
        const member = await deps.db.clinicMembership.findFirst({
          where: { clinicId: input.clinicId, userId: item.recipientUserId, role: { in: ["ADMIN", "PROFESSIONAL"] } },
          select: { user: { select: { name: true, email: true } } },
        });
        if (!member || !isValidCalendarEmail(member.user.email)) {
          summary.skipped += 1;
          continue;
        }
        const dedupeKey = notificationDedupeKey(input.appointmentId, item.kind, item.recipientUserId, item.state);
        try {
          await deps.db.calendarNotificationLog.create({ data: { clinicId: input.clinicId, appointmentId: input.appointmentId, recipientUserId: item.recipientUserId, kind: item.kind, dedupeKey, status: "SENT" } });
        } catch (error) {
          // P2002: este estado já foi enviado (ou está sendo). Qualquer outro erro: sem registro não há como garantir "sem duplicar".
          if (!isUniqueViolation(error)) summary.failed += 1;
          else summary.skipped += 1;
          continue;
        }
        const hasIndividual = connections.some((connection) => connection.connectionType === "PROFESSIONAL" && connection.userId === item.recipientUserId);
        const googleNotice: GoogleNotice = centralConnected ? "invite" : hasIndividual ? "calendar" : null;
        const email = buildCalendarNotificationEmail({ kind: item.kind, recipientName: member.user.name, clinicName: clinic?.name ?? "Clínica", patientName: input.patientName, state: item.state, changes: item.changes, googleNotice, link: deps.appLink ?? null });
        const result = await send({ to: member.user.email.trim(), subject: email.subject, html: email.html, text: email.text }).catch((): EmailResult => ({ sent: false, reason: "network" }));
        if (result.sent) {
          summary.sent += 1;
        } else {
          summary.failed += 1;
          await deps.db.calendarNotificationLog.updateMany({ where: { dedupeKey, clinicId: input.clinicId }, data: { status: "FAILED" } }).catch(() => undefined);
        }
      } catch {
        summary.failed += 1;
      }
    }
  } catch {
    console.warn("[calendar-notification]", "failed");
  }
  return summary;
}
