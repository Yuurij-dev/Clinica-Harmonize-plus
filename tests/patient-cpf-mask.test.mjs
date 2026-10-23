import assert from "node:assert/strict";
import { test } from "node:test";
import { canSeeFullCpf, cpfForRole, isMaskedCpf, maskCpf, patientsForRole } from "../src/lib/patient-cpf-mask.ts";

test("maskCpf keeps only the last two digits, with or without punctuation", () => {
  assert.equal(maskCpf("123.456.789-12"), "***.***.***-12");
  assert.equal(maskCpf("12345678912"), "***.***.***-12");
  assert.equal(maskCpf(null), null);
  assert.equal(maskCpf(""), "");
});

test("only ADMIN and PROFESSIONAL see the full CPF; unknown roles are masked", () => {
  assert.equal(canSeeFullCpf("ADMIN"), true);
  assert.equal(canSeeFullCpf("PROFESSIONAL"), true);
  assert.equal(canSeeFullCpf("STAFF"), false);
  assert.equal(canSeeFullCpf(undefined), false);
});

test("cpfForRole and patientsForRole mask for STAFF and do not mutate the input", () => {
  const patient = { id: "p1", name: "Ana", cpf: "123.456.789-12" };
  assert.deepEqual(cpfForRole("STAFF", patient), { id: "p1", name: "Ana", cpf: "***.***.***-12" });
  assert.equal(patient.cpf, "123.456.789-12");
  assert.equal(cpfForRole("ADMIN", patient), patient);
  assert.equal(cpfForRole("PROFESSIONAL", patient), patient);
  assert.deepEqual(cpfForRole("STAFF", { cpf: null }), { cpf: null });
  assert.equal(cpfForRole("STAFF", null), null);
  assert.deepEqual(patientsForRole("STAFF", [patient, { id: "p2", cpf: null }]).map((p) => p.cpf), ["***.***.***-12", null]);
  assert.equal(patientsForRole("ADMIN", [patient])[0], patient);
});

test("isMaskedCpf detects masked values so they are never persisted", () => {
  assert.equal(isMaskedCpf("***.***.***-12"), true);
  assert.equal(isMaskedCpf("123.456.789-12"), false);
  assert.equal(isMaskedCpf(""), false);
  assert.equal(isMaskedCpf(undefined), false);
});
