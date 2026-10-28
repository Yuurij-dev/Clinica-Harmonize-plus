import assert from "node:assert/strict";
import { test } from "node:test";
import {
  annotationFromShape, annotationToReplay, eraseAnnotations, eraseInkStroke, eraserSize, finishCreate, hitShape, isInkAnnotation,
  inkSmoothing, maxHistory, pushHistory, replaySmoothing, resizeShape, restyleAnnotation, sameAnnotationList, shapeFromAnnotation, simplifyStroke, smoothPath, smoothingFactor, strokeToAnnotation, translateAnnotation,
} from "../src/lib/photo-annotation-rules.ts";

const base = { color: "#ff3b30", strokeWidth: 4 };
const line = (id, y = 100) => ({ id, type: "freehand", points: [0, y, 100, y, 200, y], ...base });

test("formas <-> marcações: ida e volta mantém o formato salvo", () => {
  const arrow = { id: "a", type: "arrow", points: [10, 20, 110, 220], ...base };
  assert.deepEqual(annotationFromShape(shapeFromAnnotation(arrow)), arrow);
  const rectangle = { id: "r", type: "rectangle", x: 10, y: 20, width: 100, height: 50, ...base };
  assert.deepEqual(annotationFromShape(shapeFromAnnotation(rectangle)), rectangle);
  const triangle = { id: "t", type: "triangle", x: 10, y: 20, width: -40, height: 50, ...base };
  assert.deepEqual(annotationFromShape(shapeFromAnnotation(triangle)), triangle);
  const ellipse = { id: "e", type: "ellipse", x: 5, y: 5, width: 30, height: 60, ...base };
  assert.deepEqual(annotationFromShape(shapeFromAnnotation(ellipse)), ellipse);
});

test("marcações antigas: elipse com tamanho negativo, linha e curva continuam legíveis", () => {
  const legacyEllipse = { id: "old", type: "ellipse", x: 100, y: 100, width: -40, height: -20, ...base };
  const shape = shapeFromAnnotation(legacyEllipse);
  assert.deepEqual([shape.x1, shape.y1, shape.x2, shape.y2], [100, 100, 60, 80]);
  assert.equal(shapeFromAnnotation({ id: "l", type: "line", points: [1, 2, 3, 4], ...base }).kind, "line");
  assert.equal(isInkAnnotation({ id: "c", type: "curve", points: [0, 0, 1, 1], ...base }), true);
  assert.equal(isInkAnnotation({ id: "f", type: "freehand", points: [0, 0, 1, 1], ...base }), true);
  assert.equal(isInkAnnotation({ id: "a", type: "arrow", points: [0, 0, 1, 1], ...base }), false);
  assert.equal(shapeFromAnnotation({ id: "t", type: "text", x: 0, y: 0, text: "x", fontSize: 24, ...base }), null);
  assert.equal(shapeFromAnnotation({ id: "p", type: "point", x: 0, y: 0, radius: 7, ...base }), null);
});

test("marcação malformada não vira forma (sem NaN na tela)", () => {
  assert.equal(shapeFromAnnotation({ id: "x", type: "line", points: [1, 2], ...base }), null);
  assert.equal(shapeFromAnnotation({ id: "x", type: "rectangle", x: NaN, y: 0, width: 1, height: 1, ...base }), null);
  assert.deepEqual(annotationToReplay({ id: "x", type: "freehand", points: [1, 2, "a", 4, 5, 6], ...base }, 10, 10, 10, 10).map((p) => [p.x, p.y]), [[1, 2], [5, 6]]);
});

test("suavização do Atrament: o primeiro ponto fica, os seguintes ficam atrás do ponteiro", () => {
  const raw = [{ x: 10, y: 20, pressure: 0.5 }, { x: 110, y: 20, pressure: 0.5 }];
  const drawn = smoothPath(raw);
  assert.deepEqual([drawn[0].x, drawn[0].y], [10, 20]);
  const u = smoothingFactor(100, inkSmoothing);
  assert.ok(Math.abs(drawn[1].x - (110 - 100 * u)) < 1e-9);
  assert.ok(drawn[1].x < 110 && drawn[1].x > 10);
  assert.equal(smoothingFactor(1000, 0.85), 0.87);
});

test("reproduzir com suavização quase nula devolve o caminho já suavizado", () => {
  const raw = Array.from({ length: 40 }, (_, i) => ({ x: i * 3, y: 20 + Math.sin(i / 4) * 15, pressure: 0.5 }));
  const drawn = smoothPath(raw);
  const replayed = smoothPath(drawn, replaySmoothing);
  const worst = Math.max(...drawn.map((p, i) => Math.hypot(p.x - replayed[i].x, p.y - replayed[i].y)));
  assert.ok(worst < 0.3, "desvio " + worst);
});

