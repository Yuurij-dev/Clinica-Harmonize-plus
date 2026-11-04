import assert from "node:assert/strict";
import { test } from "node:test";
import { appointmentsForAutomaticTransitions } from "../src/lib/appointment-automation-rules.ts";
import { appointmentHasPassed, appointmentInstant } from "../src/lib/clinic-time.ts";

const appointments = [
  { id: "missed", date: appointmentInstant("2026-10-15"), time: "09:00", status: "Agendado", durationMinutes: 60 },
  { id: "running-ended", date: appointmentInstant("2026-10-15"), time: "09:00", status: "Em atendimento", durationMinutes: 60 },
  { id: "running-active", date: appointmentInstant("2026-10-15"), time: "10:00", status: "Em atendimento", durationMinutes: 60 },
  { id: "finished", date: appointmentInstant("2026-10-15"), time: "08:00", status: "Atendido", durationMinutes: 60 },
];
const now = { date: "2026-10-15", minutes: 10 * 60 + 1 };

test("automatic absence and completion transitions follow their clinic switches", () => {
  const enabled = appointmentsForAutomaticTransitions(appointments, { autoMarkMissedAppointmentsEnabled: true, autoCompleteAppointmentsEnabled: true, appointmentToleranceMinutes: 15 }, now, appointmentHasPassed);
  assert.deepEqual(enabled.missed.map(({ id }) => id), ["missed"]);
  assert.deepEqual(enabled.completed.map(({ id }) => id), ["running-ended"]);

  const disabled = appointmentsForAutomaticTransitions(appointments, { autoMarkMissedAppointmentsEnabled: false, autoCompleteAppointmentsEnabled: false, appointmentToleranceMinutes: 15 }, now, appointmentHasPassed);
  assert.deepEqual(disabled.missed, []);
  assert.deepEqual(disabled.completed, []);

  const onlyAbsenceDisabled = appointmentsForAutomaticTransitions(appointments, { autoMarkMissedAppointmentsEnabled: false, autoCompleteAppointmentsEnabled: true, appointmentToleranceMinutes: 15 }, now, appointmentHasPassed);
  assert.deepEqual(onlyAbsenceDisabled.missed, []);
  assert.deepEqual(onlyAbsenceDisabled.completed.map(({ id }) => id), ["running-ended"]);

  const onlyCompletionDisabled = appointmentsForAutomaticTransitions(appointments, { autoMarkMissedAppointmentsEnabled: true, autoCompleteAppointmentsEnabled: false, appointmentToleranceMinutes: 15 }, now, appointmentHasPassed);
  assert.deepEqual(onlyCompletionDisabled.missed.map(({ id }) => id), ["missed"]);
  assert.deepEqual(onlyCompletionDisabled.completed, []);
});

test("automatic absence waits for the clinic tolerance and completion waits for procedure duration", () => {
  const result = appointmentsForAutomaticTransitions(appointments, { autoMarkMissedAppointmentsEnabled: true, autoCompleteAppointmentsEnabled: true, appointmentToleranceMinutes: 15 }, { date: "2026-10-15", minutes: 9 * 60 + 14 }, appointmentHasPassed);
  assert.deepEqual(result.missed, []);
  assert.deepEqual(result.completed, []);
});
