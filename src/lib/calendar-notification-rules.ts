// Regras puras dos e-mails (Resend) ao profissional sobre agendamentos: quais enviar, chave de deduplicação e texto do que mudou.
// Independente do Google (falha de um não afeta o outro). Sem Prisma, sem rede.
import { createHash } from "node:crypto";
import { appointmentHasPassed, appointmentInstant, clinicNow } from "./clinic-time.ts";
import { cleanProfessionalName } from "./appointment-conflict-rules.ts";
import { appointmentIsCancelled, diffAppointmentState, type AppointmentChange, type CalendarAppointmentState } from "./google-calendar-rules.ts";

export const CALENDAR_NOTIFICATION_KINDS = ["NEW", "CHANGED", "CANCELLED", "REASSIGNED_OUT"] as const;
export type CalendarNotificationKind = (typeof CALENDAR_NOTIFICATION_KINDS)[number];

export type NotificationProfessional = { userId: string } | null;

export type PlannedNotification = {
  kind: CalendarNotificationKind;
  recipientUserId: string;
  /** Estado que o e-mail descreve (a dedupeKey usa este estado). */
  state: CalendarAppointmentState;
  changes: AppointmentChange[];
};

/**
 * Quais e-mails enviar numa transição. `prev` null = criação; `next` null = exclusão.
 * Só notifica profissionais identificados. Mudança só de status (Atendido/Faltou/Em atendimento) não notifica.
 */
export function planNotifications(input: {
  prev: CalendarAppointmentState | null;
  next: CalendarAppointmentState | null;
  prevProfessional: NotificationProfessional;
  nextProfessional: NotificationProfessional;
  /** Agora no fuso da clínica (injetável em testes). */
  now?: { date: string; minutes: number };
}): PlannedNotification[] {
  const { prev, next, prevProfessional, nextProfessional } = input;
  const prevActive = Boolean(prev && !appointmentIsCancelled(prev.status));
  const nextActive = Boolean(next && !appointmentIsCancelled(next.status));
  // Cancelamento/reatribuição só avisam sobre agendamento que ainda estava "Agendado" e é futuro (mesma regra do e-mail ao paciente):
  // excluir jornada com atendimentos feitos/passados não envia e-mails.
  const prevUpcoming = Boolean(prev && prev.status === "Agendado" && !appointmentHasPassed({ date: appointmentInstant(prev.day), time: prev.time }, input.now ?? clinicNow()));
  const out: PlannedNotification[] = [];

  if (!nextActive) {
    // Exclusão ou cancelamento: avisa quem tinha o compromisso.
    if (prev && prevActive && prevUpcoming && prevProfessional) out.push({ kind: "CANCELLED", recipientUserId: prevProfessional.userId, state: prev, changes: [] });
    return out;
  }
  if (!next) return out;
  if (!prev || !prevActive) {
    if (nextProfessional) out.push({ kind: "NEW", recipientUserId: nextProfessional.userId, state: next, changes: [] });
    return out;
  }

  const changes = diffAppointmentState(prev, next);
  const samePerson = prevProfessional && nextProfessional && prevProfessional.userId === nextProfessional.userId;
  if (samePerson) {
    if (changes.some((change) => change.field !== "status" && change.field !== "professional")) {
      out.push({ kind: "CHANGED", recipientUserId: nextProfessional.userId, state: next, changes: changes.filter((change) => change.field !== "status" && change.field !== "professional") });
    }
    return out;
  }
  if (prevUpcoming && prevProfessional && prevProfessional.userId !== nextProfessional?.userId) out.push({ kind: "REASSIGNED_OUT", recipientUserId: prevProfessional.userId, state: prev, changes });
  if (nextProfessional) out.push({ kind: "NEW", recipientUserId: nextProfessional.userId, state: next, changes: [] });
  return out;
}

/** `appointmentId:kind:hash(destinatário + estado)`: o mesmo estado nunca reenvia; novo estado envia de novo. */
export function notificationDedupeKey(appointmentId: string, kind: CalendarNotificationKind, recipientUserId: string, state: CalendarAppointmentState) {
  const material = [recipientUserId, state.status, state.day, state.time, state.durationMinutes, state.procedure.trim().replace(/\s+/g, " "), cleanProfessionalName(state.professional).toLocaleLowerCase("pt-BR")].join("|");
  return `${appointmentId}:${kind}:${createHash("sha256").update(material).digest("hex").slice(0, 24)}`;
}

const FIELD_LABEL: Record<AppointmentChange["field"], string> = {
  day: "Data",
  time: "Horário",
  durationMinutes: "Duração",
  procedure: "Procedimento",
  professional: "Profissional",
  status: "Situação",
};

export function formatDay(day: string) {
  const [year, month, date] = day.split("-");
  return year && month && date ? `${date}/${month}/${year}` : day;
}

function formatValue(field: AppointmentChange["field"], value: string) {
  if (field === "day") return formatDay(value);
  if (field === "durationMinutes") return `${value} min`;
  return value || "—";
}

/** ["Data", "12/11/2026 → 13/11/2026"]. */
export function describeChangeParts(change: AppointmentChange): [label: string, value: string] {
  return [FIELD_LABEL[change.field], `${formatValue(change.field, change.before)} → ${formatValue(change.field, change.after)}`];
}

/** "Data: 12/11/2026 → 13/11/2026". */
export function describeChange(change: AppointmentChange) {
  const [label, value] = describeChangeParts(change);
  return `${label}: ${value}`;
}

export function describeChanges(changes: AppointmentChange[]) {
  return changes.map(describeChange);
}

export const notificationSubject: Record<CalendarNotificationKind, string> = {
  NEW: "Novo agendamento atribuído a você",
  CHANGED: "Agendamento alterado",
  CANCELLED: "Agendamento cancelado",
  REASSIGNED_OUT: "Agendamento reatribuído a outro profissional",
};
