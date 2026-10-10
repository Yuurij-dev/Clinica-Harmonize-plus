import assert from "node:assert/strict";
import { test } from "node:test";
import { can, observationKindsFor, quoteChangeAllowed, quoteProfessional, visibleSections } from "../src/lib/permissions.ts";

test("dados clínicos são só de administrador e profissional", () => {
  for (const permission of ["clinical:read", "clinical:write", "appointment:run", "quote:edit-closed"]) {
    assert.equal(can("ADMIN", permission), true, `ADMIN ${permission}`);
    assert.equal(can("PROFESSIONAL", permission), true, `PROFESSIONAL ${permission}`);
    assert.equal(can("STAFF", permission), false, `STAFF ${permission}`);
  }
});

test("pagamentos: atendente vê e registra, só administrador exclui, profissional segue sem acesso", () => {
  assert.equal(can("STAFF", "payments:access"), true);
  assert.equal(can("ADMIN", "payments:access"), true);
  assert.equal(can("PROFESSIONAL", "payments:access"), false);
  assert.equal(can("ADMIN", "payments:delete"), true);
  assert.equal(can("STAFF", "payments:delete"), false);
  assert.equal(can("PROFESSIONAL", "payments:delete"), false);
});

test("papel desconhecido ou ausente não tem permissão nenhuma", () => {
  for (const role of [undefined, null, "", "OWNER", "admin"]) {
    assert.equal(can(role, "clinical:read"), false);
    assert.equal(can(role, "payments:access"), false);
    assert.deepEqual(visibleSections(role), []);
    assert.deepEqual(observationKindsFor(role), []);
  }
});

test("menu por papel", () => {
  assert.equal(visibleSections("ADMIN").length, 11);
  assert.deepEqual(visibleSections("PROFESSIONAL"), ["agenda", "clientes", "orcamentos"]);
  assert.deepEqual(visibleSections("STAFF"), ["agenda", "clientes", "orcamentos", "pagamentos"]);
  assert.equal(visibleSections("STAFF").includes("financeiro"), false);
  assert.equal(visibleSections("STAFF").includes("estoque"), false);
});

test("observações: atendente só administrativas", () => {
  assert.deepEqual(observationKindsFor("STAFF"), ["administrative"]);
  assert.deepEqual(observationKindsFor("ADMIN"), ["clinical", "administrative"]);
  assert.deepEqual(observationKindsFor("PROFESSIONAL"), ["clinical", "administrative"]);
});

test("orçamento aberto: atendente edita e aprova livremente", () => {
  assert.equal(quoteChangeAllowed("STAFF", { current: "Pendente", next: "Aprovado", editsContent: true }), true);
  assert.equal(quoteChangeAllowed("STAFF", { current: "Enviado", next: undefined, editsContent: true }), true);
});

test("orçamento fechado: atendente não edita conteúdo nem reverte, mas pode marcar como pago", () => {
  assert.equal(quoteChangeAllowed("STAFF", { current: "Aprovado", next: "Pago", editsContent: false }), true);
  assert.equal(quoteChangeAllowed("STAFF", { current: "Aprovado", next: "Pendente", editsContent: false }), false);
  assert.equal(quoteChangeAllowed("STAFF", { current: "Pago", next: "Pendente", editsContent: false }), false);
  assert.equal(quoteChangeAllowed("STAFF", { current: "Aprovado", next: undefined, editsContent: true }), false);
  assert.equal(quoteChangeAllowed("STAFF", { current: "Pago", next: "Pago", editsContent: false }), true);
});

test("orçamento fechado: administrador e profissional alteram tudo", () => {
  for (const role of ["ADMIN", "PROFESSIONAL"]) {
    assert.equal(quoteChangeAllowed(role, { current: "Pago", next: "Pendente", editsContent: true }), true);
  }
});

test("papel desconhecido ou ausente nunca altera orçamento", () => {
  assert.equal(quoteChangeAllowed("OWNER", { current: "Aprovado", next: "Pago", editsContent: false }), false);
  assert.equal(quoteChangeAllowed(undefined, { current: "Pendente", next: "Aprovado", editsContent: false }), false);
});

test("procedimento gerado pelo orçamento: só quem tem papel clínico vira o profissional", () => {
  assert.equal(quoteProfessional("PROFESSIONAL", "Dra. Ana"), "Dra. Ana");
  assert.equal(quoteProfessional("ADMIN", "Dra. Ana"), "Dra. Ana");
  assert.equal(quoteProfessional("STAFF", "Maria"), "");
});
