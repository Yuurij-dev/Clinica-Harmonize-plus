export type AutomaticAppointment = { id: string; date: Date | string; time: string; status: string; durationMinutes: number };

export function appointmentsForAutomaticTransitions<T extends AutomaticAppointment>(
  appointments: T[],
  settings: { autoMarkMissedAppointmentsEnabled: boolean; autoCompleteAppointmentsEnabled: boolean; appointmentToleranceMinutes: number },
  now: { date: string; minutes: number },
  hasPassed: (appointment: Pick<T, "date" | "time">, now: { date: string; minutes: number }, toleranceMinutes?: number) => boolean,
) {
  const missed = settings.autoMarkMissedAppointmentsEnabled
    ? appointments.filter((appointment) => appointment.status === "Agendado" && hasPassed(appointment, now, settings.appointmentToleranceMinutes))
    : [];
  const completed = settings.autoCompleteAppointmentsEnabled
    ? appointments.filter((appointment) => appointment.status === "Em atendimento" && hasPassed(appointment, now, appointment.durationMinutes))
    : [];
  return { missed, completed };
}
