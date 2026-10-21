import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alertsFromEvaluation, anamnesisState, answerLabel, appendAudit, canTransition, completionCheck, contentFromEvaluation, currentVersion, defaultReviewPolicy,
  deriveAnamnesisAlerts, emptyAnamnesisContent, hasAnamnesisContent, isContentEditable, nextVersionNumber, normalizeAnamnesisContent, openDraft,
  parseAnamnesisContent, pruneEmptyRows, startGateDecision, unansweredCount, revisionConflict, displayVersionStatus, pickEvaluationSource, hasEvaluationAnamnesis, autoStartAction, isFreshRequest,
} from "../src/lib/anamnesis-rules.ts";

const day = 86_400_000;
const version = (number, status, extra = {}) => ({ id: `v${number}`, version: number, status, completedAt: null, ...extra });

test("campo não preenchido nunca vira Não e é exibido como Não informado", () => {
  const content = emptyAnamnesisContent();
  for (const answer of [...Object.values(content.health.items), ...Object.values(content.allergies.items)]) assert.equal(answer.value, null);
  assert.equal(answerLabel(null), "Não informado");
  assert.equal(answerLabel(undefined), "Não informado");
  assert.equal(answerLabel("no"), "Não");
  assert.equal(answerLabel("yes"), "Sim");
  assert.equal(answerLabel("not_informed"), "Não informado");
  const normalized = normalizeAnamnesisContent({ health: { items: { diabetes: { value: "banana" }, cancer: {} } } });
  assert.equal(normalized.health.items.diabetes.value, null);
  assert.equal(normalized.health.items.cancer.value, null);
  assert.equal(normalized.allergies.items.latex.value, null);
  assert.equal(normalized.medications.usesMedication, null);
});

test("normalização limita tamanhos, descarta lixo e preserva a extensão por procedimento", () => {
  const huge = "x".repeat(5000);
  const content = normalizeAnamnesisContent({ complaint: { chiefComplaint: huge }, medications: { items: Array.from({ length: 80 }, (_, index) => ({ name: `m${index}` })) }, procedureSpecific: { botox: { units: 20 } }, extra: "ignorado" });
  assert.equal(content.complaint.chiefComplaint.length, 2000);
  assert.equal(content.medications.items.length, 30);
  assert.deepEqual(content.procedureSpecific, { botox: { units: 20 } });
  assert.equal("extra" in content, false);
  assert.deepEqual(normalizeAnamnesisContent("lixo"), emptyAnamnesisContent());
  assert.deepEqual(parseAnamnesisContent("{quebrado"), emptyAnamnesisContent());
  assert.deepEqual(normalizeAnamnesisContent({ procedureSpecific: { big: "y".repeat(25_000) } }).procedureSpecific, {});
});

test("conclusão exige conteúdo e nome nas linhas preenchidas; linhas vazias são removidas", () => {
  assert.equal(completionCheck(emptyAnamnesisContent()).ok, false);
  const withRow = emptyAnamnesisContent();
  withRow.medications.items = [{ id: "a", name: "", purpose: "tireoide", dose: "", notes: "" }];
  withRow.complaint.chiefComplaint = "queixa";
  assert.equal(completionCheck(withRow).ok, false);
  withRow.medications.items = [{ id: "a", name: "Levotiroxina", purpose: "", dose: "", notes: "" }, { id: "b", name: "", purpose: "", dose: "", notes: "" }];
  assert.equal(completionCheck(withRow).ok, true);
  assert.equal(pruneEmptyRows(withRow).medications.items.length, 1);
  const onlyAnswer = emptyAnamnesisContent();
  onlyAnswer.health.items.diabetes.value = "no";
  assert.equal(hasAnamnesisContent(onlyAnswer), true);
  assert.equal(unansweredCount(onlyAnswer), 17);
});

test("alertas só nascem de respostas Sim e nunca declaram aptidão", () => {
  const content = emptyAnamnesisContent();
  content.health.items.hypertension.value = "no";
  content.health.items.diabetes.value = "not_informed";
  assert.deepEqual(deriveAnamnesisAlerts(content), []);
  content.allergies.items.foods = { value: "yes", detail: "Frutos do mar" };
  content.health.items.anticoagulants.value = "yes";
  content.health.items.smoking.value = "yes";
  content.medications.items = [{ id: "1", name: "Levotiroxina", purpose: "", dose: "", notes: "" }];
  content.contraindications.notes = "Evitar laser";
  const alerts = deriveAnamnesisAlerts(content);
  assert.deepEqual(alerts.map((alert) => alert.level), ["important", "important", "attention", "info", "info"]);
  assert.equal(alerts[0].label, "Alergia a alimentos");
  assert.equal(alerts[0].detail, "Frutos do mar");
  for (const alert of alerts) assert.doesNotMatch(`${alert.label} ${alert.detail}`, /\b(apto|inapto)\b/i);
});

