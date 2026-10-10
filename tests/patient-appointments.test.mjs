import assert from "node:assert/strict";
import { test } from "node:test";
import { mergePatientAppointments, procedureCardScheduleAction } from "../src/lib/patient-appointments.ts";

test("newly created appointments appear immediately without duplicating refreshed history", () => {
  const existing = [{ id: "appointment-1", procedure: "Limpeza" }];
  const created = { id: "appointment-2", procedure: "Retorno - Limpeza" };

  assert.deepEqual(mergePatientAppointments(existing, [created]), [...existing, created]);
  assert.deepEqual(mergePatientAppointments([...existing, created], [created]), [...existing, created]);
});

test("procedure card schedules its own procedure or return without an ambiguous picker", () => {
  assert.deepEqual(procedureCardScheduleAction("Aguardando foto", true, false), { kind: "procedure", label: "Marcar procedimento", disabled: false });
  assert.deepEqual(procedureCardScheduleAction("Realizado", false, true), { kind: "return", label: "Marcar retorno", disabled: false });
  assert.deepEqual(procedureCardScheduleAction("Realizado", false, false), { kind: "return", label: "Retorno marcado", disabled: true });
});
