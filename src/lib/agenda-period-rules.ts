// Período visível da Agenda (dia, semana de segunda a domingo, mês) como intervalo de dias "YYYY-MM-DD" no fuso da clínica.
export type AgendaView = "Dia" | "Semana" | "Mês";
export type AgendaRange = { from: string; to: string };

export const maxAgendaRangeDays = 93;
const dayMs = 86_400_000;

function toMs(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date);
}

function fromMs(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

export const minAgendaYear = 1970;
export const maxAgendaYear = 2100;

// Dia do agendamento (AAAA-MM-DD ou ISO com hora) como DD/MM/AAAA, pelo dia escrito (o mesmo que a Agenda usa para posicionar); "" se inválido.
export function formatDayBR(value: string) {
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : "";
}

// Só a primeira letra em maiúscula ("outubro de 2026" -> "Outubro de 2026"); o CSS capitalize deixaria "De".
export function capitalizeFirst(value: string) {
  return value ? value.charAt(0).toLocaleUpperCase("pt-BR") + value.slice(1) : value;
}

export function isDayKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return fromMs(toMs(value)) === value;
}

export function addDays(day: string, amount: number) {
  return fromMs(toMs(day) + amount * dayMs);
}

export function startOfWeek(day: string) {
  const weekday = new Date(toMs(day)).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

function monthStart(day: string) {
  return `${day.slice(0, 7)}-01`;
}

function monthEnd(day: string) {
  const [year, month] = day.split("-").map(Number);
  return fromMs(Date.UTC(year, month, 0));
}

export function agendaPeriodRange(day: string, view: AgendaView): AgendaRange {
  if (view === "Dia") return { from: day, to: day };
  if (view === "Semana") { const from = startOfWeek(day); return { from, to: addDays(from, 6) }; }
  return { from: monthStart(day), to: monthEnd(day) };
}

// Anterior/próximo: dia ±1, semana ±7, mês ±1 mês de calendário (o dia é limitado ao último dia do mês de destino).
export function shiftAgendaDay(day: string, view: AgendaView, amount: number) {
  if (view === "Dia") return addDays(day, amount);
  if (view === "Semana") return addDays(day, amount * 7);
  const [year, month, date] = day.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + amount, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return fromMs(first.getTime() + (Math.min(date, lastDay) - 1) * dayMs);
}

export function agendaNeighborRanges(day: string, view: AgendaView): AgendaRange[] {
  return [-1, 1].map((amount) => agendaPeriodRange(shiftAgendaDay(day, view, amount), view));
}

export function agendaPeriodKey(range: AgendaRange) {
  return `/api/agenda?from=${range.from}&to=${range.to}`;
}

// Chave "virtual" de invalidação: derruba só os períodos em cache que contêm o dia alterado.
export function agendaDayInvalidationKey(day: string) {
  return `/api/agenda?day=${day.slice(0, 10)}`;
}

export function dayInRange(day: string, range: AgendaRange) {
  return range.from <= day && day <= range.to;
}

// Valida ?from&to do servidor. `start`/`endExclusive` são limites UTC: o dia do agendamento é guardado ao meio-dia em São Paulo,
// que cai no mesmo dia em UTC (ver appointmentInstant), então [from 00:00Z, to+1 00:00Z) pega o dia inteiro, inclusive o limite.
export function parseAgendaRange(from: string | null, to: string | null): { ok: true; range: AgendaRange; start: Date; endExclusive: Date } | { ok: false; message: string } {
  if (!isDayKey(from) || !isDayKey(to)) return { ok: false, message: "Informe from e to no formato AAAA-MM-DD." };
  const year = (day: string) => Number(day.slice(0, 4));
  if (year(from) < minAgendaYear || year(to) > maxAgendaYear || year(from) > maxAgendaYear || year(to) < minAgendaYear) return { ok: false, message: `Use datas entre ${minAgendaYear} e ${maxAgendaYear}.` };
  if (from > to) return { ok: false, message: "O período é inválido: from deve ser anterior ou igual a to." };
  if ((toMs(to) - toMs(from)) / dayMs + 1 > maxAgendaRangeDays) return { ok: false, message: `O período pode ter no máximo ${maxAgendaRangeDays} dias.` };
  return { ok: true, range: { from, to }, start: new Date(toMs(from)), endExclusive: new Date(toMs(to) + dayMs) };
}
