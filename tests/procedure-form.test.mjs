import assert from "node:assert/strict";
import { test } from "node:test";
import { filterCatalog, maxProcedureNameLength, normalizeSearch, parseCreateProcedure, parsePatchProcedure } from "../src/lib/procedure-catalog-rules.ts";
import { indexProcedureImagesByName, procedureNameKey as imageKey, safeProcedureImageSrc } from "../src/lib/procedure-image-rules.ts";
import {
  buildCatalogCreateBody, buildCustomCreateBody, buildPatchBody, imageFields, maxImageBytes, nameAlreadyUsed,
  procedureNameKey as formKey, validateImageFile, validateProcedureFields,
} from "../src/lib/procedure-form-rules.ts";

const fields = { price: 250, durationMinutes: 45, margin: 40, technicalSheet: [{ productId: "p1", quantity: 2 }] };

test("name keys duplicated for dependency-free tests stay identical to normalizeSearch", () => {
  for (const value of ["  Toxina  Botulínica ", "PREENCHIMENTO de Olheira", "ação", ""]) {
    assert.equal(imageKey(value), normalizeSearch(value));
    assert.equal(formKey(value), normalizeSearch(value));
  }
  // O limite do formulário precisa acompanhar o do servidor.
  assert.equal(validateProcedureFields({ name: "a".repeat(maxProcedureNameLength + 1), price: 1, durationMinutes: 1, margin: 1 }), `O nome deve ter até ${maxProcedureNameLength} caracteres.`);
  assert.equal(validateProcedureFields({ name: "a".repeat(maxProcedureNameLength), price: 1, durationMinutes: 1, margin: 1 }), null);
});

test("catalog search ignores accents, case and extra spaces and matches all terms", () => {
  const items = [{ name: "Toxina Botulínica", slug: "botox" }, { name: "Preenchimento Labial", slug: "preenchimento-labial" }, { name: "Peeling", slug: "peeling" }];
  assert.deepEqual(filterCatalog(items, "  BOTULINICA ").map((item) => item.slug), ["botox"]);
  assert.deepEqual(filterCatalog(items, "preench lab").map((item) => item.slug), ["preenchimento-labial"]);
  assert.deepEqual(filterCatalog(items, "botox").map((item) => item.slug), ["botox"]);
  assert.equal(filterCatalog(items, "inexistente").length, 0);
  assert.equal(filterCatalog(items, "").length, 3);
});

test("client image validation accepts JPEG/PNG/WebP up to 4 MB and explains refusals", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"]) assert.equal(validateImageFile({ type, size: 1000 }), null);
  assert.equal(validateImageFile({ type: "image/webp", size: maxImageBytes }), null);
  assert.match(validateImageFile({ type: "image/webp", size: maxImageBytes + 1 }), /4 MB/);
  assert.match(validateImageFile({ type: "image/svg+xml", size: 10 }), /JPEG, PNG ou WebP/);
  assert.match(validateImageFile({ type: "application/pdf", size: 10 }), /JPEG, PNG ou WebP/);
  assert.match(validateImageFile({ type: "image/png", size: 0 }), /vazio/);
});

test("field validation covers name, price, duration and margin", () => {
  assert.equal(validateProcedureFields({ name: "  ", price: 1, durationMinutes: 30, margin: 10 }), "Informe o nome do procedimento.");
  assert.equal(validateProcedureFields({ price: 0, durationMinutes: 30, margin: 0 }), null);
  assert.match(validateProcedureFields({ price: -1, durationMinutes: 30, margin: 10 }), /valor/);
  assert.match(validateProcedureFields({ price: 10, durationMinutes: 0, margin: 10 }), /duração/);
  assert.match(validateProcedureFields({ price: 10, durationMinutes: 30, margin: 101 }), /margem/);
});

test("name duplicates are detected ignoring accents/case, except for the procedure being edited", () => {
  const existing = [{ id: "a", name: "Toxina Botulínica" }, { id: "b", name: "Peeling" }];
  assert.equal(nameAlreadyUsed(" toxina botulinica ", existing), true);
  assert.equal(nameAlreadyUsed("Toxina Botulínica", existing, "a"), false);
  assert.equal(nameAlreadyUsed("Skinbooster", existing), false);
  assert.equal(nameAlreadyUsed("   ", existing), false);
});

test("create body for a catalog item sends only the reference and the clinic fields, no name or category", () => {
  const body = buildCatalogCreateBody("cat1", fields);
  assert.deepEqual(body, { catalogItemId: "cat1", ...fields });
  assert.ok(!("name" in body) && !("category" in body));
  assert.deepEqual(parseCreateProcedure(JSON.parse(JSON.stringify(body))).data.mode, "catalog");
});

test("create body for a custom procedure references the image by id and is accepted by the API parser", () => {
  const library = buildCustomCreateBody("  Skin   booster ", { kind: "library", catalogImageId: "img1" }, fields);
  assert.deepEqual(library, { custom: true, name: "Skin booster", catalogImageId: "img1", ...fields });
  const upload = buildCustomCreateBody("Skin booster", { kind: "upload", assetId: "as1" }, fields);
  assert.equal(upload.imageAssetId, "as1");
  assert.ok(!("catalogImageId" in upload));
  const none = buildCustomCreateBody("Skin booster", { kind: "none" }, fields);
  assert.equal(none.imageAssetId, null);
  assert.equal(none.catalogImageId, null);
  for (const body of [library, upload, none]) {
    const parsed = parseCreateProcedure({ ...body, price: body.price, durationMinutes: body.durationMinutes });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.data.mode, "custom");
  }
  assert.ok(!JSON.stringify(library).includes("data:"), "never base64");
});

