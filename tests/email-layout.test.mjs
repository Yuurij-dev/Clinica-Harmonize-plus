import assert from "node:assert/strict";
import test from "node:test";
import { composeEmail, heading, paragraph, infoCard, highlight, button, note } from "../src/lib/email-layout.ts";

test("escapa valores hostis em todos os blocos", () => {
  const { html } = composeEmail({
    preheader: "<x1>",
    greeting: "<x2>",
    blocks: [
      heading("<x3>"),
      paragraph("<x4>"),
      infoCard([["<x5>", "<x6>"]]),
      highlight("<x7>", "<x8>"),
      note("<x9>"),
      button("https://ex.com/<x10>", "<x11>"),
    ],
    clinic: { name: "<x12>", rows: [["<x13>", "<x14>"]] },
  });
  for (let i = 1; i <= 14; i += 1) assert.ok(!html.includes(`<x${i}>`), `vazou <x${i}>`);
  assert.ok(html.includes("&lt;x3&gt;"));
  assert.ok(html.includes("&lt;x6&gt;"));
});

test("documento completo, rodapé e botão corretos", () => {
  const { html, text } = composeEmail({ preheader: "p", blocks: [button("https://ex.com/a", "Aceitar")], automated: true });
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes('href="https://ex.com/a"'));
  assert.ok(html.includes("Harmonize"));
  assert.ok(html.includes("harmonizeplus.com.br"));
  assert.ok(html.includes("e-mail automático"));
  assert.ok(text.includes("https://ex.com/a") && text.includes("Harmonize+"));
});

test("sem clínica e sem automated: rodapé enxuto", () => {
  const { html } = composeEmail({ preheader: "p", blocks: [paragraph("oi")], automated: false });
  assert.ok(!html.includes("e-mail automático"));
});

test("infoCard com rows vazio nao quebra", () => {
  const { html } = composeEmail({ preheader: "p", blocks: [infoCard([])] });
  assert.ok(html.includes("<!doctype html>"));
});
