import assert from "node:assert/strict";
import { test } from "node:test";
import { countUpValueAt, easeOutCubic, progressScale, resolveCountUpDuration, staggerDelay, toFiniteNumber } from "../src/lib/count-up-rules.ts";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

test("easeOutCubic is monotonic, starts at 0, ends at 1 and clamps", () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.equal(easeOutCubic(-3), 0);
  assert.equal(easeOutCubic(7), 1);
  assert.ok(easeOutCubic(0.5) > 0.5);
  assert.ok(easeOutCubic(0.2) < easeOutCubic(0.4));
});

test("countUpValueAt interpolates from the previous value and ends exactly on the target", () => {
  assert.equal(countUpValueAt(0, 1234.56, 0, 550), 0);
  assert.equal(countUpValueAt(0, 1234.56, 550, 550), 1234.56);
  assert.equal(countUpValueAt(0, 1234.56, 5000, 550), 1234.56);
  const mid = countUpValueAt(100, 200, 275, 550);
  assert.ok(mid > 100 && mid < 200);
  assert.ok(countUpValueAt(100, 0, 300, 550) < 100, "counts down as well");
  assert.ok(countUpValueAt(-50, -10, 300, 550) > -50, "supports negatives");
  assert.equal(countUpValueAt(3, 9, 10, 0), 9);
});

test("non-finite inputs never reach the formatter as NaN", () => {
  assert.equal(toFiniteNumber(undefined), 0);
  assert.equal(toFiniteNumber(Number.NaN), 0);
  assert.equal(toFiniteNumber(Infinity), 0);
  assert.equal(toFiniteNumber("12"), 0);
  assert.equal(toFiniteNumber(-4.5), -4.5);
});

test("interpolated values keep the pt-BR formatting of the existing formatters", () => {
  const frames = [0, 0.25, 0.5, 1].map((fraction) => brl.format(countUpValueAt(0, 1234.5, fraction * 550, 550)));
  assert.match(frames[0], /R\$\s?0,00/);
  assert.match(frames[3], /R\$\s?1\.234,50/);
  for (const frame of frames) assert.match(frame, /^R\$\s?[\d.]+,\d{2}$/);
  assert.equal(`${Math.round(countUpValueAt(0, 87, 550, 550))}%`, "87%");
});

test("duration falls back to 550ms and never goes below the minimum", () => {
  assert.equal(resolveCountUpDuration(undefined), 550);
  assert.equal(resolveCountUpDuration(Number.NaN), 550);
  assert.equal(resolveCountUpDuration(10), 150);
  assert.equal(resolveCountUpDuration(600), 600);
});

test("progressScale clamps percentages and ignores invalid values", () => {
  assert.equal(progressScale(0), 0);
  assert.equal(progressScale(50), 0.5);
  assert.equal(progressScale(150), 1);
  assert.equal(progressScale(-20), 0);
  assert.equal(progressScale(undefined), 0);
  assert.equal(progressScale(Number.NaN), 0);
});

test("staggerDelay is linear and capped", () => {
  assert.equal(staggerDelay(0, 60), 0);
  assert.equal(staggerDelay(3, 60), 180);
  assert.equal(staggerDelay(40, 60), 720);
  assert.equal(staggerDelay(-2, 60), 0);
});
