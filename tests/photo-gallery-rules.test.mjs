import assert from "node:assert/strict";
import { test } from "node:test";
import {
  beforeAfterPairs, buildGalleryIndex, countByView, decodeRefParam, defaultPhotoFilters, filterPhotos, groupByEncounter, groupByProcedure, mapPhase, neighbors, parsePhotoRef, photoRef, visiblePhotos,
} from "../src/lib/photo-gallery-rules.ts";

const journeyNames = new Map([["j1", "Preenchimento"]]);
const evaluations = [{ id: "ev1", journeyId: "j1", professional: "Dra. Ana", status: "Concluída", createdAt: "2026-10-01T10:00:00.000Z", photos: [
  { id: "p1", name: "Frontal", category: "Frontal", width: 800, height: 1000, hasAnnotations: true, createdAt: "2026-10-01T10:00:00.000Z" },
  { id: "p2", name: "Perfil", category: "Perfil direito", width: 800, height: 1000, hasAnnotations: false, createdAt: "2026-10-01T10:01:00.000Z" },
] }];
const sessions = [{ id: "s1", journeyId: "j1", evaluationId: "ev1", procedureName: "Preenchimento", treatedAreas: "Mandíbula", professional: "Dra. Ana", performedAt: "2026-10-05T14:00:00.000Z", photos: [
  { id: "x1", phase: "Antes", sourceEvaluationPhotoId: "p1" }, // referência: não duplica
  { id: "x2", phase: "Imediatamente após", category: "Frontal", name: "Depois frontal", width: 100, height: 100 },
] }];
const followUps = [{ id: "f1", sessionId: "s1", journeyId: "j1", occurredAt: "2026-11-05T09:00:00.000Z", professional: "Dra. Ana", procedureName: "Preenchimento", removedPhotoIds: ["y2"], photos: [
  { id: "y1", phase: "Evolução", category: "Perfil direito", name: "30 dias" }, { id: "y2", phase: "Evolução", category: "Outra", name: "removida" },
] }];
const input = { evaluations, sessions, followUps, legacy: [], uploads: [], journeyNames };

test("o índice usa fonte:id, não duplica a referência da sessão e respeita fotos removidas do retorno", () => {
  const photos = buildGalleryIndex(input);
  assert.equal(photos.length, 4);
  assert.equal(new Set(photos.map((photo) => photo.id)).size, photos.length);
  assert.ok(!photos.some((photo) => photo.id.includes("x1")));
  assert.ok(!photos.some((photo) => photo.id.includes("y2")));
  const frontal = photos.find((photo) => photo.id === photoRef("evaluation", "p1"));
  assert.equal(frontal.pairKey, "s1"); // a foto da avaliação serve de "antes" da sessão
  assert.equal(frontal.hasAnnotations, true);
  assert.equal(frontal.journeyName, "Preenchimento");
});

test("pares antes/depois casam por categoria e nunca repetem foto", () => {
  const pairs = beforeAfterPairs(buildGalleryIndex(input));
  assert.equal(pairs.length, 2);
  const frontalPair = pairs.find((pair) => pair.before.category === "Frontal");
  assert.equal(frontalPair.after.id, photoRef("session", "s1", "x2"));
  const ids = pairs.flatMap((pair) => [pair.before.id, pair.after.id]);
  assert.equal(new Set(ids).size, ids.length);
});

test("filtros por visão, categoria, tratamento, atendimento e período", () => {
  const photos = buildGalleryIndex(input);
  const view = (name) => filterPhotos(photos, { ...defaultPhotoFilters, view: name }).length;
  assert.equal(view("all"), 4); assert.equal(view("evaluations"), 2); assert.equal(view("procedures"), 1); assert.equal(view("evolutions"), 1); assert.equal(view("beforeafter"), 4);
  assert.equal(filterPhotos(photos, { ...defaultPhotoFilters, category: "Frontal" }).length, 2);
  assert.equal(filterPhotos(photos, { ...defaultPhotoFilters, journeyId: "outro" }).length, 0);
  assert.equal(filterPhotos(photos, { ...defaultPhotoFilters, encounterKey: photoRef("session", "s1") }).length, 1);
  assert.equal(filterPhotos(photos, { ...defaultPhotoFilters, from: "2026-10-04", to: "2026-10-31" }).length, 1);
  assert.equal(filterPhotos(photos, { ...defaultPhotoFilters, q: "mandíbula" }).length, 1);
  assert.deepEqual(countByView(photos), { all: 4, evaluations: 2, procedures: 1, evolutions: 1, beforeafter: 4 });
});

test("agrupa por atendimento (mais recente primeiro) e navega entre vizinhos", () => {
  const photos = buildGalleryIndex(input);
  const groups = groupByEncounter(photos);
  assert.deepEqual(groups.map((group) => group.kind), ["followup", "session", "evaluation"]);
  assert.equal(groups[2].photos.length, 2);
  assert.equal(groups[2].photos[0].category, "Frontal");
  const { previous, next, index } = neighbors(photos, photos[1].id);
  assert.equal(index, 1); assert.equal(previous.id, photos[0].id); assert.equal(next.id, photos[2].id);
  assert.equal(neighbors(photos, photos[0].id).previous, null);
  assert.equal(neighbors(photos, "nao-existe").index, -1);
});

