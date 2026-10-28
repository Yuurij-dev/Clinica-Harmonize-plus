export function mergePatientAppointments<T extends { id?: string }>(appointments: T[], additions: T[]) {
  const existingIds = new Set(appointments.flatMap((appointment) => appointment.id ? [appointment.id] : []));
  return [...appointments, ...additions.filter((appointment) => !appointment.id || !existingIds.has(appointment.id))];
}
