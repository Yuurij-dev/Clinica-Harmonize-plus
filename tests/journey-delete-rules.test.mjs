import assert from "node:assert/strict";
import { test } from "node:test";
import { journeyDeleteDecision } from "../src/lib/journey-delete-rules.ts";
import { can } from "../src/lib/permissions.ts";

const abilities = (role) => ({ deletePayments: can(role, "payments:delete"), deleteClinicalFiles: can(role, "clinical:delete") });
const none = { payments: 0, documents: 0, photos: 0 };

test("administrador exclui a jornada com qualquer vínculo", () => {
  assert.equal(journeyDeleteDecision(abilities("ADMIN"), { payments: 2, documents: 1, photos: 3 }).allowed, true);
  assert.equal(journeyDeleteDecision(abilities("ADMIN"), none).allowed, true);
});

test("profissional exclui só a jornada sem pagamentos, documentos e fotos", () => {
  assert.equal(journeyDeleteDecision(abilities("PROFESSIONAL"), none).allowed, true);
  for (const counts of [{ ...none, payments: 1 }, { ...none, documents: 1 }, { ...none, photos: 1 }, { payments: 1, documents: 1, photos: 1 }]) {
    const decision = journeyDeleteDecision(abilities("PROFESSIONAL"), counts);
    assert.equal(decision.allowed, false);
    assert.match(decision.message, /administrador/);
  }
});

test("a mensagem diz o que impede", () => {
  assert.match(journeyDeleteDecision(abilities("PROFESSIONAL"), { ...none, payments: 1 }).message, /pagamentos/);
  assert.match(journeyDeleteDecision(abilities("PROFESSIONAL"), { ...none, photos: 1 }).message, /documentos ou fotos/);
});

test("papel desconhecido ou atendente não passa quando há vínculo", () => {
  assert.equal(journeyDeleteDecision(abilities("STAFF"), { ...none, documents: 1 }).allowed, false);
  assert.equal(journeyDeleteDecision(abilities(undefined), { ...none, payments: 1 }).allowed, false);
});
