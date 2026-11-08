import assert from "node:assert/strict";
import test from "node:test";
import { COLLABORATOR_NAME_MESSAGE, COLLABORATOR_PROFILE_MESSAGE, parseCollaboratorProfile } from "../src/lib/collaborator-profile-rules.ts";

const valid = { name: " Ana Souza ", cpf: "529.982.247-25", postalCode: "01310-100", address: " Rua A, 1 ", country: " Brasil ", state: " SP ", city: " São Paulo " };

test("perfil valido: normaliza (trim, so digitos)", () => {
  assert.deepEqual(parseCollaboratorProfile(valid), {
    ok: true,
    value: { name: "Ana Souza", cpf: "52998224725", postalCode: "01310100", address: "Rua A, 1", country: "Brasil", state: "SP", city: "São Paulo" },
  });
});

test("CEP e opcional (vazio vira null); informado precisa ter 8 digitos", () => {
  assert.equal(parseCollaboratorProfile({ ...valid, postalCode: "" }).value.postalCode, null);
  assert.equal(parseCollaboratorProfile({ ...valid, postalCode: undefined }).value.postalCode, null);
  assert.deepEqual(parseCollaboratorProfile({ ...valid, postalCode: "0131" }), { ok: false, message: COLLABORATOR_PROFILE_MESSAGE });
  assert.deepEqual(parseCollaboratorProfile({ ...valid, postalCode: "013101000" }), { ok: false, message: COLLABORATOR_PROFILE_MESSAGE });
});

test("CPF obrigatorio com exatamente 11 digitos", () => {
  for (const cpf of ["", undefined, "123", "11111111111", "52998224726", "1234567890", "123456789012", 12345678901, null]) {
    assert.deepEqual(parseCollaboratorProfile({ ...valid, cpf }), { ok: false, message: COLLABORATOR_PROFILE_MESSAGE }, String(cpf));
  }
});

test("endereco, pais, estado e cidade obrigatorios (so espacos conta como vazio)", () => {
  for (const field of ["address", "country", "state", "city"]) {
    for (const bad of ["", "   ", undefined, 5]) {
      assert.deepEqual(parseCollaboratorProfile({ ...valid, [field]: bad }), { ok: false, message: COLLABORATOR_PROFILE_MESSAGE }, `${field}=${String(bad)}`);
    }
  }
});

test("nome obrigatorio, trim e no maximo 100 caracteres", () => {
  for (const name of ["", "   ", undefined, 7, "a".repeat(101)]) {
    assert.deepEqual(parseCollaboratorProfile({ ...valid, name }), { ok: false, message: COLLABORATOR_NAME_MESSAGE });
  }
  assert.equal(parseCollaboratorProfile({ ...valid, name: "a".repeat(100) }).ok, true);
  assert.equal(parseCollaboratorProfile({ ...valid, name: ` ${"a".repeat(100)} ` }).ok, true);
});

test("entrada nula ou nao-objeto nao lanca", () => {
  assert.equal(parseCollaboratorProfile(null).ok, false);
  assert.equal(parseCollaboratorProfile(undefined).ok, false);
});

test("limites de tamanho: endereco ate 200; pais, estado e cidade ate 100 (mesma mensagem de dados pessoais)", () => {
  const limits = { address: 200, country: 100, state: 100, city: 100 };
  for (const [field, max] of Object.entries(limits)) {
    assert.equal(parseCollaboratorProfile({ ...valid, [field]: "a".repeat(max) }).ok, true, field);
    assert.deepEqual(parseCollaboratorProfile({ ...valid, [field]: "a".repeat(max + 1) }), { ok: false, message: COLLABORATOR_PROFILE_MESSAGE }, field);
  }
});