test("versão atual é a concluída de maior número; rascunho não conta como atual", () => {
  const versions = [version(1, "CONCLUIDA"), version(2, "CONCLUIDA"), version(3, "RASCUNHO")];
  assert.equal(currentVersion(versions).version, 2);
  assert.equal(openDraft(versions).version, 3);
  assert.equal(nextVersionNumber(versions), 4);
  assert.equal(nextVersionNumber([]), 1);
  assert.equal(currentVersion([version(1, "RASCUNHO")]), null);
  assert.equal(currentVersion([version(1, "CONCLUIDA"), version(2, "PENDENTE_REVISAO")]).version, 2);
});

test("somente rascunho é editável e as transições válidas são explícitas", () => {
  assert.equal(isContentEditable("RASCUNHO"), true);
  assert.equal(isContentEditable("CONCLUIDA"), false);
  assert.equal(isContentEditable("PENDENTE_REVISAO"), false);
  assert.equal(canTransition("RASCUNHO", "CONCLUIDA"), true);
  assert.equal(canTransition("CONCLUIDA", "RASCUNHO"), false);
  assert.equal(canTransition("CONCLUIDA", "PENDENTE_REVISAO"), true);
  assert.equal(canTransition("PENDENTE_REVISAO", "CONCLUIDA"), true);
  assert.equal(canTransition("PENDENTE_REVISAO", "RASCUNHO"), false);
});

test("estado da anamnese: ausente, rascunho, revisada e revisão pendente", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  assert.equal(anamnesisState([], now).state, "AUSENTE");
  assert.equal(anamnesisState([version(1, "RASCUNHO")], now).state, "SOMENTE_RASCUNHO");
  assert.equal(anamnesisState([version(1, "CONCLUIDA", { completedAt: "2026-10-01T00:00:00Z" })], now).state, "REVISADA");
  const pending = anamnesisState([version(1, "PENDENTE_REVISAO", { completedAt: "2026-10-01T00:00:00Z" })], now);
  assert.equal(pending.state, "REVISAO_PENDENTE");
  assert.equal(pending.reason, "manual");
  // Rascunho aberto não esconde a pendência da versão atual.
  assert.equal(anamnesisState([version(1, "PENDENTE_REVISAO"), version(2, "RASCUNHO")], now).state, "REVISAO_PENDENTE");
});

test("o tempo decorrido sozinho não gera pendência; só com a política ligada", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const old = [version(1, "CONCLUIDA", { completedAt: new Date(now.getTime() - 3650 * day).toISOString() })];
  assert.deepEqual(defaultReviewPolicy, { maxAgeDays: null });
  assert.equal(anamnesisState(old, now).state, "REVISADA");
  const policy = { maxAgeDays: 365 };
  const expired = anamnesisState(old, now, policy);
  assert.equal(expired.state, "REVISAO_PENDENTE");
  assert.equal(expired.reason, "policy");
  // Confirmar a revisão renova a validade.
  const confirmed = [version(1, "CONCLUIDA", { completedAt: old[0].completedAt, reviewConfirmedAt: new Date(now.getTime() - 10 * day).toISOString() })];
  assert.equal(anamnesisState(confirmed, now, policy).state, "REVISADA");
});

test("o gate de início de atendimento nunca bloqueia", () => {
  assert.equal(startGateDecision("AUSENTE"), "missing");
  assert.equal(startGateDecision("SOMENTE_RASCUNHO"), "draft");
  assert.equal(startGateDecision("REVISAO_PENDENTE"), "review");
  assert.equal(startGateDecision("REVISADA"), "proceed");
});

test("auditoria acumula entradas e tolera JSON inválido", () => {
  const entry = { at: "2026-10-19T00:00:00Z", by: "Ana", userId: "u1", action: "completed" };
  const first = appendAudit("[]", entry);
  assert.equal(JSON.parse(appendAudit(first, { ...entry, action: "review-confirmed" })).length, 2);
  assert.equal(JSON.parse(appendAudit("quebrado", entry)).length, 1);
  assert.equal(JSON.parse(appendAudit(JSON.stringify(Array.from({ length: 100 }, () => entry)), entry, 100)).length, 100);
});