test("traço do Atrament vira marcação no espaço da imagem", () => {
  // canvas de tela 400x300 para foto 2000x1500: fator 5
  const segments = [{ point: { x: 10, y: 20 }, pressure: 0.5 }, { point: { x: 110, y: 20 }, pressure: 0.5 }, { point: { x: 210, y: 120 }, pressure: 0.5 }];
  const annotation = strokeToAnnotation({ id: "s", segments, recordedWidth: 400, recordedHeight: 300, photoWidth: 2000, photoHeight: 1500, color: "#2563eb", weight: 3 });
  const drawn = smoothPath(segments.map((s) => ({ ...s.point, pressure: s.pressure })));
  assert.equal(annotation.type, "freehand");
  assert.deepEqual(annotation.points.slice(0, 2), [50, 100]);
  assert.deepEqual(annotation.points, drawn.flatMap((p) => [Math.round(p.x * 5 * 100) / 100, Math.round(p.y * 5 * 100) / 100]));
  assert.equal(annotation.pressure, undefined);
  assert.equal(annotation.strokeWidth, 3);
  assert.equal(annotation.color, "#2563eb");
});

test("pressão só é guardada quando varia; pontos fora da foto são limitados", () => {
  const segments = [{ point: { x: -5, y: 10 }, pressure: 0.2 }, { point: { x: 500, y: 10 }, pressure: 0.9 }];
  const annotation = strokeToAnnotation({ id: "s", segments, recordedWidth: 400, recordedHeight: 300, photoWidth: 400, photoHeight: 300, color: "#fff", weight: 2 });
  assert.equal(annotation.points[0], 0);
  assert.ok(annotation.points[2] > 0 && annotation.points[2] <= 400);
  assert.deepEqual(annotation.pressure, [0.2, 0.9]);
});

test("toque sem arrasto vira um pingo (ponto duplicado) e traço vazio é ignorado", () => {
  const dot = strokeToAnnotation({ id: "d", segments: [{ point: { x: 40, y: 30 }, pressure: 0.5 }], recordedWidth: 400, recordedHeight: 300, photoWidth: 800, photoHeight: 600, color: "#fff", weight: 4 });
  assert.deepEqual(dot.points, [80, 60, 80, 60]);
  assert.equal(strokeToAnnotation({ id: "e", segments: [], recordedWidth: 400, recordedHeight: 300, photoWidth: 800, photoHeight: 600, color: "#fff", weight: 4 }), null);
});

test("pontos muito próximos são removidos, mantendo o primeiro e o último", () => {
  const raw = Array.from({ length: 11 }, (_, i) => ({ x: i * 0.1, y: 0, pressure: 0.5 }));
  const out = simplifyStroke(raw, 0.45);
  assert.equal(out[0].x, 0);
  assert.equal(out.at(-1).x, 1);
  assert.ok(out.length < raw.length && out.length >= 3);
});

test("reprodução: mesma marcação em outro zoom e marcação antiga sem pressão", () => {
  const legacy = { id: "old", type: "freehand", points: [100, 200, 300, 400], ...base };
  const small = annotationToReplay(legacy, 200, 150, 1000, 750);
  assert.deepEqual(small.map((p) => [p.x, p.y, p.pressure]), [[20, 40, 0.5], [60, 80, 0.5]]);
  const big = annotationToReplay(legacy, 800, 600, 1000, 750);
  assert.deepEqual(big.map((p) => [p.x, p.y]), [[80, 160], [240, 320]]);
});

test("ida e volta: gravar em uma tela e reproduzir em outra preserva a posição relativa", () => {
  const segments = [{ point: { x: 40, y: 30 }, pressure: 0.5 }, { point: { x: 200, y: 150 }, pressure: 0.5 }];
  const annotation = strokeToAnnotation({ id: "s", segments, recordedWidth: 400, recordedHeight: 300, photoWidth: 1600, photoHeight: 1200, color: "#fff", weight: 4 });
  const replayed = annotationToReplay(annotation, 800, 600, 1600, 1200);
  const drawn = smoothPath(segments.map((s) => ({ ...s.point, pressure: s.pressure })));
  // 400 de tela -> 1600 da imagem -> 800 de tela: o dobro
  assert.deepEqual(replayed.map((p) => [p.x, p.y]), drawn.map((p) => [Math.round(p.x * 4 * 100) / 100 / 2, Math.round(p.y * 4 * 100) / 100 / 2]));
});

