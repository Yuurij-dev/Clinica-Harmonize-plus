// Regra pura de conflito de horário da agenda. Sem imports: dias chegam como "YYYY-MM-DD" no fuso da clínica
// (America/Sao_Paulo) e viram instantes absolutos com o mesmo deslocamento fixo usado por `appointmentInstant`.

// Ocupam a faixa: agendado, em atendimento e os já realizados (a faixa foi usada). Faltou e Cancelado liberam.
export const occupyingAppointmentStatuses = ["Agendado", "Em atendimento", "Atendido", "Finalizado"] as const;
export const defaultAppointmentMinutes = 60;

export function appointmentOccupiesSlot(status: string) {
  return (occupyingAppointmentStatuses as readonly string[]).includes(status);
}

// Remarcação/mudança de status: só confere a faixa quando o agendamento passa a ocupá-la (reativação) ou quando a faixa muda.
export type AppointmentSlotState = { status: string; day: string; time: string; procedure: string; professional: string };
export function appointmentNeedsConflictCheck(current: AppointmentSlotState, next: AppointmentSlotState) {
  if (!appointmentOccupiesSlot(next.status)) return false;
  if (!appointmentOccupiesSlot(current.status)) return true;
  return current.day !== next.day || current.time !== next.time || current.procedure !== next.procedure || professionalKey(current.professional) !== professionalKey(next.professional);
}

// Mesma duração que o servidor usa ao validar o expediente: a do procedimento cadastrado, senão 60 min.
export function appointmentDurationMinutes(durationMinutes: number | null | undefined) {
  return typeof durationMinutes === "number" && Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : defaultAppointmentMinutes;
}

// Nome como é gravado: sem espaços nas pontas nem repetidos (a caixa original é mantida).
export function cleanProfessionalName(professional: string | null | undefined) {
  return (professional ?? "").trim().replace(/\s+/g, " ");
}

// "Dra.  Ana " e "dra. ana" são o mesmo profissional. Vazio = sem profissional (não conflita).
export function professionalKey(professional: string | null | undefined) {
  return cleanProfessionalName(professional).toLocaleLowerCase("pt-BR");
}

// Faixa [início, fim) em milissegundos absolutos; null se dia ou horário forem inválidos.
export function appointmentRange(day: string, time: string, durationMinutes: number | null | undefined) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const start = new Date(`${day}T${time}:00-03:00`).getTime();
  // O dia precisa existir no calendário (30/02 viraria 02/03).
  if (Number.isNaN(start) || new Date(start - 3 * 3_600_000).toISOString().slice(0, 10) !== day) return null;
  return { start, end: start + appointmentDurationMinutes(durationMinutes) * 60_000 };
}

// Adjacentes (fim == início) não se sobrepõem.
export function rangesOverlap(a: { start: number; end: number }, b: { start: number; end: number }) {
  return a.start < b.end && b.start < a.end;
}

// Janela de busca no banco: do início do dia anterior ao fim do dia seguinte (cobre faixas que atravessam a meia-noite).
export function conflictSearchWindow(day: string) {
  const midnight = new Date(`${day}T00:00:00-03:00`).getTime();
  return { from: new Date(midnight - 86_400_000), to: new Date(midnight + 2 * 86_400_000) };
}

export type ScheduleCandidate = {
  day: string;
  time: string;
  durationMinutes: number;
  professional: string;
  patientId: string | null;
  excludeId?: string;
};

export type ScheduledAppointment = {
  id: string;
  day: string;
  time: string;
  durationMinutes: number;
  status: string;
  professional: string;
  patientId: string | null;
  procedure: string;
};

export type ScheduleConflict = { kind: "patient" | "professional"; appointment: ScheduledAppointment; start: number; end: number };

// Primeiro conflito do candidato. Conflito do próprio paciente tem prioridade (mensagem mais útil).
export function findScheduleConflict(candidate: ScheduleCandidate, existing: ScheduledAppointment[]): ScheduleConflict | null {
  const range = appointmentRange(candidate.day, candidate.time, candidate.durationMinutes);
  if (!range) return null;
  const professional = professionalKey(candidate.professional);
  let professionalConflict: ScheduleConflict | null = null;
  for (const item of existing) {
    if (item.id === candidate.excludeId || !appointmentOccupiesSlot(item.status)) continue;
    const other = appointmentRange(item.day, item.time, item.durationMinutes);
    if (!other || !rangesOverlap(range, other)) continue;
    if (candidate.patientId && item.patientId === candidate.patientId) return { kind: "patient", appointment: item, ...other };
    if (professional && professionalKey(item.professional) === professional && !professionalConflict) professionalConflict = { kind: "professional", appointment: item, ...other };
  }
  return professionalConflict;
}

function clock(ms: number) {
  const minutes = Math.floor((((ms - 3 * 3_600_000) % 86_400_000) + 86_400_000) % 86_400_000 / 60_000);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function shortDate(ms: number) {
  const [, month, day] = new Date(ms - 3 * 3_600_000).toISOString().slice(0, 10).split("-");
  return `${day}/${month}`;
}

// Mensagem ao usuário. Em conflito por profissional não revela o outro paciente nem o procedimento.
export function scheduleConflictMessage(conflict: ScheduleConflict, professional: string) {
  const when = `em ${shortDate(conflict.start)} às ${clock(conflict.start)}–${clock(conflict.end)}`;
  if (conflict.kind === "patient") return `O paciente já tem outro agendamento neste horário: ${conflict.appointment.procedure}, ${when}.`;
  const name = professional.trim();
  return `${name ? `O profissional ${name}` : "O profissional"} já possui um atendimento neste horário (${when}). Escolha outro horário ou outro profissional.`;
}
