import assert from "node:assert/strict";
import test from "node:test";
import * as r from "../src/lib/invite-flow-rules.ts";

test("M1: senha trocada mas aceite falhou => volta ao signin com mensagem; sem troca => fica; tudo ok => done", () => {
  assert.deepEqual(r.stepAfterPasswordChange({ changed: false, accepted: false }), { step: "change-password", message: "" });
  assert.deepEqual(r.stepAfterPasswordChange({ changed: true, accepted: false }), { step: "signin", message: "Senha atualizada. Entre com a nova senha para aceitar o convite." });
  assert.deepEqual(r.stepAfterPasswordChange({ changed: true, accepted: true }), { step: "done", message: "" });
});

test("login 403 sem clinica vira mensagem de conta sem acesso; demais mantem a do servidor", () => {
  assert.equal(r.loginMessageFor(403, "Este usuário ainda não está vinculado a uma clínica."), r.NO_CLINIC_MESSAGE);
  assert.equal(r.loginMessageFor(401, "Usuário ou senha inválidos."), "Usuário ou senha inválidos.");
  assert.equal(r.loginMessageFor(403, "Outra coisa"), "Outra coisa");
  assert.equal(r.loginMessageFor(500, undefined), "Usuário ou senha inválidos.");
});

test("?google= na pagina do convite: so codigos conhecidos", () => {
  assert.equal(r.inviteGoogleNotice("account_exists").step, "signin");
  assert.equal(r.inviteGoogleNotice("invite_email_mismatch").step, "choose");
  for (const v of [undefined, "", "constructor", "__proto__", "error", "<script>"]) assert.equal(r.inviteGoogleNotice(v), null);
});

test("?google=complete abre o passo de dados pessoais, sem mensagem de erro", () => {
  assert.deepEqual(r.inviteGoogleNotice("complete"), { message: "", step: "google-complete" });
});

test("M1: excecao de rede DEPOIS da troca de senha (changed=true, accepted=false) tambem volta ao signin", () => {
  // o catch da tela chama a funcao com changed=true e accepted=false quando acceptWithSession lanca
  const next = r.stepAfterPasswordChange({ changed: true, accepted: false });
  assert.equal(next.step, "signin");
  assert.equal(next.message, r.PASSWORD_UPDATED_MESSAGE);
  // excecao ANTES da troca (changed=false) mantem o passo de troca de senha
  assert.equal(r.stepAfterPasswordChange({ changed: false, accepted: false }).step, "change-password");
});
