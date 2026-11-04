import assert from "node:assert/strict";
import { test } from "node:test";
import { appointmentsForAutomaticTransitions, missedDeadline } from "../src/lib/appointment-automation-rules.ts";
import { appointmentHasPassed, appointmentInstant } from "../src/lib/clinic-time.ts";

const before = new Date("2026-10-15T11:00:00Z"); // 08:00 em São Paulo, antes do prazo
const appointments = [
  { id: "missed", date: appointmentInstant("2026-10-15"), time: "09:00", status: "Agendado", updatedAt: before },
  { id: "running", date: appointmentInstant("2026-10-15"), time: "09:00", status: "Em atendimento", updatedAt: before },
  { id: "future", date: appointmentInstant("2026-10-15"), time: "10:00", status: "Agendado", updatedAt: before },
  { id: "finished", date: appointmentInstant("2026-10-15"), time: "08:00", status: "Atendido", updatedAt: before },
];
const now = { date: "2026-10-15", minutes: 10 * 60 + 1 };
const settings = (overrides = {}) => ({ autoMarkMissedAppointmentsEnabled: true, appointmentToleranceMinutes: 15, ...overrides });

test("only scheduled appointments past the tolerance become absences; running ones are never touched", () => {
  const result = appointmentsForAutomaticTransitions(appointments, settings(), now, appointmentHasPassed);
  assert.deepEqual(result.missed.map(({ id }) => id), ["missed"]);
  assert.equal("completed" in result, false);
  assert.deepEqual(appointmentsForAutomaticTransitions(appointments, settings({ autoMarkMissedAppointmentsEnabled: false }), now, appointmentHasPassed).missed, []);
});

test("absence waits for the clinic tolerance", () => {
  const result = appointmentsForAutomaticTransitions(appointments, settings(), { date: "2026-10-15", minutes: 9 * 60 + 14 }, appointmentHasPassed);
  assert.deepEqual(result.missed, []);
});

test("the deadline is start plus tolerance in clinic time", () => {
  assert.equal(missedDeadline(appointments[0], 15).toISOString(), "2026-10-15T12:15:00.000Z");
});

test("a human change after the deadline is permanent", () => {
  const corrected = { ...appointments[0], updatedAt: new Date("2026-10-15T12:30:00Z") }; // 09:30, depois de 09:15
  assert.deepEqual(appointmentsForAutomaticTransitions([corrected], settings(), now, appointmentHasPassed).missed, []);
  const atDeadline = { ...appointments[0], updatedAt: new Date("2026-10-15T12:15:00Z") };
  assert.equal(appointmentsForAutomaticTransitions([atDeadline], settings(), now, appointmentHasPassed).missed.length, 1);
});

test("rescheduling to a future date moves the deadline and the rule applies again", () => {
  const rescheduled = { ...appointments[0], date: appointmentInstant("2026-10-16"), updatedAt: new Date("2026-10-15T12:30:00Z") };
  assert.deepEqual(appointmentsForAutomaticTransitions([rescheduled], settings(), now, appointmentHasPassed).missed, []);
  const later = { date: "2026-10-16", minutes: 9 * 60 + 16 };
  assert.equal(appointmentsForAutomaticTransitions([rescheduled], settings(), later, appointmentHasPassed).missed.length, 1);
});

test("optimistic write matches updatedAt by a 1 ms range so microseconds still match", async () => {
  const { optimisticUpdatedAt } = await import("../src/lib/appointment-automation-rules.ts");
  const { updatedAt } = optimisticUpdatedAt(new Date("2026-10-15T12:00:00.123Z"));
  assert.equal(updatedAt.gte.toISOString(), "2026-10-15T12:00:00.123Z");
  assert.equal(updatedAt.lt.toISOString(), "2026-10-15T12:00:00.124Z");
});

test("deadline equals the SQL formula: clinic-day + time in -03:00 plus tolerance", () => {
  // 09:00 (tolerância 15) em São Paulo = 12:15Z, incluindo agendamento salvo como meio-dia -03:00.
  assert.equal(missedDeadline({ date: appointmentInstant("2026-01-31"), time: "09:00" }, 15).toISOString(), "2026-01-31T12:15:00.000Z");
  assert.equal(missedDeadline({ date: appointmentInstant("2026-06-01"), time: "23:50" }, 15).toISOString(), "2026-06-02T03:05:00.000Z");
});