test("avaliação existente alimenta rascunho sem definir Sim/Não", () => {
  const evaluation = { chiefComplaint: "Flacidez", patientGoal: "Firmeza", allergies: "Dipirona", contraindications: "Gestante", previousProcedures: "Botox 2024", anticoagulantUse: "Não", pregnancyStatus: "", medicalHistory: "", autoimmuneDiseases: "", clinicalNotes: "obs" };
  const content = contentFromEvaluation(evaluation);
  assert.equal(content.complaint.chiefComplaint, "Flacidez");
  assert.equal(content.allergies.notes, "Dipirona");
  assert.equal(content.health.items.anticoagulants.value, null);
  assert.match(content.health.notes, /Uso de anticoagulante: Não/);
  assert.equal(content.previousProcedures.items.length, 1);
  assert.equal(content.previousProcedures.hadPrevious, null);
  assert.deepEqual(alertsFromEvaluation(evaluation).map((alert) => alert.id), ["evaluation-allergies", "evaluation-contraindications"]);
  assert.deepEqual(alertsFromEvaluation(null), []);
});

test("conflito de revisão: só a revisão idêntica grava; ausente ou inválida é conflito", () => {
  const at = new Date("2026-10-19T12:00:00.000Z");
  assert.equal(revisionConflict("2026-10-19T12:00:00.000Z", at), false);
  assert.equal(revisionConflict("2026-10-19T12:00:00.001Z", at), true);
  assert.equal(revisionConflict(undefined, at), true);
  assert.equal(revisionConflict("", at), true);
  assert.equal(revisionConflict("lixo", at), true);
  assert.equal(revisionConflict(123, at), true);
});

test("versão marcada para revisão e superada aparece como substituída", () => {
  assert.equal(displayVersionStatus({ id: "a", status: "PENDENTE_REVISAO" }, "a"), "PENDENTE_REVISAO");
  assert.equal(displayVersionStatus({ id: "a", status: "PENDENTE_REVISAO" }, "b"), "SUBSTITUIDA");
  assert.equal(displayVersionStatus({ id: "a", status: "CONCLUIDA" }, "b"), "SUBSTITUIDA");
  assert.equal(displayVersionStatus({ id: "b", status: "CONCLUIDA" }, "b"), "CONCLUIDA");
  assert.equal(displayVersionStatus({ id: "c", status: "RASCUNHO" }, "b"), "RASCUNHO");
});

test("avaliação de origem: mais recente COM dados; id pedido é validado; metadados não contam como dado", () => {
  const blank = { chiefComplaint: "", allergies: "  " };
  const list = [{ id: "e3", createdAt: "2026-10-03", professional: "Ana", ...blank }, { id: "e2", createdAt: "2026-10-02", professional: "Ana", chiefComplaint: "Queixa" }, { id: "e1", createdAt: "2026-10-01", professional: "Ana", allergies: "Dipirona" }];
  assert.equal(hasEvaluationAnamnesis({ id: "x", createdAt: "2026-10-03", professional: "Ana" }), false);
  assert.equal(pickEvaluationSource(list).id, "e2");
  assert.equal(pickEvaluationSource(list, "e1").id, "e1");
  assert.equal(pickEvaluationSource(list, "e3"), null);
  assert.equal(pickEvaluationSource(list, "outra-clinica"), null);
  assert.equal(pickEvaluationSource([list[0]]), null);
  assert.equal(pickEvaluationSource([]), null);
});

test("pedido de abrir a anamnese: só abre rascunho existente, cria vazio sem versão e cópia só com nova versão", () => {
  assert.equal(autoStartAction("fill", { hasDraft: true, hasCurrent: true }), "edit-draft");
  assert.equal(autoStartAction("new-version", { hasDraft: true, hasCurrent: false }), "edit-draft");
  assert.equal(autoStartAction("fill", { hasDraft: false, hasCurrent: false }), "create-empty");
  assert.equal(autoStartAction("new-version", { hasDraft: false, hasCurrent: false }), "create-empty");
  assert.equal(autoStartAction("fill", { hasDraft: false, hasCurrent: true }), "none");
  assert.equal(autoStartAction("new-version", { hasDraft: false, hasCurrent: true }), "create-from-current");
});

test("um pedido vale uma vez: o mesmo nonce não é reaplicado e um novo pedido com a aba aberta sim", () => {
  assert.equal(isFreshRequest(null, null), false);
  assert.equal(isFreshRequest({ mode: "fill", nonce: 1 }, null), true);
  assert.equal(isFreshRequest({ mode: "fill", nonce: 1 }, 1), false);
  assert.equal(isFreshRequest({ mode: "fill", nonce: 2 }, 1), true);
});
