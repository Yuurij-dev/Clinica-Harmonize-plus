import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeTreatmentSummary, clinicalIndicators, clinicalPendings, clinicDateKey, defaultEncounterFilters, evaluationEncounter, filterEncounters, followUpDraftEncounter,
  followUpEncounter, latestEvolution, sessionEncounter, sortEncounters, statusCounts,
} from "../src/lib/clinical-record-rules.ts";

const evaluation = (id, status, createdAt, extra = {}) => evaluationEncounter({ id, journeyId: "j1", journeyName: "Jornada 1", professional: "Dra. Ana", status, createdAt, chiefComplaint: "Flacidez", patientGoal: "", clinicalNotes: "", photoCount: 3, ...extra });
const session = (id, status, performedAt, extra = {}) => sessionEncounter({ id, journeyId: "j1", journeyName: "Jornada 1", quoteId: "q1", procedureName: "Bioestimulador", treatedAreas: "Malar", technique: "", professional: "Dra. Ana", status, performedAt, startedAt: null, observations: "Sessão sem intercorrências", complications: "", photoCount: 6, pendingMaterials: false, ...extra });
const followUp = (id, occurredAt) => followUpEncounter({ id, journeyId: "j1", journeyName: "Jornada 1", sessionId: "s1", procedureName: "Bioestimulador", treatedAreas: "Malar", professional: "Dra. Ana", occurredAt, complaints: "", observations: "Boa evolução", guidanceText: "", photoCount: 4 });

test("avaliação e sessão viram atendimentos com status derivado do registro", () => {
  assert.equal(evaluation("e1", "Concluída", "2026-10-14T12:00:00Z").status, "Concluído");
  const draft = evaluation("e2", "Rascunho", "2026-10-15T12:00:00Z");
  assert.equal(draft.status, "Com pendência");
  assert.deepEqual(draft.pendings, ["Avaliação não concluída"]);
  assert.equal(session("s1", "Concluída", "2026-10-16T12:00:00Z").status, "Concluído");
  assert.equal(session("s2", "Em execução", "2026-10-16T12:00:00Z").status, "Em andamento");
  assert.equal(session("s3", "Rascunho", "2026-10-16T12:00:00Z").status, "Com pendência");
  const withMaterials = session("s4", "Concluída", "2026-10-16T12:00:00Z", { pendingMaterials: true });
  assert.equal(withMaterials.status, "Concluído");
  assert.deepEqual(withMaterials.pendings, ["Conferir materiais usados"]);
  assert.equal(evaluation("e3", "Concluída", "2026-10-14T12:00:00Z", { chiefComplaint: "", patientGoal: "", clinicalNotes: "" }).summary, "");
});

test("filtros por status, tipo, período e busca (sem acento)", () => {
  const items = sortEncounters([
    evaluation("e1", "Concluída", "2026-10-14T12:00:00Z"),
    session("s1", "Concluída", "2026-10-22T12:00:00Z"),
    followUp("f1", "2026-11-06T12:00:00Z"),
    evaluation("e2", "Rascunho", "2026-11-10T12:00:00Z"),
    session("s2", "Em execução", "2026-11-11T12:00:00Z"),
  ]);
  assert.deepEqual(statusCounts(items), { all: 5, completed: 3, in_progress: 1, returns: 1, pending: 1 });
  assert.equal(filterEncounters(items, { ...defaultEncounterFilters, status: "returns" }).length, 1);
  assert.equal(filterEncounters(items, { ...defaultEncounterFilters, status: "pending" })[0].id, "e2");
  assert.equal(filterEncounters(items, { ...defaultEncounterFilters, type: "session" }).length, 2);
  assert.equal(filterEncounters(items, { ...defaultEncounterFilters, from: "2026-10-20", to: "2026-11-06" }).length, 2);
  assert.equal(filterEncounters(items, { ...defaultEncounterFilters, search: "sessao sem intercorrencias" }).length, 2);
  assert.equal(filterEncounters(items, { ...defaultEncounterFilters, search: "inexistente" }).length, 0);
});