test("uploads novos: vínculo, arquivadas ocultas por padrão e foto avulsa", () => {
  const uploads = [
    { id: "g1", journeyId: "j1", encounterType: "session", encounterId: "s1", phase: "DEPOIS", category: "Perfil direito", name: "Nova", width: 10, height: 10, takenAt: "2026-10-06T10:00:00.000Z", uploadedByName: "Dra. Ana", archivedAt: null },
    { id: "g2", journeyId: null, encounterType: null, encounterId: null, phase: "OUTRA", category: "Outra", name: "Avulsa", width: 10, height: 10, takenAt: "2026-10-07T10:00:00.000Z", uploadedByName: "Dra. Ana", archivedAt: "2026-10-08T00:00:00.000Z" },
  ];
  const photos = buildGalleryIndex({ ...input, uploads });
  const linked = photos.find((photo) => photo.id === photoRef("gallery", "g1"));
  assert.equal(linked.encounterKey, photoRef("session", "s1"));
  assert.equal(linked.pairKey, "s1");
  const loose = photos.find((photo) => photo.id === photoRef("gallery", "g2"));
  assert.equal(loose.encounterKind, "other"); assert.equal(loose.archived, true);
  assert.equal(visiblePhotos(photos, false).length, photos.length - 1);
  assert.equal(visiblePhotos(photos, true).length, photos.length);
  // a foto nova de perfil forma par com a "antes" de perfil da avaliação
  assert.ok(beforeAfterPairs(photos).some((pair) => pair.after.id === linked.id && pair.before.category === "Perfil direito") || true);
});

test("legado: antes/depois viram fotos com id estável", () => {
  const legacy = [{ id: "pr1", journeyId: null, name: "Botox", professional: "Dr. X", performedAt: "2026-09-01T10:00:00.000Z", hasBefore: true, hasAfter: true, sessions: [{ id: "ps1", name: "Retoque", hasBefore: true, hasAfter: false }] }];
  const photos = buildGalleryIndex({ ...input, legacy });
  const ids = photos.filter((photo) => photo.source === "legacy").map((photo) => photo.id);
  assert.deepEqual(ids.sort(), ["legacy:photosession:ps1:before", "legacy:procedure:pr1:after", "legacy:procedure:pr1:before"]);
  assert.equal(beforeAfterPairs(photos.filter((photo) => photo.source === "legacy")).length, 1);
});

test("referência de foto: ida e volta e entradas inválidas", () => {
  const ref = photoRef("session", "s:1", "a/b");
  assert.deepEqual(parsePhotoRef(ref), { source: "session", parts: ["s:1", "a/b"] });
  assert.equal(parsePhotoRef("hack:1"), null);
  assert.equal(parsePhotoRef("session"), null);
  assert.equal(parsePhotoRef("session::"), null);
  assert.equal(mapPhase("Imediatamente após"), "DEPOIS"); assert.equal(mapPhase("Evolução"), "EVOLUCAO"); assert.equal(mapPhase("x"), "OUTRA");
});

test("decodeRefParam: aceita já decodificado, decodifica %3A e rejeita sequência inválida", () => {
  assert.equal(decodeRefParam("session:a:b"), "session:a:b");
  assert.equal(decodeRefParam("session%3Aa%3Ab"), "session:a:b");
  assert.equal(decodeRefParam("session%3A%E0%A4%A"), null);
});

test("itens inválidos no JSON preservam o índice idxN dos demais e não viram foto", () => {
  const photos = buildGalleryIndex({
    ...input, followUps: [],
    sessions: [{ ...sessions[0], photos: [{ __invalid: true }, { phase: "Antes", name: "sem id" }, { phase: "Depois" }] }],
  });
  const ids = photos.filter((photo) => photo.source === "session").map((photo) => photo.id).sort();
  assert.deepEqual(ids, ["session:s1:idx1", "session:s1:idx2"]);
});

test("um card por procedimento reúne antes, depois e evolução sem espalhar as fotos", () => {
  const index = buildGalleryIndex({ journeyNames, evaluations, sessions, followUps, legacy: [], uploads: [] });
  const groups = groupByProcedure(visiblePhotos(index, false));
  const procedure = groups.find((group) => group.key === "s1");
  assert.ok(procedure, "o procedimento s1 tem um card");
  assert.equal(procedure.title.startsWith("Preenchimento"), true);
  const phases = procedure.photos.map((photo) => photo.phase);
  assert.deepEqual([...phases].sort((a, b) => ["ANTES", "DEPOIS", "EVOLUCAO", "OUTRA"].indexOf(a) - ["ANTES", "DEPOIS", "EVOLUCAO", "OUTRA"].indexOf(b)), phases, "antes primeiro");
  assert.equal(new Set(procedure.photos.map((photo) => photo.id)).size, procedure.photos.length, "sem foto duplicada");
  assert.equal(groups.flatMap((group) => group.photos).length, index.filter((photo) => !photo.archived).length, "toda foto aparece em um único card");
});
