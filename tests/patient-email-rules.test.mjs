import assert from "node:assert/strict";
import { test } from "node:test";
import { patientEmailsAllowed } from "../src/lib/patient-email-rules.ts";

test("e-mails ao paciente: so bloqueia quando a chave esta explicitamente desligada", () => {
  assert.equal(patientEmailsAllowed({ patientEmailsEnabled: true }), true);
  assert.equal(patientEmailsAllowed({ patientEmailsEnabled: false }), false);
  assert.equal(patientEmailsAllowed({}), true);
  assert.equal(patientEmailsAllowed({ patientEmailsEnabled: null }), true);
  assert.equal(patientEmailsAllowed(null), true);
});
