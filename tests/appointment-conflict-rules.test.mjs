import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appointmentDurationMinutes, appointmentOccupiesSlot, appointmentRange, conflictSearchWindow, findScheduleConflict, professionalKey, rangesOverlap, scheduleConflictMessage,
} from "../src/lib/appointment-conflict-rules.ts";

const existing = (overrides = {}) => ({ id: "a1", day: "2026-10-22", time: "10:00", durationMinutes: 60, status: "Agendado", professional: "Dra. Ana", patientId: "p1", procedure: "Botox", ...overrides });
const candidate = (overrides = {}) => ({ day: "2026-10-22", time: "10:30", durationMinutes: 60, professional: "Dra. Ana", patientId: "p2", ...overrides });

test("partial, contained and identical ranges conflict; adjacent ones do not", () => {
  const base = [existing()];
  assert.equal(findScheduleConflict(candidate({ time: "10:30" }), base)?.kind, "professional"); // parcial (depois)
  assert.equal(findScheduleConflict(candidate({ time: "09:30" }), base)?.kind, "professional"); // parcial (antes)
  assert.equal(findScheduleConflict(candidate({ time: "10:15", durationMinutes: 15 }), base)?.kind, "professional"); // contida
  assert.equal(findScheduleConflict(candidate({ time: "09:00", durationMinutes: 180 }), base)?.kind, "professional"); // contém
  assert.equal(findScheduleConflict(candidate({ time: "10:00" }), base)?.kind, "professional"); // idêntica
  assert.equal(findScheduleConflict(candidate({ time: "11:00" }), base), null); // começa quando o outro termina
  assert.equal(findScheduleConflict(candidate({ time: "09:00" }), base), null); // termina quando o outro começa
});

test("duration comes from the procedure with a 60 minute fallback", () => {
  assert.equal(appointmentDurationMinutes(45), 45);
  for (const invalid of [undefined, null, 0, -5, Number.NaN]) assert.equal(appointmentDurationMinutes(invalid), 60);
  const base = [existing({ durationMinutes: 30 })];
  assert.equal(findScheduleConflict(candidate({ time: "10:30", durationMinutes: 30 }), base), null);
  assert.equal(findScheduleConflict(candidate({ time: "10:29", durationMinutes: 30 }), base)?.kind, "professional");
  const range = appointmentRange("2026-10-22", "10:00", undefined);
  assert.equal(range.end - range.start, 60 * 60_000);
});

test("only statuses that hold the slot conflict", () => {
  for (const status of ["Agendado", "Em atendimento", "Atendido", "Finalizado"]) {
    assert.equal(appointmentOccupiesSlot(status), true, status);
    assert.ok(findScheduleConflict(candidate(), [existing({ status })]), status);
  }
  for (const status of ["Cancelado", "Faltou", "Outro"]) {
    assert.equal(appointmentOccupiesSlot(status), false, status);
    assert.equal(findScheduleConflict(candidate(), [existing({ status })]), null, status);
  }
});

test("professional is compared normalized and a missing professional never conflicts", () => {
  assert.equal(professionalKey("  Dra.   ANA "), "dra. ana");
  assert.equal(findScheduleConflict(candidate({ professional: " dra.  ana" }), [existing()])?.kind, "professional");
  assert.equal(findScheduleConflict(candidate({ professional: "Dr. Bruno" }), [existing()]), null);
  assert.equal(findScheduleConflict(candidate({ professional: "  " }), [existing({ professional: "" })]), null);
});

test("patient conflicts by patientId, even with another professional; no patientId never conflicts by patient", () => {
  const conflict = findScheduleConflict(candidate({ patientId: "p1", professional: "Dr. Bruno" }), [existing()]);
  assert.equal(conflict?.kind, "patient");
  assert.equal(findScheduleConflict(candidate({ patientId: "p3", professional: "Dr. Bruno" }), [existing()]), null);
  assert.equal(findScheduleConflict(candidate({ patientId: null, professional: "Dr. Bruno" }), [existing({ patientId: null })]), null);
  // Mesmo paciente e mesmo profissional: relata o conflito do paciente (mensagem mais útil).
  assert.equal(findScheduleConflict(candidate({ patientId: "p1" }), [existing()])?.kind, "patient");
});

