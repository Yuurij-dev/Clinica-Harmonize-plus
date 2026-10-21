import assert from "node:assert/strict";
import { test } from "node:test";
import { appointmentDay, appointmentHasPassed, appointmentInstant, appointmentSlotError, appointmentWithinStartWindow, canRequestAppointmentStart, clinicNow, latestAppointmentStart, matchesProcedureAppointment, parseAppointmentDay } from "../src/lib/clinic-time.ts";

const appointment = { date: "10/10/2026", time: "14:00" };

test("return appointments stay inside clinic hours and allow enough time for the session", () => {
  const now = { date: "2026-10-14", minutes: 12 * 60 };
  assert.equal(appointmentSlotError("2026-10-15", "22:47", "08:00", "19:00", now), "Escolha um horário dentro do funcionamento da clínica (08:00 às 18:00).");
  assert.equal(appointmentSlotError("2026-10-15", "18:00", "08:00", "19:00", now), null);
  assert.equal(appointmentSlotError("2026-10-15", "18:01", "08:00", "19:00", now), "Escolha um horário dentro do funcionamento da clínica (08:00 às 18:00).");
  assert.equal(latestAppointmentStart("19:00"), "18:00");
});

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

test("appointment dates are stored at noon in the clinic time zone and read back as the same day", () => {
  const stored = appointmentInstant("2026-10-15");
  assert.equal(stored.toISOString(), "2026-10-15T15:00:00.000Z");
  assert.equal(appointmentDay(stored), "2026-10-15");
  assert.equal(appointmentDay(stored.toISOString()), "2026-10-15");
  // Agendamento antigo gravado à meia-noite UTC pela agenda: em São Paulo ainda é o dia anterior.
  assert.equal(appointmentDay(new Date("2026-10-15T00:00:00Z")), "2026-10-14");
  assert.equal(parseAppointmentDay("2026-10-15T20:00:00-03:00"), "2026-10-15");
  assert.equal(parseAppointmentDay("15/10/2026"), null);
});

test("an appointment only counts as missed after its own day and time plus tolerance", () => {
  const appointment = { date: appointmentInstant("2026-10-15"), time: "09:00" };
  assert.equal(appointmentHasPassed(appointment, { date: "2026-10-14", minutes: 23 * 60 }, 15), false);
  assert.equal(appointmentHasPassed(appointment, { date: "2026-10-15", minutes: 9 * 60 + 14 }, 15), false);
  assert.equal(appointmentHasPassed(appointment, { date: "2026-10-15", minutes: 9 * 60 + 15 }, 15), true);
  assert.equal(appointmentHasPassed(appointment, { date: "2026-10-16", minutes: 0 }, 15), true);
  assert.equal(clinicNow(new Date("2026-10-15T02:30:00Z")).date, "2026-10-14");
  assert.equal(clinicNow(new Date("2026-10-15T02:30:00Z")).minutes, 23 * 60 + 30);
});

test("fuso da clínica (America/Sao_Paulo, UTC-3 sem horário de verão desde 2019) na virada de dia", async () => {
  const { clinicNow, appointmentInstant, appointmentDay } = await import("../src/lib/clinic-time.ts");
  const { appointmentStartNow } = await import("../src/lib/procedure-session-rules.ts");
  const late = clinicNow(new Date("2026-10-21T02:30:00Z"));
  assert.deepEqual(late, { date: "2026-10-20", minutes: 23 * 60 + 30 });
  assert.deepEqual(appointmentStartNow(late), { day: "2026-10-20", time: "23:30" });
  assert.equal(appointmentDay(appointmentInstant("2026-10-20")), "2026-10-20");
  // Em novembro/janeiro não há DST: o offset segue -03:00 (03:00Z = 00:00 local).
  assert.deepEqual(clinicNow(new Date("2026-01-15T03:00:00Z")), { date: "2026-01-15", minutes: 0 });
  assert.deepEqual(clinicNow(new Date("2026-01-15T02:59:00Z")), { date: "2026-01-14", minutes: 23 * 60 + 59 });
});
