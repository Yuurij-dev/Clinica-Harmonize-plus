import assert from "node:assert/strict";
import test from "node:test";
import { canRunAgendaAutomation } from "../src/lib/agenda-automation-rules.ts";

test("automação da agenda só com acesso completo e recurso do plano", () => {
  assert.equal(canRunAgendaAutomation({ mode: "full", features: ["agendaAutomations"] }), true);
  assert.equal(canRunAgendaAutomation({ mode: "readonly", features: ["agendaAutomations"] }), false);
  assert.equal(canRunAgendaAutomation({ mode: "full", features: [] }), false);
  assert.equal(canRunAgendaAutomation(undefined), false);
});
