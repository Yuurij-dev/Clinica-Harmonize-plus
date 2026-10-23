import assert from "node:assert/strict";
import { test } from "node:test";
import { decideTargetEvaluation, evaluationPhotoCategories, evaluationPhotosFull, maxEvaluationPhotos, parseEvaluationPhotoFields } from "../src/lib/evaluation-photo-rules.ts";
import { parseBearerToken } from "../src/lib/bearer-rules.ts";
import { photoCategoryNames } from "../src/lib/clinical-files-rules.ts";

const ok = { category: "Frontal", width: "1200", height: "1600", name: "foto", evaluationId: "", journeyId: "" };

test("categorias do envio coincidem com as da galeria e do PUT", () => {
  assert.deepEqual([...evaluationPhotoCategories], [...photoCategoryNames]);
});

test("formulário válido: padrões e campos opcionais", () => {
  const result = parseEvaluationPhotoFields({ width: "800", height: "600" });
  assert.deepEqual(result, { ok: true, value: { category: "Outra", width: 800, height: 600, name: "", evaluationId: null, journeyId: null } });
  const full = parseEvaluationPhotoFields({ ...ok, evaluationId: " ev1 ", journeyId: "j1" });
  assert.equal(full.ok && full.value.evaluationId, "ev1");
  assert.equal(full.ok && full.value.journeyId, "j1");
});

test("categoria, dimensões e produto de pixels inválidos", () => {
  assert.equal(parseEvaluationPhotoFields({ ...ok, category: "Costas" }).ok, false);
  for (const bad of [{ width: "0" }, { width: "8001" }, { height: "-1" }, { width: "12.5" }, { width: "1e3" }, { width: "" }, { height: undefined }, { width: "abc" }, { width: "5000", height: "5001" }]) {
    assert.equal(parseEvaluationPhotoFields({ ...ok, ...bad }).ok, false, JSON.stringify(bad));
  }
  assert.equal(parseEvaluationPhotoFields({ ...ok, width: "5000", height: "5000" }).ok, true); // 25 MP exatos
});

test("avaliação alvo: pedida em rascunho, pedida concluída, inexistente, rascunho recente e nova", () => {
  assert.deepEqual(decideTargetEvaluation({ requestedId: "a", requested: { id: "a", status: "Rascunho" }, latestDraft: { id: "b" } }), { action: "use", evaluationId: "a" });
  assert.deepEqual(decideTargetEvaluation({ requestedId: "a", requested: { id: "a", status: "Concluída" }, latestDraft: { id: "b" } }), { action: "closed" });
  assert.deepEqual(decideTargetEvaluation({ requestedId: "a", requested: null, latestDraft: { id: "b" } }), { action: "notFound" });
  assert.deepEqual(decideTargetEvaluation({ requestedId: null, requested: null, latestDraft: { id: "b" } }), { action: "use", evaluationId: "b" });
  assert.deepEqual(decideTargetEvaluation({ requestedId: null, requested: null, latestDraft: null }), { action: "create" });
});

test("limite de 20 fotos por avaliação", () => {
  assert.equal(evaluationPhotosFull(maxEvaluationPhotos - 1), false);
  assert.equal(evaluationPhotosFull(maxEvaluationPhotos), true);
});

test("cabeçalho Bearer", () => {
  assert.equal(parseBearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
  assert.equal(parseBearerToken("bearer abc"), "abc");
  assert.equal(parseBearerToken("  Bearer abc  "), "abc");
  for (const bad of [null, undefined, "", "Bearer", "Bearer ", "Basic abc", "abc", "Bearer a b", "Bearer  a", `Bearer ${"x".repeat(5000)}`]) {
    assert.equal(parseBearerToken(bad), null, String(bad).slice(0, 20));
  }
});

test("dimensões: usa as reais, aceita lados trocados e pequena divergência, recusa o resto", async () => {
  const { resolvePhotoDimensions } = await import("../src/lib/evaluation-photo-rules.ts");
  const declared = { width: 400, height: 300 };
  assert.deepEqual(resolvePhotoDimensions(declared, null), { ok: true, width: 400, height: 300 });
  assert.deepEqual(resolvePhotoDimensions({ width: 410, height: 305 }, { width: 400, height: 300 }), { ok: true, width: 400, height: 300 });
  assert.deepEqual(resolvePhotoDimensions({ width: 300, height: 400 }, { width: 400, height: 300 }), { ok: true, width: 400, height: 300 });
  assert.equal(resolvePhotoDimensions({ width: 4000, height: 3000 }, { width: 400, height: 300 }).ok, false);
  assert.equal(resolvePhotoDimensions({ width: 9000, height: 100 }, { width: 9000, height: 100 }).ok, false);
  assert.equal(resolvePhotoDimensions({ width: 5000, height: 5001 }, { width: 5000, height: 5001 }).ok, false);
});
