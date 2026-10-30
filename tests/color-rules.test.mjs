import assert from "node:assert/strict";
import { test } from "node:test";
import { hexToHsv, hexToRgb, hsvToHex, hsvToRgb, hueFromPoint, normalizeHex, rgbToHex, rgbToHsv } from "../src/lib/color-rules.ts";

test("hex: aceita #abc, abc, maiúsculas e devolve #rrggbb minúsculo; o resto é nulo", () => {
  assert.equal(normalizeHex("#5147DC"), "#5147dc");
  assert.equal(normalizeHex("5147dc"), "#5147dc");
  assert.equal(normalizeHex(" #abc "), "#aabbcc");
  assert.equal(normalizeHex("#12345"), null);
  assert.equal(normalizeHex("#gggggg"), null);
  assert.equal(normalizeHex(""), null);
});

test("hex <-> rgb", () => {
  assert.deepEqual(hexToRgb("#5147dc"), [81, 71, 220]);
  assert.equal(rgbToHex(81, 71, 220), "#5147dc");
  assert.equal(rgbToHex(300, -4, 12.4), "#ff000c");
  assert.equal(hexToRgb("xyz"), null);
});

test("cores primárias e eixos do HSV", () => {
  assert.deepEqual(rgbToHsv(255, 0, 0), { h: 0, s: 1, v: 1 });
  assert.equal(rgbToHsv(0, 255, 0).h, 120);
  assert.equal(rgbToHsv(0, 0, 255).h, 240);
  assert.deepEqual(rgbToHsv(255, 255, 255), { h: 0, s: 0, v: 1 });
  assert.deepEqual(rgbToHsv(0, 0, 0), { h: 0, s: 0, v: 0 });
  assert.deepEqual(hsvToRgb({ h: 60, s: 1, v: 1 }), [255, 255, 0]);
  assert.deepEqual(hsvToRgb({ h: 300, s: 1, v: 0.5 }), [128, 0, 128]);
  assert.equal(hsvToHex({ h: 360, s: 1, v: 1 }), "#ff0000");
  assert.equal(hsvToHex({ h: -120, s: 1, v: 1 }), "#0000ff");
});

test("ida e volta hex -> HSV -> hex não perde a cor (a roda não desloca a cor escolhida)", () => {
  for (const hex of ["#5147dc", "#ff3b30", "#2563eb", "#16a34a", "#ffffff", "#000000", "#7c3aed", "#808080", "#0f0f10"]) {
    assert.equal(hsvToHex(hexToHsv(hex)), hex, hex);
  }
  assert.deepEqual(hexToHsv("nada"), { h: 0, s: 0, v: 0 });
});

test("matiz pelo ponto: topo 0, direita 90, baixo 180, esquerda 270", () => {
  assert.equal(hueFromPoint(50, 0, 50, 50), 0);
  assert.equal(hueFromPoint(100, 50, 50, 50), 90);
  assert.equal(hueFromPoint(50, 100, 50, 50), 180);
  assert.equal(hueFromPoint(0, 50, 50, 50), 270);
});
