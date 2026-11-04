import assert from "node:assert/strict";
import { test } from "node:test";
import { appendAfterPhoto, maxSessionPhotos, sessionNotStartedMessage } from "../src/lib/session-after-photo-rules.ts";
import { appendIncomingPhotos, maxEditorPhotos, unseenPhotoIds } from "../src/lib/evaluation-photo-sync-rules.ts";

const photo = { id: "n1", phase: "Imediatamente após", name: "f", category: "Frontal", width: 10, height: 20, imageUrl: "data:image/jpeg;base64,AA" };

test("anexa ao fim sem alterar as fotos existentes", () => {
  const stored = JSON.stringify([{ id: "a", phase: "Antes", extra: 1 }]);
  const result = appendAfterPhoto(stored, photo);
  assert.ok(result.ok);
  assert.deepEqual(JSON.parse(result.json), [{ id: "a", phase: "Antes", extra: 1 }, photo]);
  assert.equal(result.count, 2);
});

test("JSON ilegível ou não lista nunca é sobrescrito", () => {
  for (const stored of ["{", "{}", "null", ""]) assert.equal(appendAfterPhoto(stored, photo).ok, false);
});

test("respeita o limite de fotos da sessão", () => {
  const full = JSON.stringify(Array.from({ length: maxSessionPhotos }, (_, i) => ({ id: String(i) })));
  const result = appendAfterPhoto(full, photo);
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(appendAfterPhoto(JSON.stringify(Array.from({ length: maxSessionPhotos - 1 }, (_, i) => ({ id: String(i) }))), photo).ok, true);
});

test("mensagem de procedimento não iniciado", () => {
  assert.equal(sessionNotStartedMessage, "O procedimento ainda não foi iniciado.");
});

test("sync: só ids nunca vistos, sem repetir e respeitando o limite", () => {
  assert.deepEqual(unseenPhotoIds(new Set(["a", "b"]), ["a", "c", "c", "d"], 2), ["c", "d"]);
  assert.deepEqual(unseenPhotoIds(new Set(["gone"]), ["gone"], 0), []);
  assert.deepEqual(unseenPhotoIds(new Set(), ["x", "y"], maxEditorPhotos - 1), ["x"]);
  assert.deepEqual(unseenPhotoIds(new Set(), ["x"], maxEditorPhotos), []);
});

test("sync: anexa sem reordenar nem sobrescrever e continua o sortOrder", () => {
  const current = [{ id: "a", sortOrder: 3, annotations: [1] }, { id: "b", sortOrder: 0, annotations: [] }];
  const next = appendIncomingPhotos(current, [{ id: "a", sortOrder: 0, annotations: [] }, { id: "c", sortOrder: 9, annotations: [] }, { id: "c", sortOrder: 9, annotations: [] }]);
  assert.deepEqual(next.map((p) => [p.id, p.sortOrder]), [["a", 3], ["b", 0], ["c", 4]]);
  assert.deepEqual(next[0].annotations, [1]);
});

test("preserva foto gravada desconhecida pelo cliente e respeita remoção feita por ele", async () => {
  const { unknownStoredPhotos } = await import("../src/lib/session-after-photo-rules.ts");
  const stored = [{ id: "a" }, { id: "b" }, { id: "app" }, { id: "" }, {}];
  // b conhecida e omitida = removida pelo usuário; app desconhecida e omitida = mantida; a enviada = não duplica.
  assert.deepEqual(unknownStoredPhotos(stored, ["a"], ["a", "b"]), [{ id: "app" }]);
  assert.deepEqual(unknownStoredPhotos(stored, ["a", "app"], ["a", "b"]), []);
  // Cliente antigo (sem knownIds): comportamento atual, nada é preservado.
  assert.deepEqual(unknownStoredPhotos(stored, ["a"], undefined), []);
});

test("knownPhotoIds: ausente é aceito; malformado é erro", async () => {
  const { parseKnownPhotoIds, photosOverLimit } = await import("../src/lib/session-after-photo-rules.ts");
  assert.deepEqual(parseKnownPhotoIds(undefined), { ok: true, ids: undefined });
  assert.deepEqual(parseKnownPhotoIds(["a"]), { ok: true, ids: ["a"] });
  for (const bad of [null, "a", {}, [1], ["x".repeat(65)], Array.from({ length: 501 }, () => "a")]) assert.equal(parseKnownPhotoIds(bad).ok, false);
  assert.equal(photosOverLimit(19, 1, 20), false);
  assert.equal(photosOverLimit(19, 2, 20), true);
});

