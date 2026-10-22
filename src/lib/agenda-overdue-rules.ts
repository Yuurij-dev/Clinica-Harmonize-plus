// Agendamentos vencidos ("Agendado" cujo fim já passou no fuso da clínica). Sem imports: roda nos testes do Node.
export const overdueLimit = 200;
// O banco só filtra por status e data; a duração real vem do procedimento, então o corte final é em memória.
export const overdueCandidateLimit = 400;

function dayMinutes(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date) / 60_000;
}

// Fim = dia + hora de início + duração (pode passar da meia-noite). `now` é { date: AAAA-MM-DD, minutes } no fuso da clínica.
export function appointmentHasEnded(day: string, time: string, durationMinutes: number, now: { date: string; minutes: number }) {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const end = dayMinutes(day) + Number(match[1]) * 60 + Number(match[2]) + durationMinutes;
  return end <= dayMinutes(now.date) + now.minutes;
}

export function selectOverdue<T extends { date: Date; time: string; procedure: string; status: string }>(
  rows: T[], durationOf: (procedure: string) => number, now: { date: string; minutes: number }, limit = overdueLimit,
) {
  return rows
    .filter((row) => row.status === "Agendado" && appointmentHasEnded(row.date.toISOString().slice(0, 10), row.time, durationOf(row.procedure), now))
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.time.localeCompare(b.time))
    .slice(0, limit);
}
