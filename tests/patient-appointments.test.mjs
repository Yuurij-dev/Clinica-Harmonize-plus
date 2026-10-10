import assert from "node:assert/strict";
import { test } from "node:test";
import { assignProcedureAppointmentsToCards, mergePatientAppointments, procedureCardScheduleAction } from "../src/lib/patient-appointments.ts";

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

test("a grouped card appointment is assigned only to the most specific matching card", () => {
  const appointments = [
    { procedure: "Botox", status: "Atendido" },
    { procedure: "Preenchimento", status: "Agendado" },
  ];
  const names = [{ name: "Botox" }, { name: "Preenchimento" }];
  const cards = [{ name: "Botox (1x), Preenchimento (1x)" }, { name: "Preenchimento (1x)" }];

  assert.deepEqual(assignProcedureAppointmentsToCards(appointments, cards, names), [appointments[0], appointments[1]]);
  assert.deepEqual(assignProcedureAppointmentsToCards([appointments[1]], cards, names), [undefined, appointments[1]]);
  assert.deepEqual(assignProcedureAppointmentsToCards([appointments[1]], [{ name: "Botoxyl (1x)" }], names), [undefined]);
});
