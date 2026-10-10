export function mergePatientAppointments<T extends { id?: string }>(appointments: T[], additions: T[]) {
  const existingIds = new Set(appointments.flatMap((appointment) => appointment.id ? [appointment.id] : []));
  return [...appointments, ...additions.filter((appointment) => !appointment.id || !existingIds.has(appointment.id))];
}

export function procedureCardScheduleAction(status: string, canScheduleProcedure: boolean, canScheduleReturn: boolean) {
  if (canScheduleReturn) return { kind: "return" as const, label: "Marcar retorno", disabled: false };
  if (canScheduleProcedure) return { kind: "procedure" as const, label: "Marcar procedimento", disabled: false };
  return status === "Realizado"
    ? { kind: "return" as const, label: "Retorno marcado", disabled: true }
    : { kind: "procedure" as const, label: "Procedimento marcado", disabled: true };
}
