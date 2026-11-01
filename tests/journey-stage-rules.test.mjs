import assert from "node:assert/strict";
import { test } from "node:test";
import { currentJourneyStage, journeyStagesDone } from "../src/lib/journey-stage-rules.ts";

const base = { status: "Em andamento", hasEvaluation: false, hasDraftEvaluation: false, hasPaidQuote: false, hasProcedure: false, hasReturnScheduled: false, hasReturn: false };

test("sem avaliação ou com avaliação em rascunho a etapa atual é Avaliação", () => {
  assert.equal(currentJourneyStage(base), "Avaliação");
  const draft = { ...base, hasEvaluation: true, hasDraftEvaluation: true };
  assert.equal(currentJourneyStage(draft), "Avaliação");
  assert.equal(journeyStagesDone(draft)[0], false);
});

test("avaliação concluída sem orçamento aprovado abre em Orçamento e marca só a avaliação como cumprida", () => {
  const journey = { ...base, hasEvaluation: true };
  assert.equal(currentJourneyStage(journey), "Orçamento");
  assert.deepEqual(journeyStagesDone(journey), [true, false, false, false, false, false]);
});

test("rascunho extra (ex.: foto enviada pelo app) leva de volta à Avaliação mesmo com orçamento pago", () => {
  assert.equal(currentJourneyStage({ ...base, hasEvaluation: true, hasDraftEvaluation: true, hasPaidQuote: true }), "Avaliação");
});

test("avança por orçamento pago, procedimento, retorno e conclusão", () => {
  const paid = { ...base, hasEvaluation: true, hasPaidQuote: true };
  assert.equal(currentJourneyStage(paid), "Procedimento");
  const done = { ...paid, hasProcedure: true, latestCompletedSessionId: "s1" };
  assert.equal(currentJourneyStage(done), "Pós-procedimento");
  assert.equal(currentJourneyStage({ ...done, hasReturnScheduled: true }), "Retorno");
  assert.equal(currentJourneyStage({ ...done, hasReturn: true, hasReturnScheduled: true, status: "Concluído" }), "Concluído");
});

test("procedimento sem sessão concluída segue em Procedimento (como o detalhe); com sessão concluída vai a Pós/Retorno", () => {
  const noSession = { ...base, hasEvaluation: true, hasPaidQuote: true, hasProcedure: true, latestCompletedSessionId: null };
  assert.equal(currentJourneyStage(noSession), "Procedimento");
  assert.equal(currentJourneyStage({ ...noSession, hasReturnScheduled: true }), "Procedimento");
  assert.equal(journeyStagesDone(noSession)[3], false);
  const withSession = { ...noSession, latestCompletedSessionId: "s1" };
  assert.equal(currentJourneyStage(withSession), "Pós-procedimento");
  assert.equal(currentJourneyStage({ ...withSession, hasReturn: true }), "Retorno");
  assert.equal(journeyStagesDone(withSession)[3], true);
});
