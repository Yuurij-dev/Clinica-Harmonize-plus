import assert from "node:assert/strict";
import { test } from "node:test";
import { appointmentDeleteAllowed, appointmentStatusChangeAllowed, can, createDefaultRolePermissionMatrix, normalizeRolePermissionMatrix, observationKindsFor, permissionGroups, quoteChangeAllowed, quoteProfessional, visibleSections } from "../src/lib/permissions.ts";

test("matriz completa: administrador tem tudo, profissional atende e edita só o próprio custo, atendente fica na recepção", () => {
  const matrix = createDefaultRolePermissionMatrix();
  const permissions = permissionGroups.flatMap((group) => group.permissions.map(({ key }) => key));
  assert.equal(new Set(permissions).size, permissions.length, "cada permissão tem chave única");
  for (const permission of permissions) assert.equal(matrix.ADMIN[permission], true, `ADMIN ${permission}`);

  for (const permission of ["agenda:access", "agenda:manage", "patients:access", "patients:manage", "patients:cpf-full", "procedures:access", "clinical:read", "clinical:write", "anamnesis:read", "anamnesis:write", "appointment:run", "quotes:access", "quotes:manage", "quote:edit-closed", "settings:access", "settings:own-cost"]) {
    assert.equal(matrix.PROFESSIONAL[permission], true, `PROFESSIONAL ${permission}`);
  }
  for (const permission of ["payments:access", "payments:manage", "finance:access", "finance:manage", "settings:manage", "settings:team", "settings:permissions", "patients:delete", "clinical:delete", "stock:manage", "purchases:manage"]) {
    assert.equal(matrix.PROFESSIONAL[permission], false, `PROFESSIONAL ${permission}`);
  }

  for (const permission of ["agenda:access", "agenda:manage", "patients:access", "patients:manage"]) assert.equal(matrix.STAFF[permission], true, `STAFF ${permission}`);
  for (const permission of ["quotes:access", "quotes:manage", "payments:access", "payments:manage", "clinical:read", "clinical:write", "anamnesis:read", "anamnesis:write", "appointment:run", "appointments:delete", "patients:cpf-full", "settings:access"]) {
    assert.equal(matrix.STAFF[permission], false, `STAFF ${permission}`);
  }
  assert.deepEqual(visibleSections("PROFESSIONAL", matrix), ["agenda", "clientes", "procedimentos", "orcamentos", "configuracoes"]);
  assert.deepEqual(visibleSections("STAFF", matrix), ["agenda", "clientes"]);
});

test("alterar a matriz altera o acesso efetivo", () => {
  const matrix = createDefaultRolePermissionMatrix();
  matrix.PROFESSIONAL["clinical:read"] = false;
  matrix.STAFF["quotes:access"] = true;
  matrix.STAFF["quotes:manage"] = true;
  assert.equal(can("PROFESSIONAL", "clinical:read", matrix), false);
  assert.equal(can("STAFF", "quotes:access", matrix), true);
  assert.equal(quoteChangeAllowed("STAFF", { current: "Rascunho", editsContent: true }, matrix), true);
  assert.equal(normalizeRolePermissionMatrix({ STAFF: { "appointments:delete": true } }).STAFF["appointments:delete"], true);
});

test("dados clínicos são só de administrador e profissional", () => {
  for (const permission of ["clinical:read", "clinical:write", "appointment:run", "quote:edit-closed"]) {
    assert.equal(can("ADMIN", permission), true, `ADMIN ${permission}`);
    assert.equal(can("PROFESSIONAL", permission), true, `PROFESSIONAL ${permission}`);
    assert.equal(can("STAFF", permission), false, `STAFF ${permission}`);
  }
});

