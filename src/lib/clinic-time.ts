const clinicTimeZone = "America/Sao_Paulo";

// Data de hoje no fuso da clínica, no formato YYYY-MM-DD.
export function clinicToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: clinicTimeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

// Data e minutos do dia no fuso da clínica.
export function clinicNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: clinicTimeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, minutes: Number(value("hour")) * 60 + Number(value("minute")) };
}

// "HH:MM" em minutos do dia; null se o formato ou o horário for inválido.
export function parseClockMinutes(value: unknown) {
  const match = /^(\d{2}):(\d{2})$/.exec(typeof value === "string" ? value : "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}

// O dia do agendamento é guardado como meio-dia em São Paulo: cai no mesmo dia em UTC e no fuso da clínica.
export function appointmentInstant(day: string) {
  return new Date(`${day}T12:00:00-03:00`);
}

// Aceita "YYYY-MM-DD" ou um ISO com hora e devolve só o dia escrito; null se inválido.
export function parseAppointmentDay(value: unknown) {
  if (typeof value !== "string") return null;
  return parseDateOnly(value.slice(0, 10)) ? value.slice(0, 10) : null;
}

export function appointmentDay(date: Date | string) {
  return clinicToday(new Date(date));
}

export function appointmentHasPassed(appointment: { date: Date | string; time: string }, now: { date: string; minutes: number }, toleranceMinutes = 0) {
  const day = appointmentDay(appointment.date);
  if (day !== now.date) return day < now.date;
  const [hours, minutes] = appointment.time.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0) + toleranceMinutes <= now.minutes;
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
