import assert from "node:assert/strict";
import { test } from "node:test";
import { appointmentWithinStartWindow, canRequestAppointmentStart, matchesProcedureAppointment } from "../src/lib/clinic-time.ts";

const appointment = { date: "10/10/2026", time: "14:00" };

test("procedure start window follows the clinic appointment tolerance", () => {
  assert.equal(appointmentWithinStartWindow(appointment, 15, { date: "2026-10-10", time: "13:59" }), false);
  assert.equal(appointmentWithinStartWindow(appointment, 15, { date: "2026-10-10", time: "14:00" }), true);
  assert.equal(appointmentWithinStartWindow(appointment, 15, { date: "2026-10-10", time: "14:14" }), true);
  assert.equal(appointmentWithinStartWindow(appointment, 15, { date: "2026-10-10", time: "14:15" }), false);
  assert.equal(appointmentWithinStartWindow(appointment, 15, { date: "2026-10-09", time: "14:00" }), false);
  assert.equal(appointmentWithinStartWindow(appointment, 15, { date: "2026-10-11", time: "14:00" }), false);
});

test("invalid appointment time is always outside the normal start window", () => {
  assert.equal(appointmentWithinStartWindow({ ...appointment, time: "2 PM" }, 15, { date: "2026-10-10", time: "14:00" }), false);
});

test("only exact procedure appointments can use the out-of-window start path", () => {
  const procedures = [{ name: "procedimento 1" }];
  const futureAppointment = { procedure: "procedimento 1", date: "29/10/2026", time: "14:05" };

  assert.equal(matchesProcedureAppointment(futureAppointment, procedures), true);
  assert.equal(appointmentWithinStartWindow(futureAppointment, 15, { date: "2026-10-10", time: "13:00" }), false);
  assert.equal(canRequestAppointmentStart({ ...futureAppointment, status: "Agendado" }, procedures, false, false), true);
  assert.equal(matchesProcedureAppointment({ procedure: "Retorno - procedimento 1" }, procedures), false);
  assert.equal(matchesProcedureAppointment({ procedure: "outro agendamento" }, procedures), false);
  assert.equal(canRequestAppointmentStart({ ...futureAppointment, status: "Atendido" }, procedures, false, false), false);
  assert.equal(canRequestAppointmentStart({ ...futureAppointment, status: "Em atendimento" }, procedures, false, false), false);
  assert.equal(canRequestAppointmentStart({ procedure: "Retorno - procedimento 1", status: "Agendado" }, procedures, false, false), false);
  assert.equal(canRequestAppointmentStart({ ...futureAppointment, status: "Agendado" }, procedures, false, true), false);
});
