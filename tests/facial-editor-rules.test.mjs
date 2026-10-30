import assert from "node:assert/strict";
import { test } from "node:test";
import {
  annotationDescription, fitToArea, formatSavedAgo, isTextEntryTarget, markingsCountLabel, maxZoom, minZoom, saveIndicator, shortcutFromKey, stepZoom,
} from "../src/lib/facial-editor-rules.ts";
import { annotationAnchor, labelLayout } from "../src/lib/annotation-label-rules.ts";

const key = (k, extra = {}) => ({ key: k, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, ...extra });

test("zoom anda em passos de 0,25 e respeita os limites", () => {
  assert.equal(stepZoom(1, 1), 1.25);
  assert.equal(stepZoom(1, -1), 0.75);
  assert.equal(stepZoom(maxZoom, 1), maxZoom);
  assert.equal(stepZoom(minZoom, -1), minZoom);
  assert.equal(stepZoom(1.1, 1), 1.35);
});

test("ajuste à área: cabe inteira, não passa do máximo e tolera área ainda sem medida", () => {
  assert.equal(fitToArea({ areaWidth: 1000, areaHeight: 600, photoWidth: 500, photoHeight: 500, margin: 0 }), 1.2);
  assert.equal(fitToArea({ areaWidth: 4000, areaHeight: 4000, photoWidth: 100, photoHeight: 100, margin: 0 }), 2);
  assert.equal(fitToArea({ areaWidth: 0, areaHeight: 0, photoWidth: 800, photoHeight: 600 }), 1);
  assert.equal(fitToArea({ areaWidth: 800, areaHeight: 600, photoWidth: 0, photoHeight: 0 }), 1);
});

test("há X: faixas de tempo desde o último salvamento", () => {
  const now = 1_000_000_000;
  assert.equal(formatSavedAgo(now - 3_000, now), "agora mesmo");
  assert.equal(formatSavedAgo(now - 30_000, now), "há menos de 1 minuto");
  assert.equal(formatSavedAgo(now - 60_000, now), "há 1 minuto");
  assert.equal(formatSavedAgo(now - 120_000, now), "há 2 minutos");
  assert.equal(formatSavedAgo(now - 3_600_000, now), "há 1 hora");
  assert.equal(formatSavedAgo(now - 5 * 3_600_000, now), "há 5 horas");
  assert.equal(formatSavedAgo(now - 2 * 86_400_000, now), "há 2 dias");
  assert.equal(formatSavedAgo(now + 5_000, now), "agora mesmo");
});

test("indicador de salvamento: só mostra salvo com gravação confirmada", () => {
  const base = { readOnly: false, autosave: "saved", saving: false, lastSavedAt: null, hasRecord: false, now: 10_000 };
  assert.equal(saveIndicator({ ...base, autosave: "pending" }).tone, "busy");
  assert.equal(saveIndicator({ ...base, autosave: "pending", lastSavedAt: 5_000 }).footer, "Alterações pendentes");
  assert.equal(saveIndicator({ ...base, autosave: "saving", lastSavedAt: 5_000 }).footer, "Salvando…");
  assert.equal(saveIndicator({ ...base, saving: true }).tone, "busy");
  const failed = saveIndicator({ ...base, autosave: "error", lastSavedAt: 5_000 });
  assert.equal(failed.tone, "error");
  assert.equal(failed.canRetry, true);
  assert.ok(!failed.footer.startsWith("Salvo"));
  assert.equal(saveIndicator({ ...base, lastSavedAt: 5_000 }).footer, "Salvo automaticamente • agora mesmo");
  assert.equal(saveIndicator({ ...base, hasRecord: true }).footer, "Salvo automaticamente");
  assert.equal(saveIndicator(base).tone, "idle");
  assert.equal(saveIndicator({ ...base, readOnly: true, autosave: "error" }).tone, "idle");
});

test("atalhos: Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z e zoom; sem Ctrl ou com Alt não contam", () => {
  assert.equal(shortcutFromKey(key("z")), "undo");
  assert.equal(shortcutFromKey(key("Z", { shiftKey: true })), "redo");
  assert.equal(shortcutFromKey(key("y")), "redo");
  assert.equal(shortcutFromKey(key("+", { shiftKey: true })), "zoomIn");
  assert.equal(shortcutFromKey(key("=")), "zoomIn");
  assert.equal(shortcutFromKey(key("-")), "zoomOut");
  assert.equal(shortcutFromKey(key("0")), "zoomReset");
  assert.equal(shortcutFromKey(key("z", { ctrlKey: false, metaKey: true })), "undo");
  assert.equal(shortcutFromKey(key("z", { ctrlKey: false })), null);
  assert.equal(shortcutFromKey(key("z", { altKey: true })), null);
  assert.equal(shortcutFromKey(key("a")), null);
  assert.equal(shortcutFromKey(key("Delete")), null);
});