test("borracha corta só o trecho tocado do traço livre", () => {
  const stroke = line("s");
  const pieces = eraseInkStroke(stroke, [{ x: 100, y: 100 }], 10, 1);
  assert.equal(pieces.length, 2);
  assert.equal(pieces[0].id, "s");
  assert.notEqual(pieces[1].id, "s");
  assert.ok(pieces[0].points.at(-2) < 100 && pieces[0].points[0] === 0);
  assert.ok(pieces[1].points[0] > 100 && pieces[1].points.at(-2) === 200);
  assert.ok(pieces.every(isInkAnnotation));
  assert.ok(pieces.every((p) => p.color === base.color && p.strokeWidth === base.strokeWidth));
});

test("borracha longe do traço devolve o mesmo objeto; sobre todo o traço apaga tudo", () => {
  const stroke = line("s");
  assert.deepEqual(eraseInkStroke(stroke, [{ x: 100, y: 300 }], 10, 1), [stroke]);
  assert.equal(eraseInkStroke(stroke, [{ x: 100, y: 300 }], 10, 1)[0], stroke);
  assert.deepEqual(eraseInkStroke(stroke, [{ x: -20, y: 100 }, { x: 220, y: 100 }], 10, 1), []);
});

test("a espessura do traço conta na área apagada", () => {
  const thick = { ...line("s"), strokeWidth: 20 };
  // borracha de raio 5 a 12 px do traço: só toca se a meia espessura (10) entrar na conta
  assert.notDeepEqual(eraseInkStroke(thick, [{ x: 100, y: 112 }], 5, 1), [thick]);
  assert.deepEqual(eraseInkStroke(line("s"), [{ x: 100, y: 112 }], 5, 1).length, 1);
});

test("borracha apaga forma, ponto e texto inteiros e preserva o resto", () => {
  const rectangle = { id: "r", type: "rectangle", x: 50, y: 50, width: 100, height: 100, ...base };
  const point = { id: "p", type: "point", x: 400, y: 400, radius: 7, ...base };
  const text = { id: "t", type: "text", x: 600, y: 600, text: "Olá", fontSize: 24, ...base };
  const far = { id: "far", type: "ellipse", x: 800, y: 800, width: 50, height: 50, ...base };
  const all = [rectangle, point, text, far, line("s", 1000)];
  assert.deepEqual(eraseAnnotations(all, [{ x: 50, y: 100 }], 8).map((a) => a.id), ["p", "t", "far", "s"]);
  assert.deepEqual(eraseAnnotations(all, [{ x: 402, y: 402 }], 8).map((a) => a.id), ["r", "t", "far", "s"]);
  assert.deepEqual(eraseAnnotations(all, [{ x: 610, y: 610 }], 4).map((a) => a.id), ["r", "p", "far", "s"]);
});

test("borracha sem tocar em nada devolve a mesma lista; opções limitam o que apaga", () => {
  const all = [line("s"), { id: "r", type: "rectangle", x: 50, y: 300, width: 100, height: 100, ...base }];
  assert.equal(eraseAnnotations(all, [{ x: 900, y: 900 }], 8), all);
  // só traços: a forma sob a borracha fica
  const inkOnly = eraseAnnotations(all, [{ x: 100, y: 100 }, { x: 50, y: 300 }], 8, 1, { others: false });
  assert.ok(inkOnly.some((a) => a.id === "r"));
  assert.ok(inkOnly.filter(isInkAnnotation).length >= 1);
  // só formas: o traço fica intacto
  const shapesOnly = eraseAnnotations(all, [{ x: 100, y: 100 }, { x: 50, y: 300 }], 8, 1, { ink: false });
  assert.equal(shapesOnly.find((a) => a.id === "s"), all[0]);
  assert.equal(shapesOnly.some((a) => a.id === "r"), false);
});

test("borracha segue o tamanho do app: 3x a espessura, com mínimo para o toque", () => {
  assert.equal(eraserSize(4), 12);
  assert.equal(eraserSize(1), 10);
  assert.equal(eraserSize(12), 36);
});

test("histórico guarda no máximo 60 passos, descartando os mais antigos", () => {
  let stack = [];
  for (let i = 0; i < maxHistory + 5; i++) stack = pushHistory(stack, i);
  assert.equal(stack.length, maxHistory);
  assert.equal(stack[0], 5);
  assert.equal(stack.at(-1), maxHistory + 4);
});