test("pagamentos: somente administrador vê e registra; profissional e atendente não acessam", () => {
  assert.equal(can("ADMIN", "payments:access"), true);
  assert.equal(can("STAFF", "payments:access"), false);
  assert.equal(can("PROFESSIONAL", "payments:access"), false);
  assert.equal(can("ADMIN", "payments:manage"), true);
  assert.equal(can("STAFF", "payments:manage"), false);
  assert.equal(can("PROFESSIONAL", "payments:manage"), false);
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
  assert.deepEqual(visibleSections("ADMIN"), ["dashboard", "agenda", "clientes", "procedimentos", "estoque", "compras", "orcamentos", "pagamentos", "financeiro", "relatorios", "configuracoes"]);
  assert.deepEqual(visibleSections("PROFESSIONAL"), ["agenda", "clientes", "procedimentos", "orcamentos", "configuracoes"]);
  assert.deepEqual(visibleSections("STAFF"), ["agenda", "clientes"]);
  assert.equal(visibleSections("STAFF").includes("financeiro"), false);
  assert.equal(visibleSections("STAFF").includes("estoque"), false);
  assert.equal(visibleSections("STAFF").includes("compras"), false);
});

test("observações: atendente só administrativas", () => {
  assert.deepEqual(observationKindsFor("STAFF"), ["administrative"]);
  assert.deepEqual(observationKindsFor("ADMIN"), ["clinical", "administrative"]);
  assert.deepEqual(observationKindsFor("PROFESSIONAL"), ["clinical", "administrative"]);
});

test("atendente sem acesso a orçamentos não consulta nem altera nenhum", () => {
  assert.equal(can("STAFF", "quotes:access"), false);
  assert.equal(quoteChangeAllowed("STAFF", { current: "Pendente", next: "Aprovado", editsContent: true }), false);
  assert.equal(quoteChangeAllowed("STAFF", { current: "Enviado", next: undefined, editsContent: true }), false);
});

test("orçamento fechado: sem permissão de gestão, atendente não altera", () => {
  assert.equal(quoteChangeAllowed("STAFF", { current: "Aprovado", next: "Pago", editsContent: false }), false);
  assert.equal(quoteChangeAllowed("STAFF", { current: "Aprovado", next: "Pendente", editsContent: false }), false);
  assert.equal(quoteChangeAllowed("STAFF", { current: "Pago", next: "Pendente", editsContent: false }), false);
  assert.equal(quoteChangeAllowed("STAFF", { current: "Aprovado", next: undefined, editsContent: true }), false);
  assert.equal(quoteChangeAllowed("STAFF", { current: "Pago", next: "Pago", editsContent: false }), false);
  assert.equal(quoteChangeAllowed("STAFF", { current: "Pago", next: "Aprovado", editsContent: false }), false);
  assert.equal(quoteChangeAllowed("STAFF", { current: "Aprovado", next: "Aprovado", editsContent: false }), false);
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

test("agendamento: administrador e profissional podem conduzir; só administrador exclui; papel desconhecido nunca", () => {
  for (const role of ["ADMIN", "PROFESSIONAL"]) {
    assert.equal(appointmentStatusChangeAllowed(role, "Atendido", "Agendado"), true);
    assert.equal(appointmentStatusChangeAllowed(role, "Agendado", "Em atendimento"), true);
  }
  assert.equal(appointmentDeleteAllowed("ADMIN", "Atendido"), true);
  assert.equal(appointmentDeleteAllowed("PROFESSIONAL", "Atendido"), false);
  for (const role of [undefined, null, "", "OUTRO"]) {
    assert.equal(appointmentStatusChangeAllowed(role, "Agendado", "Faltou"), false);
    assert.equal(appointmentDeleteAllowed(role, "Agendado"), false);
  }
});

test("atendente não exclui agendamentos", () => {
  for (const current of ["Agendado", "Faltou", "Cancelado", ...runStates]) assert.equal(appointmentDeleteAllowed("STAFF", current), false, current);
});

test("anamnese: conteúdo só para administrador e profissional; atendente não lê nem grava", () => {
  for (const permission of ["anamnesis:read", "anamnesis:write"]) {
    assert.equal(can("ADMIN", permission), true, `ADMIN ${permission}`);
    assert.equal(can("PROFESSIONAL", permission), true, `PROFESSIONAL ${permission}`);
    assert.equal(can("STAFF", permission), false, `STAFF ${permission}`);
    assert.equal(can(undefined, permission), false);
  }
});