test("a data usa o fuso da clínica (noite em UTC ainda é o mesmo dia em São Paulo)", () => {
  assert.equal(clinicDateKey("2026-10-20T01:30:00Z"), "2026-10-19");
  const items = [session("s1", "Concluída", "2026-10-20T01:30:00Z")];
  assert.equal(filterEncounters(items, { ...defaultEncounterFilters, to: "2026-10-19" }).length, 1);
});

test("indicadores e último retorno com dias decorridos", () => {
  const items = [evaluation("e1", "Concluída", "2026-10-14T15:00:00Z"), followUp("f1", "2026-11-06T15:00:00Z"), session("s2", "Em execução", "2026-11-11T15:00:00Z")];
  const indicators = clinicalIndicators(items, new Date("2026-11-14T15:00:00Z"));
  assert.equal(indicators.total, 3);
  assert.equal(indicators.inProgress, 1);
  assert.equal(indicators.completed, 2);
  assert.deepEqual(indicators.lastReturn, { occurredAt: "2026-11-06T15:00:00Z", daysAgo: 8 });
  assert.equal(clinicalIndicators([], new Date()).lastReturn, null);
});

test("evolução prefere retorno concluído e ignora registros vazios", () => {
  assert.equal(latestEvolution([]), null);
  const items = [session("s1", "Concluída", "2026-10-22T12:00:00Z"), followUp("f1", "2026-11-06T12:00:00Z")];
  assert.equal(latestEvolution(items).text, "Boa evolução");
  assert.equal(latestEvolution([session("s1", "Em execução", "2026-10-22T12:00:00Z")]), null);
});

test("tratamento ativo usa a jornada em andamento mais recente", () => {
  const journeys = [
    { id: "j0", name: "Antiga", status: "Concluído", professional: "X", createdAt: "2026-01-01T00:00:00Z" },
    { id: "j1", name: "Jornada 1", status: "Em andamento", professional: "Dra. Ana", createdAt: "2026-10-10T00:00:00Z" },
  ];
  const summary = activeTreatmentSummary(journeys, [session("s1", "Concluída", "2026-10-22T12:00:00Z")]);
  assert.equal(summary.journeyId, "j1");
  assert.equal(summary.mainTreatment, "Bioestimulador");
  assert.equal(summary.region, "Malar");
  assert.equal(summary.startedAt, "2026-10-22T12:00:00Z");
  assert.equal(activeTreatmentSummary([journeys[0]], []), null);
  assert.equal(activeTreatmentSummary(journeys, []).mainTreatment, "Jornada 1");
});

test("pendências clínicas combinam anamnese e atendimentos incompletos", () => {
  const draftFollowUp = followUpDraftEncounter({ sessionId: "s1", journeyId: "j1", journeyName: "J", procedureName: "Bio", treatedAreas: "", professional: "Ana", updatedAt: "2026-11-01T12:00:00Z", complaints: "dor", observations: "", photoCount: 0 });
  const items = [evaluation("e2", "Rascunho", "2026-11-10T12:00:00Z"), draftFollowUp];
  const ids = (state, extra = {}) => clinicalPendings({ anamnesisState: state, items, ...extra }).map((pending) => pending.id);
  assert.deepEqual(ids("REVISADA"), ["evaluation:e2:Avaliação não concluída", "followup-draft:s1:Retorno em rascunho"]);
  assert.equal(ids("AUSENTE")[0], "anamnesis-missing");
  assert.equal(ids("SOMENTE_RASCUNHO", { draftVersion: 2 })[0], "anamnesis-draft");
  assert.equal(ids("REVISAO_PENDENTE")[0], "anamnesis-review");
  assert.deepEqual(clinicalPendings({ anamnesisState: "REVISADA", items: [] }), []);
  assert.equal(clinicalPendings({ anamnesisState: "AUSENTE", items: [] })[0].tone, "info");
});
