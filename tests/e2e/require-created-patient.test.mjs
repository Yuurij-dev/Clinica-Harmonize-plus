import assert from "node:assert/strict";
import test from "node:test";
import { requireCreatedPatient } from "./require-created-patient.mjs";

test("requireCreatedPatient devolve o paciente criado", () => {
  const patient = { id: "patient-1", name: "Teste" };
  assert.equal(requireCreatedPatient({ status: 201, data: { patient } }, "Teste"), patient);
});

test("requireCreatedPatient preserva a mensagem original quando a API falha", () => {
  assert.throws(() => requireCreatedPatient({ status: 503, data: { message: "Banco de dados indisponivel" } }, "RelUi aa"), (error) => error.message.includes("503") && error.message.includes("Banco de dados indisponivel"));
});

test("requireCreatedPatient explica quando a resposta nao contem paciente", () => {
  assert.throws(() => requireCreatedPatient({ status: 201, data: {} }, "RelUi pay"), (error) => error.message.includes("a resposta nao trouxe patient.id"));
});
