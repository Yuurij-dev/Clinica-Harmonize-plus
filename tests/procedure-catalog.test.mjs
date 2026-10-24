import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkUpload, maxUploadBytes } from "../src/lib/clinical-files-rules.ts";
import { filterCatalog, isValidId, maxDurationMinutes, maxPriceReais, normalizeSearch, parseCatalogListParams, parseCreateProcedure, parseDuration, parseName, parseNumeric, parsePatchProcedure, parsePrice } from "../src/lib/procedure-catalog-rules.ts";
import { isSafeCatalogImageFile, orphanCutoff, orphanImageMaxAgeMs, orphanPurgeBatch, procedureImageUrl, resolveProcedureImageRef } from "../src/lib/procedure-image-rules.ts";

const manifest = JSON.parse(readFileSync(new URL("../public/images/procedimentos/manifest.json", import.meta.url), "utf8"));
const base = { price: 900, durationMinutes: 30 };

test("imagem por id: enviada > biblioteca > catálogo > nenhuma, sem depender do nome", () => {
  assert.deepEqual(resolveProcedureImageRef({ assetId: "a1", libraryImageFile: "/images/procedimentos/botox.webp", catalogImageFile: "/images/procedimentos/skinbooster.webp" }), { kind: "custom", url: "/api/procedures/images/a1" });
  assert.deepEqual(resolveProcedureImageRef({ libraryImageFile: "/images/procedimentos/botox.webp", catalogImageFile: "/images/procedimentos/skinbooster.webp" }), { kind: "catalog", url: "/images/procedimentos/botox.webp" });
  assert.deepEqual(resolveProcedureImageRef({ catalogImageFile: "/images/procedimentos/skinbooster.webp" }), { kind: "catalog", url: "/images/procedimentos/skinbooster.webp" });
  assert.deepEqual(resolveProcedureImageRef({}), { kind: "none", url: null });
  assert.deepEqual(resolveProcedureImageRef({ assetId: null, catalogImageFile: null }), { kind: "none", url: null });
  assert.equal(procedureImageUrl("a/b"), "/api/procedures/images/a%2Fb");
});

test("arquivo de catálogo só aceita caminhos estáticos do próprio diretório", () => {
  for (const entry of manifest) assert.ok(isSafeCatalogImageFile(entry.file), entry.file);
  for (const bad of ["https://x.test/a.webp", "//x/a.webp", "/images/procedimentos/../../.env", "/images/procedimentos/a/b.webp", "/api/x.webp", "javascript:alert(1)", null, 3]) assert.equal(isSafeCatalogImageFile(bad), false, String(bad));
  assert.deepEqual(resolveProcedureImageRef({ catalogImageFile: "https://x.test/a.webp" }), { kind: "none", url: null });
});

test("busca no catálogo ignora acento, caixa e ordem dos termos", () => {
  const items = manifest.map((entry) => ({ name: entry.name, slug: entry.slug }));
  assert.equal(normalizeSearch("  HarmonizaÇão   Facial "), "harmonizacao facial");
  assert.equal(filterCatalog(items, "").length, items.length);
  assert.ok(filterCatalog(items, "HARMONIZACAO").some((item) => item.slug === "harmonizacao-facial"));
  assert.ok(filterCatalog(items, "facial harmonização").some((item) => item.slug === "harmonizacao-facial"));
  assert.ok(filterCatalog(items, "lipo").some((item) => item.slug === "lipo-de-papada"));
  assert.equal(filterCatalog(items, "zzzz-inexistente").length, 0);
});

test("parâmetros de listagem do catálogo têm limite", () => {
  assert.deepEqual(parseCatalogListParams(new URLSearchParams("")), { q: "", limit: 100, offset: 0 });
  assert.deepEqual(parseCatalogListParams(new URLSearchParams("q=botox&limit=5000&offset=-3")), { q: "botox", limit: 100, offset: 0 });
  assert.deepEqual(parseCatalogListParams(new URLSearchParams("limit=10&offset=20")), { q: "", limit: 10, offset: 20 });
});

