const clinicTimeZone = "America/Sao_Paulo";

// Data de hoje no fuso da clínica, no formato YYYY-MM-DD.
export function clinicToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: clinicTimeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

// Converte um campo DATE do banco (meia-noite UTC) para YYYY-MM-DD.
export function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function parseDateOnly(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || dateOnly(date) !== value ? null : date;
}

export function appointmentWithinStartWindow(appointment: { date: string; time: string }, toleranceMinutes: number, now: { date: string; time: string }) {
  const [day, month, year] = appointment.date.split("/");
  if (`${year}-${month}-${day}` !== now.date || !/^\d{2}:\d{2}$/.test(appointment.time)) return false;
  const [hours, minutes] = appointment.time.split(":").map(Number);
  const startMinutes = hours * 60 + minutes;
  const nowMinutes = Number(now.time.slice(0, 2)) * 60 + Number(now.time.slice(3));
  return nowMinutes >= startMinutes && nowMinutes < startMinutes + toleranceMinutes;
}

export function matchesProcedureAppointment(appointment: { procedure: string }, procedures: Array<{ name: string }>) {
  return procedures.some((procedure) => procedure.name === appointment.procedure);
}

export function canRequestAppointmentStart(appointment: { procedure: string; status: string }, procedures: Array<{ name: string }>, withinWindow: boolean, updating: boolean) {
  return appointment.status === "Agendado" && !updating && (withinWindow || matchesProcedureAppointment(appointment, procedures));
}
