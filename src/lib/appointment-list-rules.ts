// Regras puras da lista de agendamentos do cliente (Prontuário > Agendamentos): grupos por status, filtros, ordenação,
// paginação e rótulos. Os status são os da Agenda; nada aqui cria status ou regra de agenda nova.

export type AppointmentListItem = {
  id?: string;
  // "dd/mm/aaaa" como o histórico do paciente entrega; dateKey (aaaa-mm-dd, fuso da clínica) tem prioridade quando existir.
  date: string;
  dateKey?: string;
  time: string;
  procedure: string;
  professional: string;
  status: string;
  notes?: string;
  journeyId?: string | null;
};

export type AppointmentGroup = "upcoming" | "done" | "running" | "missed" | "cancelled";
export type AppointmentGroupFilter = AppointmentGroup | "all";
export type AppointmentSort = "smart" | "recent" | "oldest";
export type AppointmentKind = "Avaliação" | "Procedimento" | "Retorno";

export const appointmentGroupChips: Array<{ id: AppointmentGroupFilter; label: string }> = [
  { id: "upcoming", label: "Próximos" },
  { id: "done", label: "Realizados" },
  { id: "running", label: "Em atendimento" },
  { id: "missed", label: "Faltas" },
  { id: "cancelled", label: "Cancelados" },
  { id: "all", label: "Todos" },
];

export const appointmentPageSizes = [9, 18, 36];

export type AppointmentFilters = { group: AppointmentGroupFilter; search: string; from: string; to: string; sort: AppointmentSort };
export const defaultAppointmentFilters: AppointmentFilters = { group: "upcoming", search: "", from: "", to: "", sort: "smart" };

// Status desconhecido cai em nenhum grupo (aparece só em "Todos").
export function appointmentGroup(status: string): AppointmentGroup | null {
  if (status === "Agendado") return "upcoming";
  if (status === "Atendido" || status === "Finalizado") return "done";
  if (status === "Em atendimento") return "running";
  if (status === "Faltou") return "missed";
  if (status === "Cancelado") return "cancelled";
  return null;
}

export function appointmentDateKey(item: Pick<AppointmentListItem, "date" | "dateKey">) {
  if (item.dateKey) return item.dateKey;
  const [day, month, year] = item.date.split("/");
  return day && month && year ? `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}` : "";
}

function sortValue(item: AppointmentListItem) {
  return `${appointmentDateKey(item)}T${item.time}`;
}

export function appointmentGroupCounts(items: AppointmentListItem[]): Record<AppointmentGroupFilter, number> {
  const counts: Record<AppointmentGroupFilter, number> = { all: items.length, upcoming: 0, done: 0, running: 0, missed: 0, cancelled: 0 };
  for (const item of items) {
    const group = appointmentGroup(item.status);
    if (group) counts[group] += 1;
  }
  return counts;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
}

export function filterAppointments<T extends AppointmentListItem>(items: T[], filters: AppointmentFilters): T[] {
  const search = normalize(filters.search.trim());
  return items.filter((item) => {
    if (filters.group !== "all" && appointmentGroup(item.status) !== filters.group) return false;
    const day = appointmentDateKey(item);
    if (filters.from && (!day || day < filters.from)) return false;
    if (filters.to && (!day || day > filters.to)) return false;
    if (search && !normalize(`${item.procedure} ${item.notes ?? ""} ${item.professional}`).includes(search)) return false;
    return true;
  });
}

// "smart": em atendimento primeiro, depois os próximos em ordem crescente e, por fim, os passados do mais recente ao mais antigo.
export function sortAppointments<T extends AppointmentListItem>(items: T[], mode: AppointmentSort): T[] {
  const copy = [...items];
  if (mode === "recent") return copy.sort((left, right) => sortValue(right).localeCompare(sortValue(left)));
  if (mode === "oldest") return copy.sort((left, right) => sortValue(left).localeCompare(sortValue(right)));
  const rank = (item: T) => item.status === "Em atendimento" ? 0 : item.status === "Agendado" ? 1 : 2;
  return copy.sort((left, right) => {
    const difference = rank(left) - rank(right);
    if (difference) return difference;
    return rank(left) === 2 ? sortValue(right).localeCompare(sortValue(left)) : sortValue(left).localeCompare(sortValue(right));
  });
}

export function paginateAppointments<T>(items: T[], page: number, pageSize: number) {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  return { page: current, pages, items: items.slice((current - 1) * pageSize, current * pageSize) };
}

// A Agenda não guarda o tipo; ele é derivado do nome ("Retorno - X", "Avaliação ...").
export function appointmentKind(procedure: string): AppointmentKind {
  const name = normalize(procedure.trim());
  if (name.startsWith("retorno")) return "Retorno";
  if (name.startsWith("avaliacao")) return "Avaliação";
  return "Procedimento";
}

export function appointmentWeekday(dateKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return "";
  const date = new Date(`${dateKey}T12:00:00-03:00`);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "America/Sao_Paulo" }).format(date);
}
