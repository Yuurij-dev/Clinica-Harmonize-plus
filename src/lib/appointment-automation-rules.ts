import { appointmentDay } from "./clinic-time.ts";

export type AutomaticAppointment = { id: string; date: Date | string; time: string; status: string; updatedAt: Date | string };

// Fim do prazo de comparecimento: início do agendamento + tolerância, no fuso da clínica (-03:00).
export function missedDeadline(appointment: Pick<AutomaticAppointment, "date" | "time">, toleranceMinutes: number) {
  const start = new Date(`${appointmentDay(appointment.date)}T${appointment.time}:00-03:00`);
  return new Date(start.getTime() + toleranceMinutes * 60_000);
}

// Só faltas: "Agendado" cujo prazo já passou. Uma alteração humana depois do prazo (updatedAt > prazo,
// ex.: "Faltou" -> "Agendado") é permanente; remarcar para data futura move o prazo e a regra volta a valer.
// Limitação: ensurePatientJourney também atualiza updatedAt de agendamentos legados sem jornada; nesse caso
// a falta deixa de ser marcada automaticamente (falha conservadora: não sobrescreve ninguém).
export function appointmentsForAutomaticTransitions<T extends AutomaticAppointment>(
  appointments: T[],
  settings: { autoMarkMissedAppointmentsEnabled: boolean; appointmentToleranceMinutes: number },
  now: { date: string; minutes: number },
  hasPassed: (appointment: Pick<T, "date" | "time">, now: { date: string; minutes: number }, toleranceMinutes?: number) => boolean,
) {
  const missed = settings.autoMarkMissedAppointmentsEnabled
    ? appointments.filter((appointment) => appointment.status === "Agendado"
      && hasPassed(appointment, now, settings.appointmentToleranceMinutes)
      && new Date(appointment.updatedAt).getTime() <= missedDeadline(appointment, settings.appointmentToleranceMinutes).getTime())
    : [];
  return { missed };
}

// Faixa de 1 ms no lugar de igualdade exata: Timestamptz(6) pode ter microssegundos que o Date do JS trunca.
export function optimisticUpdatedAt(updatedAt: Date | string) {
  const start = new Date(updatedAt).getTime();
  return { updatedAt: { gte: new Date(start), lt: new Date(start + 1) } };
}
