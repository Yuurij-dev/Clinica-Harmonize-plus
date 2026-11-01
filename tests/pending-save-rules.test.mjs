import test from "node:test";
import assert from "node:assert/strict";
import { pendingSaveAction, pendingSaveCopy, savedVersionCanConclude } from "../src/lib/pending-save-rules.ts";

test("sem alterações pendentes conclui direto", () => {
  assert.equal(pendingSaveAction("saved"), "proceed");
});

test("alterações pendentes ou com erro perguntam ao usuário", () => {
  assert.equal(pendingSaveAction("pending"), "ask");
  assert.equal(pendingSaveAction("error"), "ask");
});

test("gravação em andamento espera terminar", () => {
  assert.equal(pendingSaveAction("saving"), "settle");
});

test("textos explicam o efeito de cada botão", () => {
  assert.match(pendingSaveCopy.discard.effect, /perde/);
  assert.ok(pendingSaveCopy.save.label && pendingSaveCopy.cancel.label);
});


test("versão salva incompleta não pode ser usada para concluir", () => {
  assert.equal(savedVersionCanConclude({ status: "Rascunho", chiefComplaint: "" }), false);
  assert.equal(savedVersionCanConclude({ status: "Rascunho", chiefComplaint: "Rugas", patientGoal: "Natural", clinicalNotes: "n", allergies: "Não", pregnancyStatus: "Não", anticoagulantUse: "Não", autoimmuneDiseases: "Não", previousProcedures: "Não" }), true);
});

test("avaliação já concluída: campo obrigatório que já era vazio passa (paridade com o servidor)", () => {
  assert.equal(savedVersionCanConclude({ status: "Concluída", chiefComplaint: "Rugas", patientGoal: "", clinicalNotes: "" }), true);
});
