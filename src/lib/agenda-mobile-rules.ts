// Regras puras da agenda no celular (sem React): grade do mês e rolagem da semana até hoje.

/** Dias do mês em linhas de 7 (segunda a domingo); 0 marca célula vazia fora do mês. */
export function monthCellDays(year: number, monthIndex: number) {
  const startOffset = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const total = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  return Array.from({ length: total }, (_, index) => {
    const day = index - startOffset + 1;
    return day > 0 && day <= daysInMonth ? day : 0;
  });
}

/** Dia que abre selecionado no mês: hoje (se estiver nele), senão o primeiro com agendamento, senão o dia 1. */
export function defaultMonthDay(year: number, monthIndex: number, todayKey: string, appointmentDayKeys: string[]) {
  const prefix = `${year}-${String(monthIndex + 1).padStart(2, "0")}-`;
  if (todayKey.startsWith(prefix)) return Number(todayKey.slice(prefix.length));
  const first = appointmentDayKeys.filter((key) => key.startsWith(prefix)).sort()[0];
  return first ? Number(first.slice(prefix.length)) : 1;
}

/**
 * Posição de rolagem horizontal da semana (3 dias visíveis): hoje fica no meio, limitado às pontas.
 * `dayWidth` é a largura de um dia; devolve 0 quando hoje não está na semana.
 */
export function weekScrollLeft(dayKeys: string[], todayKey: string, dayWidth: number) {
  const index = dayKeys.indexOf(todayKey);
  if (index < 0) return 0;
  return Math.min(Math.max(0, index - 1), Math.max(0, dayKeys.length - 3)) * dayWidth;
}
