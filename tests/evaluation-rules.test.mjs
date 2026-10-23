import assert from "node:assert/strict";
import { test } from "node:test";
import { assessmentCompletionError, assessmentFieldErrors, missingAssessmentFields } from "../src/lib/evaluation-rules.ts";
import { emptyAnamnesisContent, evaluationFieldsFromAnamnesis, fillEmptyEvaluationFields } from "../src/lib/anamnesis-rules.ts";

const complete = { chiefComplaint: "Rugas", patientGoal: "Suavizar", allergies: "Não", pregnancyStatus: "Não", anticoagulantUse: "Não", autoimmuneDiseases: "Não", previousProcedures: "Sim", clinicalNotes: "Sem intercorrências" };

test("avaliação completa não tem pendências", () => {
  assert.deepEqual(missingAssessmentFields(complete), []);
  assert.deepEqual(assessmentFieldErrors(complete), {});
  assert.equal(assessmentCompletionError(complete), null);
});

test("avaliação vazia ou com Não informado (vazio) pendencia todos os campos, na ordem da tela", () => {
  assert.deepEqual(missingAssessmentFields({}).map((field) => field.key), ["chiefComplaint", "patientGoal", "allergies", "pregnancyStatus", "anticoagulantUse", "autoimmuneDiseases", "previousProcedures", "clinicalNotes"]);
  assert.equal(Object.keys(assessmentFieldErrors({ ...complete, allergies: "", clinicalNotes: "   " })).join(), "allergies,clinicalNotes");
  assert.match(assessmentCompletionError({ ...complete, patientGoal: null }), /objetivo do paciente/);
});

test("texto legado nos selects continua valendo como preenchido", () => {
  assert.deepEqual(missingAssessmentFields({ ...complete, allergies: "Dipirona", previousProcedures: "Botox em 2022" }), []);
});

test("avaliação concluída antiga: campo que já era vazio passa; esvaziar um preenchido não", () => {
  const stored = { chiefComplaint: "Antiga", patientGoal: "", allergies: "Sim", pregnancyStatus: "", anticoagulantUse: "", autoimmuneDiseases: "", previousProcedures: "", clinicalNotes: "" };
  assert.deepEqual(missingAssessmentFields(stored, stored), []);
  assert.equal(assessmentCompletionError(stored, stored), null);
  assert.deepEqual(missingAssessmentFields({ ...stored, allergies: "" }, stored).map((field) => field.key), ["allergies"]);
  assert.deepEqual(Object.keys(assessmentFieldErrors({ ...stored, chiefComplaint: " " }, stored)), ["chiefComplaint"]);
  assert.equal(missingAssessmentFields(stored).length, 6);
});

test("queixa só com espaços e procedimentos anteriores Não na anamnese", () => {
  const content = emptyAnamnesisContent();
  content.complaint = { chiefComplaint: "   ", treatmentGoal: "  " };
  content.previousProcedures.hadPrevious = "no";
  assert.deepEqual(evaluationFieldsFromAnamnesis(content), { previousProcedures: "Não" });
});

test("anamnese vazia não preenche nada (null nunca vira Não)", () => {
  assert.deepEqual(evaluationFieldsFromAnamnesis(emptyAnamnesisContent()), {});
});

test("anamnese preenche Sim/Não e queixa/objetivo; not_informed não vira Não", () => {
  const content = emptyAnamnesisContent();
  content.complaint = { chiefComplaint: " Manchas ", treatmentGoal: "Uniformizar" };
  content.health.items.pregnancy.value = "no";
  content.health.items.anticoagulants.value = "yes";
  content.health.items.autoimmune.value = "not_informed";
  content.previousProcedures.hadPrevious = "yes";
  assert.deepEqual(evaluationFieldsFromAnamnesis(content), { chiefComplaint: "Manchas", patientGoal: "Uniformizar", pregnancyStatus: "Não", anticoagulantUse: "Sim", previousProcedures: "Sim" });
});

test("alergias: Sim se qualquer yes; Não só se todas respondidas no; mistura sem yes fica vazia", () => {
  const content = emptyAnamnesisContent();
  for (const answer of Object.values(content.allergies.items)) answer.value = "no";
  assert.equal(evaluationFieldsFromAnamnesis(content).allergies, "Não");
  content.allergies.items.latex.value = "not_informed";
  assert.equal(evaluationFieldsFromAnamnesis(content).allergies, undefined);
  content.allergies.items.latex.value = null;
  assert.equal(evaluationFieldsFromAnamnesis(content).allergies, undefined);
  content.allergies.items.foods.value = "yes";
  assert.equal(evaluationFieldsFromAnamnesis(content).allergies, "Sim");
});

test("pré-preenchimento só ocupa campos vazios e devolve o mesmo objeto sem mudanças", () => {
  const assessment = { chiefComplaint: "Escrita pelo profissional", patientGoal: "", allergies: "Dipirona", pregnancyStatus: "", anticoagulantUse: "", autoimmuneDiseases: "", previousProcedures: "" };
  const filled = fillEmptyEvaluationFields(assessment, { chiefComplaint: "Da anamnese", patientGoal: "Meta", allergies: "Não", pregnancyStatus: "Não" });
  assert.deepEqual(filled, { ...assessment, patientGoal: "Meta", pregnancyStatus: "Não" });
  assert.equal(fillEmptyEvaluationFields(assessment, {}), assessment);
  assert.equal(fillEmptyEvaluationFields(assessment, { chiefComplaint: "x", allergies: "Não" }), assessment);
});
