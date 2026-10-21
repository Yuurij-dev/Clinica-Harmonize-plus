import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appointmentDateKey, appointmentGroup, appointmentGroupCounts, appointmentKind, appointmentWeekday, defaultAppointmentFilters,
  filterAppointments, paginateAppointments, sortAppointments,
} from "../src/lib/appointment-list-rules.ts";

const item = (id, status, date, time, extra = {}) => ({ id, status, date, time, procedure: "Botox", professional: "Dra. Ana", notes: "", ...extra });
const items = [
  item("a", "Agendado", "25/10/2026", "10:00"),
  item("b", "Agendado", "22/10/2026", "09:00", { procedure: "Retorno - Botox", notes: "Avaliar resultado" }),
  item("c", "Atendido", "10/10/2026", "14:00"),
  item("d", "Finalizado", "12/10/2026", "08:00"),
  item("e", "Em atendimento", "20/10/2026", "11:00"),
  item("f", "Faltou", "05/10/2026", "15:00"),
  item("g", "Cancelado", "01/10/2026", "16:00", { procedure: "Avaliação inicial" }),
];

test("status reais da Agenda caem nos grupos certos", () => {
  assert.equal(appointmentGroup("Agendado"), "upcoming");
  assert.equal(appointmentGroup("Atendido"), "done");
  assert.equal(appointmentGroup("Finalizado"), "done");
  assert.equal(appointmentGroup("Em atendimento"), "running");
  assert.equal(appointmentGroup("Faltou"), "missed");
  assert.equal(appointmentGroup("Cancelado"), "cancelled");
  assert.equal(appointmentGroup("Outro"), null);
  assert.deepEqual(appointmentGroupCounts(items), { all: 7, upcoming: 2, done: 2, running: 1, missed: 1, cancelled: 1 });
});

test("filtros por grupo, período e busca sem acento", () => {
  const all = { ...defaultAppointmentFilters, group: "all" };
  assert.equal(filterAppointments(items, defaultAppointmentFilters).length, 2);
  assert.equal(filterAppointments(items, { ...all, group: "done" }).length, 2);
  assert.deepEqual(filterAppointments(items, { ...all, from: "2026-10-10", to: "2026-10-20" }).map((entry) => entry.id), ["c", "d", "e"]);
  assert.deepEqual(filterAppointments(items, { ...all, search: "AVALIAR" }).map((entry) => entry.id), ["b"]);
  assert.deepEqual(filterAppointments(items, { ...all, search: "avaliacao" }).map((entry) => entry.id), ["g"]);
  assert.equal(filterAppointments(items, { ...all, search: "inexistente" }).length, 0);
});

test("ordenação padrão: em atendimento, próximos crescentes, passados do mais recente", () => {
  assert.deepEqual(sortAppointments(items, "smart").map((entry) => entry.id), ["e", "b", "a", "d", "c", "f", "g"]);
  assert.deepEqual(sortAppointments(items, "recent").map((entry) => entry.id), ["a", "b", "e", "d", "c", "f", "g"]);
  assert.deepEqual(sortAppointments(items, "oldest").map((entry) => entry.id), ["g", "f", "c", "d", "e", "b", "a"]);
});

test("paginação limita a página e preserva o total de páginas", () => {
  const many = Array.from({ length: 20 }, (_, index) => index);
  assert.deepEqual(paginateAppointments(many, 1, 9).items.length, 9);
  assert.equal(paginateAppointments(many, 3, 9).items.length, 2);
  assert.equal(paginateAppointments(many, 9, 9).page, 3);
  assert.equal(paginateAppointments([], 1, 9).pages, 1);
});

test("tipo derivado do nome, chave de data e dia da semana", () => {
  assert.equal(appointmentKind("Retorno - Botox"), "Retorno");
  assert.equal(appointmentKind("Avaliação inicial"), "Avaliação");
  assert.equal(appointmentKind("Botox"), "Procedimento");
  assert.equal(appointmentDateKey({ date: "05/10/2026" }), "2026-10-05");
  assert.equal(appointmentDateKey({ date: "05/10/2026", dateKey: "2026-10-06" }), "2026-10-06");
  assert.equal(appointmentWeekday("2026-10-20"), "terça-feira");
  assert.equal(appointmentWeekday(""), "");
});