test("campos de texto não perdem os atalhos do navegador; slider e botão sim", () => {
  assert.equal(isTextEntryTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(isTextEntryTarget({ tagName: "INPUT", type: "text" }), true);
  assert.equal(isTextEntryTarget({ tagName: "INPUT" }), true);
  assert.equal(isTextEntryTarget({ tagName: "SELECT" }), true);
  assert.equal(isTextEntryTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTextEntryTarget({ tagName: "INPUT", type: "range" }), false);
  assert.equal(isTextEntryTarget({ tagName: "BUTTON" }), false);
  assert.equal(isTextEntryTarget(null), false);
});

test("descrição na lista: legenda, ou tipo com número entre os do mesmo tipo", () => {
  const list = [{ type: "point" }, { type: "line" }, { type: "point", label: "Glabela" }, { type: "point" }, { type: "freehand" }, { type: "curve" }];
  assert.equal(annotationDescription(list, 0), "Ponto 1");
  assert.equal(annotationDescription(list, 1), "Linha 1");
  assert.equal(annotationDescription(list, 2), "Glabela");
  assert.equal(annotationDescription(list, 3), "Ponto 3");
  assert.equal(annotationDescription(list, 5), "Traço 2");
  assert.equal(annotationDescription(list, 9), "");
  assert.equal(markingsCountLabel(1), "1 marcação");
  assert.equal(markingsCountLabel(0), "0 marcações");
  assert.equal(markingsCountLabel(3), "3 marcações");
});

test("âncora da legenda por tipo de marcação", () => {
  assert.deepEqual(annotationAnchor({ type: "point", x: 10, y: 20 }), { x: 10, y: 20 });
  assert.deepEqual(annotationAnchor({ type: "arrow", points: [0, 0, 40, 60] }), { x: 40, y: 60 });
  assert.deepEqual(annotationAnchor({ type: "line", points: [0, 0, 40, 60] }), { x: 20, y: 30 });
  assert.deepEqual(annotationAnchor({ type: "rectangle", x: 10, y: 50, width: 40, height: -30 }), { x: 30, y: 20 });
  assert.deepEqual(annotationAnchor({ type: "freehand", points: [0, 0, 10, 10, 20, 20] }), { x: 10, y: 10 });
  assert.equal(annotationAnchor({ type: "point", x: Number.NaN, y: 1 }), null);
  assert.equal(annotationAnchor({ type: "freehand", points: [] }), null);
  assert.equal(annotationAnchor({ type: "unknown" }), null);
});

test("legenda: sem texto não há pílula; com texto fica dentro da foto e a linha guia liga a pílula à âncora", () => {
  assert.equal(labelLayout({ type: "point", x: 100, y: 100 }, 1000, 800), null);
  assert.equal(labelLayout({ type: "point", x: 100, y: 100, label: "   " }, 1000, 800), null);
  for (const [x, y] of [[20, 20], [500, 400], [980, 790], [10, 790]]) {
    const layout = labelLayout({ type: "point", x, y, label: "Sulco orbitário" }, 1000, 800);
    assert.ok(layout);
    assert.ok(layout.pill.x >= 0 && layout.pill.x + layout.pill.width <= 1000, `x ${x}`);
    assert.ok(layout.pill.y >= 0 && layout.pill.y + layout.pill.height <= 800, `y ${y}`);
    assert.deepEqual(layout.anchor, { x, y });
    const { join, pill } = layout;
    assert.ok(join.x >= pill.x - 0.001 && join.x <= pill.x + pill.width + 0.001);
    assert.ok(join.y >= pill.y - 0.001 && join.y <= pill.y + pill.height + 0.001);
  }
  const left = labelLayout({ type: "point", x: 300, y: 400, label: "Glabela" }, 1000, 800);
  const right = labelLayout({ type: "point", x: 800, y: 400, label: "Glabela" }, 1000, 800);
  assert.ok(left.pill.x + left.pill.width < 300, "âncora na esquerda: pílula à esquerda");
  assert.ok(right.pill.x > 800, "âncora na direita: pílula à direita");
});

test("legenda: texto longo é cortado no limite e a letra nunca fica menor que a leitura mínima na tela", () => {
  const layout = labelLayout({ type: "point", x: 500, y: 300, label: "x".repeat(200) }, 4000, 3000, 6);
  assert.equal(layout.text.length, 60);
  assert.ok(layout.fontSize >= 72);
  const small = labelLayout({ type: "point", x: 50, y: 30, label: "Ok" }, 300, 200, 0.5);
  assert.ok(small.fontSize >= 10);
});
