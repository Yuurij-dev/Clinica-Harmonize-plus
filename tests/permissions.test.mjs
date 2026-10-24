import assert from "node:assert/strict";
import { test } from "node:test";
import { appointmentDeleteAllowed, appointmentStatusChangeAllowed, can, observationKindsFor, quoteChangeAllowed, quoteProfessional, visibleSections } from "../src/lib/permissions.ts";

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
  assert.deepEqual(visibleSections("ADMIN"), ["dashboard", "agenda", "clientes", "procedimentos", "estoque", "compras", "orcamentos", "pagamentos", "financeiro", "relatorios", "calculadora", "configuracoes"]);
  assert.deepEqual(visibleSections("PROFESSIONAL"), ["agenda", "clientes", "orcamentos"]);
  assert.deepEqual(visibleSections("STAFF"), ["agenda", "clientes", "orcamentos", "pagamentos"]);
  assert.equal(visibleSections("STAFF").includes("financeiro"), false);
  assert.equal(visibleSections("STAFF").includes("estoque"), false);
  assert.equal(visibleSections("STAFF").includes("compras"), false);
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
  assert.equal(quoteChangeAllowed("STAFF", { current: "Pago", next: "Aprovado", editsContent: false }), false);
  assert.equal(quoteChangeAllowed("STAFF", { current: "Aprovado", next: "Aprovado", editsContent: false }), true);
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

const runStates = ["Em atendimento", "Atendido", "Finalizado"];

test("agendamento: atendente nunca inicia, finaliza nem mexe em atendimento em curso ou concluído", () => {
  for (const next of runStates) assert.equal(appointmentStatusChangeAllowed("STAFF", "Agendado", next), false, `para ${next}`);
  for (const current of runStates) {
    for (const next of [undefined, current, "Agendado", "Faltou", "Cancelado", "Qualquer"]) {
      assert.equal(appointmentStatusChangeAllowed("STAFF", current, next), false, `${current} -> ${next}`);
    }
  }
});

test("agendamento: atendente remarca (sem status), marca falta e cancela o que ainda não rodou", () => {
  assert.equal(appointmentStatusChangeAllowed("STAFF", "Agendado", undefined), true);
  assert.equal(appointmentStatusChangeAllowed("STAFF", "Agendado", "Agendado"), true);
  assert.equal(appointmentStatusChangeAllowed("STAFF", "Agendado", "Faltou"), true);
  assert.equal(appointmentStatusChangeAllowed("STAFF", "Agendado", "Cancelado"), true);
  assert.equal(appointmentStatusChangeAllowed("STAFF", "Faltou", "Agendado"), true);
  assert.equal(appointmentStatusChangeAllowed("STAFF", "Agendado", "Inventado"), false);
});

test("agendamento: administrador e profissional seguem livres; papel desconhecido nunca", () => {
  for (const role of ["ADMIN", "PROFESSIONAL"]) {
    assert.equal(appointmentStatusChangeAllowed(role, "Atendido", "Agendado"), true);
    assert.equal(appointmentStatusChangeAllowed(role, "Agendado", "Em atendimento"), true);
    assert.equal(appointmentDeleteAllowed(role, "Atendido"), true);
  }
  for (const role of [undefined, null, "", "OUTRO"]) {
    assert.equal(appointmentStatusChangeAllowed(role, "Agendado", "Faltou"), false);
    assert.equal(appointmentDeleteAllowed(role, "Agendado"), false);
  }
});

test("agendamento: atendente exclui só o que ainda não rodou", () => {
  assert.equal(appointmentDeleteAllowed("STAFF", "Agendado"), true);
  assert.equal(appointmentDeleteAllowed("STAFF", "Faltou"), true);
  assert.equal(appointmentDeleteAllowed("STAFF", "Cancelado"), true);
  for (const current of runStates) assert.equal(appointmentDeleteAllowed("STAFF", current), false, current);
});

test("anamnese: conteúdo só para administrador e profissional; atendente não lê nem grava", () => {
  for (const permission of ["anamnesis:read", "anamnesis:write"]) {
    assert.equal(can("ADMIN", permission), true, `ADMIN ${permission}`);
    assert.equal(can("PROFESSIONAL", permission), true, `PROFESSIONAL ${permission}`);
    assert.equal(can("STAFF", permission), false, `STAFF ${permission}`);
    assert.equal(can(undefined, permission), false);
  }
});