test("rescheduling ignores the appointment itself", () => {
  assert.equal(findScheduleConflict(candidate({ patientId: "p1", time: "10:30", excludeId: "a1" }), [existing()]), null);
  const others = [existing(), existing({ id: "a2", time: "11:00", patientId: "p9" })];
  assert.equal(findScheduleConflict(candidate({ patientId: "p1", time: "10:30", excludeId: "a1" }), others)?.appointment.id, "a2");
});

test("different days do not conflict and midnight crossings are handled in clinic time", () => {
  assert.equal(findScheduleConflict(candidate({ day: "2026-10-23", time: "10:00" }), [existing()]), null);
  const late = [existing({ time: "23:30", durationMinutes: 120 })];
  assert.equal(findScheduleConflict(candidate({ day: "2026-10-23", time: "00:30", durationMinutes: 30 }), late)?.kind, "professional");
  assert.equal(findScheduleConflict(candidate({ day: "2026-10-23", time: "01:30" }), late), null);
  assert.equal(appointmentRange("2026-10-22", "24:00", 60), null);
  assert.equal(appointmentRange("2026-02-30", "10:00", 60), null);
  // 10:00 em São Paulo = 13:00 UTC.
  assert.equal(new Date(appointmentRange("2026-10-22", "10:00", 60).start).toISOString(), "2026-10-22T13:00:00.000Z");
  const window = conflictSearchWindow("2026-10-22");
  assert.equal(window.from.toISOString(), "2026-10-21T03:00:00.000Z");
  assert.equal(window.to.toISOString(), "2026-10-24T03:00:00.000Z");
  assert.equal(rangesOverlap({ start: 0, end: 10 }, { start: 10, end: 20 }), false);
});

test("messages are clear and do not leak another patient through a professional conflict", () => {
  const byProfessional = findScheduleConflict(candidate(), [existing({ procedure: "Preenchimento labial" })]);
  const professionalMessage = scheduleConflictMessage(byProfessional, "Dra. Ana");
  assert.match(professionalMessage, /Dra\. Ana já possui um atendimento neste horário/);
  assert.match(professionalMessage, /22\/10 às 10:00–11:00/);
  assert.doesNotMatch(professionalMessage, /Preenchimento|p1/);
  const byPatient = findScheduleConflict(candidate({ patientId: "p1", professional: "Dr. Bruno" }), [existing()]);
  assert.match(scheduleConflictMessage(byPatient, "Dr. Bruno"), /O paciente já tem outro agendamento neste horário: Botox, em 22\/10 às 10:00–11:00/);
});

test("PATCH only re-checks the slot when it starts occupying or the slot changes", async () => {
  const { appointmentNeedsConflictCheck } = await import("../src/lib/appointment-conflict-rules.ts");
  const base = { status: "Agendado", day: "2026-10-22", time: "10:00", procedure: "Botox", professional: "Dra. Ana" };
  assert.equal(appointmentNeedsConflictCheck(base, { ...base }), false); // nada mudou
  assert.equal(appointmentNeedsConflictCheck(base, { ...base, status: "Em atendimento" }), false); // ocupa -> ocupa
  assert.equal(appointmentNeedsConflictCheck(base, { ...base, status: "Atendido" }), false);
  assert.equal(appointmentNeedsConflictCheck(base, { ...base, professional: "  DRA.  ana " }), false); // mesmo profissional normalizado
  for (const change of [{ day: "2026-10-23" }, { time: "10:30" }, { procedure: "Peeling" }, { professional: "Dr. Bruno" }]) {
    assert.equal(appointmentNeedsConflictCheck(base, { ...base, ...change }), true, JSON.stringify(change));
  }
  for (const status of ["Cancelado", "Faltou"]) {
    assert.equal(appointmentNeedsConflictCheck({ ...base, status }, { ...base, status }), false); // continua liberando
    assert.equal(appointmentNeedsConflictCheck(base, { ...base, status, time: "11:00" }), false); // passa a liberar
    assert.equal(appointmentNeedsConflictCheck({ ...base, status }, { ...base, status: "Agendado" }), true); // reativação
    assert.equal(appointmentNeedsConflictCheck({ ...base, status }, { ...base, status: "Atendido" }), true);
  }
});