test("patch body only touches the image when the choice changes; null/null removes it", () => {
  assert.deepEqual(imageFields({ kind: "keep" }), {});
  const keep = buildPatchBody("Peeling", { kind: "keep" }, fields);
  assert.ok(!("imageAssetId" in keep) && !("catalogImageId" in keep));
  assert.equal(parsePatchProcedure(keep).data.image, undefined);
  const removed = buildPatchBody("Peeling", { kind: "none" }, fields);
  assert.deepEqual(parsePatchProcedure(removed).data.image, { assetId: null, catalogImageId: null });
  const swapped = buildPatchBody("Peeling", { kind: "upload", assetId: "as2" }, fields);
  assert.deepEqual(parsePatchProcedure(swapped).data.image, { assetId: "as2", catalogImageId: null });
  assert.ok(!("category" in keep));
});

test("images resolve by name only from the clinic's own procedures and only safe sources", () => {
  const index = indexProcedureImagesByName([
    { name: "Toxina Botulínica", image: { kind: "catalog", url: "/images/procedimentos/botox.webp" } },
    { name: "Meu Peeling", image: { kind: "custom", url: "/api/procedures/images/abc123" } },
    { name: "Sem imagem", image: { kind: "none", url: null } },
    { name: "Externa", image: { url: "https://evil.example/x.png" } },
  ]);
  assert.equal(index.get(imageKey("toxina botulinica")), "/images/procedimentos/botox.webp");
  assert.equal(index.get(imageKey("MEU PEELING")), "/api/procedures/images/abc123");
  assert.equal(index.has(imageKey("Sem imagem")), false);
  assert.equal(index.has(imageKey("Externa")), false);
  assert.equal(index.get(imageKey("Toxina")), undefined, "exact name only");
  assert.equal(safeProcedureImageSrc("/api/procedures/images/../../secret"), null);
  assert.equal(safeProcedureImageSrc("//cdn.test/a.png"), null);
  assert.equal(safeProcedureImageSrc(null), null);
});

test("local preview accepts only blob: URLs while API image sources stay strict", async () => {
  const { localPreviewSrc } = await import("../src/lib/procedure-image-rules.ts");
  assert.equal(localPreviewSrc("blob:http://localhost:3001/3f2c-aa"), "blob:http://localhost:3001/3f2c-aa");
  for (const bad of ["https://evil.test/a.png", "/api/procedures/images/x", "data:image/png;base64,AAAA", "javascript:alert(1)", "blob:<script>", null, undefined, 5]) assert.equal(localPreviewSrc(bad), null);
  assert.equal(safeProcedureImageSrc("blob:http://localhost:3001/3f2c-aa"), null);
});

test("margin outside 0-100 is reported on the margin field, never clamped", async () => {
  const { findFieldProblem } = await import("../src/lib/procedure-form-rules.ts");
  assert.deepEqual(findFieldProblem({ price: 1, durationMinutes: 30, margin: 150 }), { field: "margin", message: "A margem deve ficar entre 0% e 100%." });
  assert.equal(findFieldProblem({ price: 1, durationMinutes: 30, margin: 100 }), null);
  assert.equal(findFieldProblem({ name: "", price: 1, durationMinutes: 30, margin: 5 }).field, "name");
});

test("upload 413/415 use the client message; other statuses keep the server text", async () => {
  const { uploadErrorMessage } = await import("../src/lib/procedure-form-rules.ts");
  assert.equal(uploadErrorMessage(415, "Envie PDF, JPG ou PNG"), "Use uma imagem JPEG, PNG ou WebP de até 4 MB.");
  assert.equal(uploadErrorMessage(413, "excede"), "Use uma imagem JPEG, PNG ou WebP de até 4 MB.");
  assert.match(uploadErrorMessage(409, "Limite de imagens personalizadas atingido."), /Limite/);
  assert.match(uploadErrorMessage(500, null), /enviar a imagem/);
});

test("catalog search finds items by synonyms but only items that exist", async () => {
  const { searchCatalog, catalogSynonyms } = await import("../src/lib/procedure-form-rules.ts");
  const manifest = JSON.parse((await import("node:fs")).readFileSync(new URL("../public/images/procedimentos/manifest.json", import.meta.url), "utf8"));
  const items = manifest.map(({ slug, name }) => ({ slug, name }));
  const slugs = (q) => searchCatalog(items, q).map((item) => item.slug);
  assert.deepEqual(slugs("toxina botulínica"), ["botox"]);
  assert.ok(slugs("Olheiras").includes("preenchimento-de-olheiras"));
  assert.ok(slugs("lábios").includes("preenchimento-labial"));
  assert.ok(slugs("colageno").includes("bioestimulador-de-colageno"));
  assert.ok(slugs("fios").includes("fios-de-sustentacao"));
  assert.ok(slugs("peeling").includes("peelings-quimicos"));
  assert.ok(slugs("led").includes("ledterapia"));
  assert.ok(slugs("cicatriz").includes("tratamento-para-cicatrizes"));
  assert.equal(slugs("").length, items.length);
  assert.equal(slugs("zzzz").length, 0);
  const known = new Set(items.map((item) => item.slug));
  for (const list of Object.values(catalogSynonyms)) for (const slug of list) assert.ok(known.has(slug), `slug inexistente: ${slug}`);
});

test("duration above 1440 minutes is rejected with a clear message", async () => {
  const { findFieldProblem } = await import("../src/lib/procedure-form-rules.ts");
  assert.deepEqual(findFieldProblem({ price: 1, durationMinutes: 1441, margin: 5 }), { field: "duration", message: "A duração máxima é 1440 minutos." });
  assert.equal(findFieldProblem({ price: 1, durationMinutes: 1440, margin: 5 }), null);
});
