import assert from "node:assert/strict";
import { test } from "node:test";
import { appointmentHasEnded, overdueLimit, selectOverdue } from "../src/lib/agenda-overdue-rules.ts";

const now = { date: "2026-10-22", minutes: 14 * 60 };

test("an appointment has ended only when start + duration is in the past", () => {
  assert.equal(appointmentHasEnded("2026-10-22", "12:00", 60, now), true);
  assert.equal(appointmentHasEnded("2026-10-22", "13:00", 60, now), true, "fim exatamente agora");
  assert.equal(appointmentHasEnded("2026-10-22", "13:30", 60, now), false, "começou mas não terminou");
  assert.equal(appointmentHasEnded("2026-10-22", "13:30", 30, now), true);
  assert.equal(appointmentHasEnded("2026-10-22", "13:00", 90, now), false, "duração real maior");
  assert.equal(appointmentHasEnded("2026-10-21", "09:00", 60, now), true);
  assert.equal(appointmentHasEnded("2026-10-23", "09:00", 60, now), false);
});

test("duration that crosses midnight ends on the next day", () => {
  assert.equal(appointmentHasEnded("2026-10-21", "23:30", 90, { date: "2026-10-22", minutes: 30 }), false);
  assert.equal(appointmentHasEnded("2026-10-21", "23:30", 90, { date: "2026-10-22", minutes: 60 }), true);
  assert.equal(appointmentHasEnded("2026-12-31", "23:00", 120, { date: "2027-01-01", minutes: 30 }), false);
  assert.equal(appointmentHasEnded("2026-12-31", "23:00", 120, { date: "2027-01-01", minutes: 60 }), true);
});

test("invalid day or time never counts as overdue", () => {
  assert.equal(appointmentHasEnded("2026-10-22", "9:00", 60, now), false);
  assert.equal(appointmentHasEnded("22/10/2026", "09:00", 60, now), false);
});

const row = (id, day, time, status = "Agendado", procedure = "Retorno") => ({ id, date: new Date(`${day}T15:00:00.000Z`), time, status, procedure });

test("only Agendado appointments are selected, oldest first, with the real duration", () => {
  const rows = [
    row("b", "2026-10-20", "10:00"), row("a", "2026-10-19", "15:00"), row("c", "2026-10-20", "09:00"),
    row("andamento", "2026-10-01", "09:00", "Em atendimento"), row("feito", "2026-10-01", "09:00", "Atendido"),
    row("cancelado", "2026-10-01", "09:00", "Cancelado"), row("faltou", "2026-10-01", "09:00", "Faltou"),
    row("futuro", "2026-10-30", "09:00"), row("longo", "2026-10-22", "13:00", "Agendado", "Longo"),
    row("hoje", "2026-10-22", "12:30"),
  ];
  const durationOf = (procedure) => procedure === "Longo" ? 120 : 60;
  assert.deepEqual(selectOverdue(rows, durationOf, now).map((item) => item.id), ["a", "c", "b", "hoje"]);
});

test("the list is capped at 200 keeping the oldest", () => {
  const rows = Array.from({ length: 250 }, (_, index) => row(`r${index}`, "2026-01-01", `${String(Math.floor(index / 60) + 6).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}`));
  const selected = selectOverdue([...rows].reverse(), () => 60, now);
  assert.equal(overdueLimit, 200);
  assert.equal(selected.length, 200);
  assert.equal(selected[0].id, "r0");
  assert.equal(selected[199].id, "r199");
});
