import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { test } from "node:test";
import { resolveProcedureImage } from "../src/lib/procedure-images.js";

const manifest = JSON.parse(readFileSync(new URL("../public/images/procedimentos/manifest.json", import.meta.url), "utf8"));

test("every procedure manifest entry points to an existing local image with descriptive alt", () => {
  assert.ok(manifest.length > 0);
  for (const entry of manifest) {
    assert.match(entry.file, /^\/images\/procedimentos\/[a-z0-9-]+\.webp$/);
    assert.ok(entry.alt.trim().length > 0);
    assert.ok(statSync(new URL(`../public${entry.file}`, import.meta.url)).isFile());
    assert.deepEqual(resolveProcedureImage(entry.name), {
      src: entry.file,
      alt: entry.alt,
      slug: entry.slug,
      custom: false,
    });
  }
});

test("manifest lookup ignores accents and casing but requires an exact normalized name", () => {
  assert.equal(resolveProcedureImage("  HARMONIZACAO FACIAL ").src, "/images/procedimentos/harmonizacao-facial.webp");
  assert.equal(resolveProcedureImage("nome parecido com harmonização facial").src, null);
});

test("only explicit exact aliases map to catalog images", () => {
  assert.equal(resolveProcedureImage("TOXINA BOTULINICA").slug, "botox");
  assert.equal(resolveProcedureImage("Preenchimento de olheira").slug, "preenchimento-de-olheiras");
  assert.equal(resolveProcedureImage("LED terapia").slug, "ledterapia");
  assert.equal(resolveProcedureImage("toxina botulínica facial").src, null);
});

test("custom image URL is prioritized only when it is a safe local or HTTPS URL", () => {
  assert.deepEqual(resolveProcedureImage("Botox", "/clinic/procedure.webp"), {
    src: "/clinic/procedure.webp",
    alt: "Imagem ilustrativa de Botox",
    custom: true,
  });
  assert.equal(resolveProcedureImage("Botox", "https://cdn.example.test/botox.webp").custom, true);
  assert.equal(resolveProcedureImage("Botox", "javascript:alert(1)").src, "/images/procedimentos/botox.webp");
  assert.equal(resolveProcedureImage("Botox", "//cdn.example.test/botox.webp").src, "/images/procedimentos/botox.webp");
});