test("mover mantém a forma dentro da foto; texto e ponto também; traço livre não se move", () => {
  const rectangle = { id: "r", type: "rectangle", x: 10, y: 10, width: 100, height: 50, ...base };
  const moved = translateAnnotation(rectangle, -50, 900, 500, 400);
  assert.deepEqual([moved.x, moved.y, moved.width, moved.height], [0, 350, 100, 50]);
  const point = translateAnnotation({ id: "p", type: "point", x: 10, y: 10, radius: 7, ...base }, 1000, -1000, 500, 400);
  assert.deepEqual([point.x, point.y], [500, 0]);
  const ink = line("s");
  assert.equal(translateAnnotation(ink, 10, 10, 500, 400), ink);
});

test("redimensionar arrasta só o canto escolhido e respeita a foto", () => {
  const shape = shapeFromAnnotation({ id: "r", type: "rectangle", x: 100, y: 100, width: 100, height: 100, ...base });
  const resized = resizeShape(shape, "se", 50, 500, 400, 300);
  assert.deepEqual([resized.x1, resized.y1, resized.x2, resized.y2], [100, 100, 250, 300]);
});

test("cor e espessura da seleção: texto e ponto só mudam de cor, traço livre não muda", () => {
  const rectangle = { id: "r", type: "rectangle", x: 1, y: 1, width: 2, height: 2, ...base };
  assert.deepEqual(restyleAnnotation(rectangle, { color: "#fff", strokeWidth: 9 }), { ...rectangle, color: "#fff", strokeWidth: 9 });
  const text = { id: "t", type: "text", x: 0, y: 0, text: "x", fontSize: 24, ...base };
  assert.deepEqual(restyleAnnotation(text, { color: "#fff", strokeWidth: 9 }), { ...text, color: "#fff" });
  const ink = line("s");
  assert.equal(restyleAnnotation(ink, { color: "#fff" }), ink);
});

test("toque sem arrasto cria forma de tamanho padrão; arrasto usa o ponto final", () => {
  const start = { id: "n", kind: "rectangle", x1: 100, y1: 100, x2: 100, y2: 100, color: "#fff", weight: 3 };
  const tap = finishCreate(start, { x: 100, y: 100 }, 1000, 800);
  assert.deepEqual([tap.x2, tap.y2], [260, 188]);
  const drag = finishCreate(start, { x: 300, y: 400 }, 1000, 800);
  assert.deepEqual([drag.x2, drag.y2], [300, 400]);
});

test("acerto de forma considera a espessura e a escala de tela", () => {
  const shape = shapeFromAnnotation({ id: "l", type: "line", points: [0, 0, 100, 0], color: "#fff", strokeWidth: 10 });
  assert.equal(hitShape(shape, { x: 50, y: 4 }, 0), true);
  assert.equal(hitShape(shape, { x: 50, y: 6 }, 0), false);
  assert.equal(hitShape(shape, { x: 50, y: 14 }, 0, 3), true);
});

test("lista de traços já reproduzida é reconhecida pelos mesmos objetos", () => {
  const a = line("a");
  const b = line("b");
  assert.equal(sameAnnotationList([a, b], [a, b]), true);
  assert.equal(sameAnnotationList([a, b], [b, a]), false);
  assert.equal(sameAnnotationList([a], [a, b]), false);
  assert.equal(sameAnnotationList(null, []), false);
});

test("cortes sucessivos do mesmo traço nunca repetem id", () => {
  let strokes = [{ id: "s", type: "freehand", points: Array.from({ length: 200 }, (_, i) => [i * 5, 100]).flat(), ...base }];
  for (const x of [100, 300, 500, 700, 200, 400, 600, 800]) {
    strokes = strokes.flatMap((stroke) => eraseInkStroke(stroke, [{ x, y: 100 }], 6, 1));
  }
  const ids = strokes.map((s) => s.id);
  assert.ok(ids.length >= 5);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("s"));
});

test("limite de 1000 marcações por foto: só recusa o que aumenta a quantidade", async () => {
  const { exceedsAnnotationLimit, maxAnnotationsPerPhoto } = await import("../src/lib/photo-annotation-rules.ts");
  const full = Array.from({ length: maxAnnotationsPerPhoto }, (_, i) => i);
  assert.equal(exceedsAnnotationLimit([...full, 1], full), true);
  assert.equal(exceedsAnnotationLimit(full, full.slice(1)), false);
  assert.equal(exceedsAnnotationLimit(full.slice(1), full), false);
  assert.equal(exceedsAnnotationLimit([...full, 1], [...full, 1]), false); // foto já acima do limite: editar/apagar continua possível
  assert.equal(exceedsAnnotationLimit([1, 2], [1]), false);
});