test("sync de sessão: anexa por id sem reordenar nem passar de 20", async () => {
  const { appendUnseenById, maxEditorPhotos, syncIntervalMs } = await import("../src/lib/evaluation-photo-sync-rules.ts");
  assert.equal(syncIntervalMs, 5000);
  assert.deepEqual(appendUnseenById([{ id: "a", v: 1 }], [{ id: "a", v: 2 }, { id: "b" }, { id: "b" }]).map((p) => p.id), ["a", "b"]);
  assert.equal(appendUnseenById([{ id: "a", v: 1 }], [{ id: "a", v: 2 }])[0].v, 1);
  const full = Array.from({ length: maxEditorPhotos }, (_, i) => ({ id: String(i) }));
  assert.equal(appendUnseenById(full, [{ id: "x" }]).length, maxEditorPhotos);
});

test("backoff 5s -> 10 -> 20 -> 60 s e parada por status HTTP", async () => {
  const { nextPollDelay, pollOutcomeForStatus } = await import("../src/lib/evaluation-photo-sync-rules.ts");
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(nextPollDelay), [5000, 10000, 20000, 60000, 60000, 60000]);
  assert.equal(nextPollDelay(-1), 5000);
  assert.equal(pollOutcomeForStatus(200), "ok");
  assert.equal(pollOutcomeForStatus(500), "retry");
  assert.equal(pollOutcomeForStatus(503), "retry");
  for (const status of [401, 403, 404, 400]) assert.equal(pollOutcomeForStatus(status), "stop");
});

test("id que falha repetidamente vira tentado; spinner tem tempo mínimo", async () => {
  const { idsToSkipAfterFailure, remainingVisibleMs } = await import("../src/lib/evaluation-photo-sync-rules.ts");
  const counts = new Map();
  assert.deepEqual(idsToSkipAfterFailure(counts, ["a", "b"]), []);
  assert.deepEqual(idsToSkipAfterFailure(counts, ["a"]), ["a"]);
  assert.equal(remainingVisibleMs(1000, 1200), 400);
  assert.equal(remainingVisibleMs(1000, 2000), 0);
});

test("changed-check da sessão compara updatedAt exato", async () => {
  const { sessionUnchanged } = await import("../src/lib/evaluation-photo-sync-rules.ts");
  assert.equal(sessionUnchanged(null, new Date("2026-01-01T10:00:00.000Z")), false);
  assert.equal(sessionUnchanged("2026-01-01T10:00:00.000Z", new Date("2026-01-01T10:00:00.000Z")), true);
  assert.equal(sessionUnchanged("2026-01-01T10:00:00.000Z", new Date("2026-01-01T10:00:00.001Z")), false);
  assert.equal(sessionUnchanged("lixo", new Date()), false);
});

test("reconciliação: known = exibidas + removidas; pós-save mantém foto anexada em voo", async () => {
  const { knownIdsForSave, reconcileAfterSave, removedByEdit } = await import("../src/lib/evaluation-photo-sync-rules.ts");
  assert.deepEqual(knownIdsForSave([{ id: "a" }, { id: "b" }], ["c", "a"]).sort(), ["a", "b", "c"]);
  assert.deepEqual(removedByEdit([{ id: "a" }, { id: "b" }], [{ id: "a" }]), ["b"]);
  // app anexou "n" durante o voo (exibida, não enviada, ausente da resposta): continua. "s" foi enviada e a resposta a omitiu: não volta.
  const out = reconcileAfterSave([{ id: "a" }], [{ id: "a" }, { id: "n" }, { id: "s" }], ["a", "s"]);
  assert.deepEqual(out.map((p) => p.id), ["a", "n"]);
  const full = Array.from({ length: 20 }, (_, i) => ({ id: String(i) }));
  assert.equal(reconcileAfterSave(full, [...full, { id: "x" }], full.map((p) => p.id)).length, 20);
});

test("408 e 429 são retry; edição do usuário preserva foto anexada pelo poll", async () => {
  const { pollOutcomeForStatus, applyPhotoEdit } = await import("../src/lib/evaluation-photo-sync-rules.ts");
  assert.equal(pollOutcomeForStatus(408), "retry");
  assert.equal(pollOutcomeForStatus(429), "retry");
  assert.equal(pollOutcomeForStatus(404), "stop");
  // render tinha a,b; usuário removeu b; o poll anexou n antes do updater rodar: n não é "removida" nem se perde.
  const r = applyPhotoEdit([{ id: "a" }, { id: "b" }], [{ id: "a" }], [{ id: "a" }, { id: "b" }, { id: "n" }]);
  assert.deepEqual(r.photos.map((p) => p.id), ["a", "n"]);
  assert.deepEqual(r.removed, ["b"]);
  // usuário adicionou c (estava só em edited): permanece.
  assert.deepEqual(applyPhotoEdit([{ id: "a" }], [{ id: "a" }, { id: "c" }], [{ id: "a" }]).photos.map((p) => p.id), ["a", "c"]);
});