test("criação a partir do catálogo: exige catalogItemId; categoria é opcional", () => {
  const ok = parseCreateProcedure({ catalogItemId: "cat_botox", ...base });
  assert.deepEqual(ok, { ok: true, data: { mode: "catalog", catalogItemId: "cat_botox", category: "", ...base } });
  assert.equal(parseCreateProcedure({ ...base }).ok, false); // sem catalogItemId vira personalizado e exige nome
  assert.equal(parseCreateProcedure({ catalogItemId: "  ", ...base }).ok, false);
  assert.equal(parseCreateProcedure({ catalogItemId: "cat_botox", ...base, price: "" }).ok, false);
  assert.equal(parseCreateProcedure({ catalogItemId: "cat_botox", ...base, durationMinutes: 30.5 }).ok, false);
  assert.equal(parseCreateProcedure(null).ok, false);
  const clamped = parseCreateProcedure({ catalogItemId: "x", price: -5, durationMinutes: 0, margin: 500, category: " Facial " });
  assert.deepEqual(clamped.data, { mode: "catalog", catalogItemId: "x", category: "Facial", price: 0, durationMinutes: 1 });
});

test("criação personalizada: nome obrigatório, uma só imagem, sem category", () => {
  const ok = parseCreateProcedure({ custom: true, name: "  Meu   protocolo ", ...base });
  assert.deepEqual(ok.data, { mode: "custom", name: "Meu protocolo", imageAssetId: null, catalogImageId: null, category: "", ...base });
  assert.equal(parseCreateProcedure({ custom: true, name: "  ", ...base }).ok, false);
  assert.equal(parseCreateProcedure({ custom: true, name: "x".repeat(121), ...base }).ok, false);
  assert.equal(parseCreateProcedure({ custom: true, name: "A", imageAssetId: "i1", ...base }).data.imageAssetId, "i1");
  assert.equal(parseCreateProcedure({ custom: true, name: "A", catalogImageId: "cat_botox", ...base }).data.catalogImageId, "cat_botox");
  assert.equal(parseCreateProcedure({ custom: true, name: "A", imageAssetId: "i1", catalogImageId: "cat_botox", ...base }).ok, false);
  assert.equal(parseCreateProcedure({ custom: true, name: "A", imageAssetId: 5, ...base }).ok, false);
  // cliente antigo: só name (e category) cria personalizado; catalogItemId vence quando enviado
  assert.equal(parseCreateProcedure({ name: "A", category: "Facial", ...base }).data.mode, "custom");
  assert.equal(parseCreateProcedure({ catalogItemId: "cat_botox", name: "Outro", ...base }).data.mode, "catalog");
});

test("edição: nome vazio recusado, imagem opcional, categoria não obrigatória", () => {
  assert.equal(parsePatchProcedure({ name: "   " }).ok, false);
  assert.deepEqual(parsePatchProcedure({ price: 10 }), { ok: true, data: { price: 10 } });
  assert.deepEqual(parsePatchProcedure({ margin: 150 }), { ok: true, data: {} });
  assert.deepEqual(parsePatchProcedure({ name: " Novo  nome ", category: "" }).data, { name: "Novo nome", category: "" });
  assert.deepEqual(parsePatchProcedure({ imageAssetId: null, catalogImageId: null }).data, { image: { assetId: null, catalogImageId: null } });
  assert.deepEqual(parsePatchProcedure({ catalogImageId: "cat_botox" }).data, { image: { assetId: null, catalogImageId: "cat_botox" } });
  assert.equal(parsePatchProcedure({ imageAssetId: "a", catalogImageId: "b" }).ok, false);
  // campo enviado e inválido é recusado (não ignorado); só campo ausente é ignorado
  for (const body of [{ price: "" }, { durationMinutes: "" }, { price: true }, { durationMinutes: [] }, { category: 5 }]) assert.equal(parsePatchProcedure(body).ok, false, JSON.stringify(body));
  assert.deepEqual(parsePatchProcedure({}).data, {});
});

test("upload de imagem de procedimento: só JPEG/PNG/WebP por bytes, até 4 MB", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  for (const [bytes, mime] of [[png, "image/png"], [jpg, "image/jpeg"], [webp, "image/webp"]]) assert.equal(checkUpload(bytes, mime, { imageOnly: true }).ok, true);
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal(checkUpload(svg, "image/svg+xml", { imageOnly: true }).ok, false);
  assert.equal(checkUpload(new TextEncoder().encode("não sou imagem"), "image/png", { imageOnly: true }).ok, false);
  assert.equal(checkUpload(png, "image/jpeg", { imageOnly: true }).ok, false);
  assert.equal(checkUpload(new Uint8Array(0), "image/png", { imageOnly: true }).ok, false);
  const big = new Uint8Array(maxUploadBytes + 1); big.set(png);
  const tooBig = checkUpload(big, "image/png", { imageOnly: true });
  assert.equal(tooBig.ok, false);
  assert.equal(tooBig.status, 413);
  const pdf = new TextEncoder().encode("%PDF-1.4 ...");
  assert.equal(checkUpload(pdf, "application/pdf", { imageOnly: true }).ok, false);
});

