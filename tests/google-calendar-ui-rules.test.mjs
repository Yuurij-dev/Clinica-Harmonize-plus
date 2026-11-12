import assert from "node:assert/strict";
import { test } from "node:test";
import { gcalOutcomeToast, gcalStatusPresentation, gcalSyncSummary } from "../src/lib/google-calendar-ui-rules.ts";

test("códigos do callback viram mensagens; desconhecido é erro genérico", () => {
  assert.equal(gcalOutcomeToast("connected").kind, "success");
  assert.equal(gcalOutcomeToast("denied").message, "Autorização cancelada.");
  assert.match(gcalOutcomeToast("already_central").message, /outro administrador/);
  assert.equal(gcalOutcomeToast("<script>").kind, "error");
});

test("status: ERROR é âmbar, conectado verde, demais cinza", () => {
  assert.equal(gcalStatusPresentation("CONNECTED").variant, "green");
  assert.equal(gcalStatusPresentation("ERROR").variant, "amber");
  assert.equal(gcalStatusPresentation("DISCONNECTED").variant, "slate");
  assert.equal(gcalStatusPresentation("NOT_CONNECTED").label, "Não conectado");
});

test("resumo da sincronização", () => {
  assert.match(gcalSyncSummary({ enqueued: 0, processed: null }), /já está sincronizado/);
  assert.match(gcalSyncSummary({ enqueued: 3, processed: { failed: 0 } }), /3 agendamentos/);
  assert.match(gcalSyncSummary({ enqueued: 1, processed: { failed: 1 } }), /1 evento falhou/);
});
