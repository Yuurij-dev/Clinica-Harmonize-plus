import assert from "node:assert/strict";
import { test } from "node:test";
import { mergePatientAppointments } from "../src/lib/patient-appointments.ts";

test("newly created appointments appear immediately without duplicating refreshed history", () => {
  const existing = [{ id: "appointment-1", procedure: "Limpeza" }];
  const created = { id: "appointment-2", procedure: "Retorno - Limpeza" };

  assert.deepEqual(mergePatientAppointments(existing, [created]), [...existing, created]);
  assert.deepEqual(mergePatientAppointments([...existing, created], [created]), [...existing, created]);
});