test("migration do catálogo semeia exatamente os itens do manifest com ids determinísticos", () => {
  const sql = readFileSync(new URL("../prisma/migrations/20261022010000_procedure_catalog/migration.sql", import.meta.url), "utf8");
  assert.equal(new Set(manifest.map((entry) => entry.slug)).size, manifest.length);
  for (const entry of manifest) assert.ok(sql.includes(`('cat_${entry.slug}', '${entry.slug}',`), entry.slug);
  assert.match(sql, /ON CONFLICT \("slug"\) DO NOTHING/);
});

test("órfãs são as enviadas há mais de 24 h; lote de limpeza é limitado", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  assert.equal(orphanCutoff(now).toISOString(), "2026-10-21T12:00:00.000Z");
  assert.equal(orphanImageMaxAgeMs, 86_400_000);
  assert.ok(orphanPurgeBatch > 0 && orphanPurgeBatch <= 50);
});

test("números: só número finito ou texto decimal simples", () => {
  for (const ok of [0, 12, 12.5, "12", " 12.5 ", "-3"]) assert.notEqual(parseNumeric(ok), null, String(ok));
  for (const bad of [" ", "", "0x10", "1e3", "NaN", "Infinity", NaN, Infinity, true, [], [5], {}, null, undefined, "1,5"]) assert.equal(parseNumeric(bad), null, JSON.stringify(bad));
});

test("preço: reais com centavos (2 casas), vírgula pt-BR, nunca negativo, teto do domínio", () => {
  assert.equal(parsePrice(150.5).data, 150.5);
  assert.equal(parsePrice("99.9").data, 99.9);
  assert.equal(parsePrice("349,90").data, 349.9);
  assert.equal(parsePrice("1.234,50").data, 1234.5);
  assert.equal(parsePrice(349.9).data, 349.9);
  assert.equal(parsePrice(0.1 + 0.2).data, 0.3);
  assert.equal(parsePrice(1.999).data, 2);
  assert.equal(parsePrice("0,00").data, 0);
  assert.equal(parsePrice("-5,50").data, 0);
  assert.equal(parsePrice(-5).data, 0);
  assert.equal(parsePrice(maxPriceReais).data, maxPriceReais);
  for (const bad of [maxPriceReais + 1, 2147483648, 1e30, "abc", true, NaN, Infinity, "1,2,3", "12,5x", null, ""]) assert.equal(parsePrice(bad).ok, false, String(bad));
});

test("duração: minutos inteiros de 1 ao teto", () => {
  assert.equal(parseDuration(0).data, 1);
  assert.equal(parseDuration("45").data, 45);
  assert.equal(parseDuration(maxDurationMinutes).data, maxDurationMinutes);
  for (const bad of [maxDurationMinutes + 1, 30.5, 1e10, "0x10", [], true]) assert.equal(parseDuration(bad).ok, false, String(bad));
});

test("nome: recusa NUL, controle e substituto solitário; espaços internos colapsam", () => {
  assert.equal(parseName("  A \t\n B ").data, "A B");
  assert.equal(parseName("Peeling 😀").ok, true);
  for (const bad of ["a\u0000b", "a\u0007b", "a\u007fb", "a\ud800b", "a\udc00b", "", "   ", 5, null, "x".repeat(121)]) assert.equal(parseName(bad).ok, false, JSON.stringify(bad));
});

test("ids: só letras, números, _ e -, até 100; catalogItemId malformado não vira personalizado", () => {
  for (const ok of ["cat_botox", "cmvit41nv0005ua34rn5b6e4r", "a".repeat(100)]) assert.equal(isValidId(ok), true);
  for (const bad of ["", "a".repeat(101), "a\u0000b", "../x", "a b", "x%00", 5, null]) assert.equal(isValidId(bad), false, String(bad));
  const base = { name: "Nome", price: 1, durationMinutes: 1 };
  for (const bad of [5, "", "a".repeat(101), "x y", ["a"], { $ne: 1 }, "../x"]) assert.equal(parseCreateProcedure({ ...base, catalogItemId: bad }).ok, false, JSON.stringify(bad));
  assert.equal(parseCreateProcedure({ ...base, catalogItemId: null }).data.mode, "custom");
  for (const bad of [" ", "0x10", [], true, "1e3", "abc"]) assert.equal(parseCreateProcedure({ name: "A", price: bad, durationMinutes: 1 }).ok, false, JSON.stringify(bad));
});
