import assert from "node:assert/strict";
import { test } from "node:test";
import { approvedProcedureNames } from "../src/lib/procedure-session-rules.ts";

test("approved procedure names are read from the quote details items object", () => {
  assert.deepEqual(approvedProcedureNames(JSON.stringify({ items: [{ name: "Preenchimento" }, { name: "Botox" }] })), ["Preenchimento", "Botox"]);
});

test("approved procedure names tolerate legacy arrays and malformed quote details", () => {
  assert.deepEqual(approvedProcedureNames(JSON.stringify([{ name: "Preenchimento" }])), ["Preenchimento"]);
  assert.deepEqual(approvedProcedureNames("not-json"), []);
  assert.deepEqual(approvedProcedureNames(JSON.stringify({ items: [{ procedureId: "x" }, null] })), []);
});
