import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canArchiveFiles, canDeleteFiles, canSeeSystemDocument, canViewDocumentCategory, canWriteDocumentCategory, checkUpload, contentDisposition, detectFileType, displayNameFromFile, editActions,
  filterSystemDocuments, formatBytes, maxUploadBytes, parseDocumentQuery, sanitizeFileName, sortByDate, visibleDocumentCategories,
} from "../src/lib/clinical-files-rules.ts";
import { can } from "../src/lib/permissions.ts";

const pdf = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const exe = Uint8Array.from([0x4d, 0x5a, 0x90, 0x00]);

test("STAFF vê e envia só documentos administrativos; clínicos veem tudo", () => {
  assert.deepEqual(visibleDocumentCategories("STAFF"), ["TERMOS", "DECLARACOES", "ORIENTACOES"]);
  assert.equal(visibleDocumentCategories("ADMIN").length, 6);
  assert.equal(visibleDocumentCategories("PROFESSIONAL").length, 6);
  assert.deepEqual(visibleDocumentCategories(null), []);
  for (const category of ["EXAMES", "RECEITAS", "OUTROS"]) {
    assert.equal(canViewDocumentCategory("STAFF", category), false, category);
    assert.equal(canWriteDocumentCategory("STAFF", category), false, category);
    assert.equal(canViewDocumentCategory("PROFESSIONAL", category), true, category);
  }
  assert.equal(canWriteDocumentCategory("STAFF", "TERMOS"), true);
});

test("arquivar é de ADMIN/PROFESSIONAL, excluir só ADMIN; fotos só clínicos", () => {
  assert.equal(canArchiveFiles("ADMIN"), true);
  assert.equal(canArchiveFiles("PROFESSIONAL"), true);
  assert.equal(canArchiveFiles("STAFF"), false);
  assert.equal(canDeleteFiles("ADMIN"), true);
  assert.equal(canDeleteFiles("PROFESSIONAL"), false);
  assert.equal(canDeleteFiles("STAFF"), false);
  assert.equal(can("STAFF", "clinical:read"), false);
});

test("regras locais equivalem às permissões centrais", () => {
  for (const role of ["ADMIN", "PROFESSIONAL", "STAFF", null]) {
    assert.equal(canArchiveFiles(role), can(role, "clinical:archive"), String(role));
    assert.equal(canDeleteFiles(role), can(role, "clinical:delete"), String(role));
    assert.equal(canViewDocumentCategory(role, "EXAMES"), can(role, "clinical:read"), String(role));
    assert.equal(canSeeSystemDocument(role, "anamnesis"), can(role, "anamnesis:read"), String(role));
    assert.equal(canSeeSystemDocument(role, "evaluation"), can(role, "clinical:read"), String(role));
  }
});

test("itens de sistema seguem a permissão da origem", () => {
  assert.equal(canSeeSystemDocument("STAFF", "anamnesis"), false);
  assert.equal(canSeeSystemDocument("STAFF", "evaluation"), false);
  assert.equal(canSeeSystemDocument("PROFESSIONAL", "anamnesis"), true);
});

test("detecta o tipo pelos bytes e não pela extensão ou MIME", () => {
  assert.equal(detectFileType(pdf)?.mime, "application/pdf");
  assert.equal(detectFileType(jpeg)?.ext, "jpg");
  assert.equal(detectFileType(png)?.mime, "image/png");
  assert.equal(detectFileType(webp)?.mime, "image/webp");
  assert.equal(detectFileType(exe), null);
});

test("upload: rejeita vazio, grande, formato fora da lista, MIME incoerente e documento em foto", () => {
  assert.equal(checkUpload(new Uint8Array(0), undefined).ok, false);
  const big = new Uint8Array(maxUploadBytes + 1); big.set(pdf);
  const tooBig = checkUpload(big, "application/pdf");
  assert.equal(tooBig.ok, false); assert.equal(tooBig.status, 413);
  const bad = checkUpload(exe, "application/pdf");
  assert.equal(bad.ok, false); assert.equal(bad.status, 415);
  // arquivo .exe renomeado para imagem continua rejeitado
  assert.equal(checkUpload(exe, "image/jpeg").ok, false);
  // MIME declarado diferente do conteúdo
  assert.equal(checkUpload(pdf, "image/png").ok, false);
  assert.equal(checkUpload(pdf, undefined, { imageOnly: true }).ok, false);
  assert.equal(checkUpload(jpeg, "image/jpeg", { imageOnly: true }).ok, true);
  const ok = checkUpload(pdf, "application/pdf");
  assert.equal(ok.ok, true);
  assert.equal(ok.file.mime, "application/pdf");
  // MIME vazio/desconhecido do navegador não bloqueia quando o conteúdo é válido
  assert.equal(checkUpload(png, "").ok, true);
  assert.equal(checkUpload(png, "application/octet-stream").ok, true);
});

test("nomes: remove caminhos e caracteres perigosos; nunca vazio", () => {
  assert.equal(sanitizeFileName("../../etc/passwd"), "passwd");
  assert.equal(sanitizeFileName("C:\\fake\\termo.pdf"), "termo.pdf");
  assert.equal(sanitizeFileName("a<b>:\"c|d?.pdf"), "abcd.pdf");
  assert.equal(sanitizeFileName(""), "arquivo");
  assert.equal(sanitizeFileName(".."), "arquivo");
  assert.equal(sanitizeFileName(42), "arquivo");
  assert.equal(sanitizeFileName("x".repeat(500)).length, 160);
  assert.equal(displayNameFromFile("Laudo facial.PDF"), "Laudo facial");
});

test("Content-Disposition escapa aspas e usa ext do conteúdo", () => {
  const header = contentDisposition('Termo "a";b', "pdf", true);
  assert.match(header, /^attachment; filename="Termo a_b\.pdf"/);
  assert.match(contentDisposition("Laudo ção", "pdf", false), /^inline; filename="Laudo cao\.pdf"; filename\*=UTF-8''Laudo%20%C3%A7%C3%A3o\.pdf$/);
});

test("consulta: valida parâmetros e usa padrões seguros", () => {
  const defaults = parseDocumentQuery(new URLSearchParams());
  assert.equal(defaults.page, 1); assert.equal(defaults.pageSize, 9); assert.equal(defaults.sort, "recent"); assert.equal(defaults.category, null);
  const parsed = parseDocumentQuery(new URLSearchParams("category=EXAMES&page=3&pageSize=18&sort=name&from=2026-10-01&to=2026-10-31&q=%20laudo%20&archived=1"));
  assert.equal(parsed.category, "EXAMES"); assert.equal(parsed.page, 3); assert.equal(parsed.pageSize, 18); assert.equal(parsed.sort, "name"); assert.equal(parsed.q, "laudo"); assert.equal(parsed.archived, true);
  assert.ok(parsed.from < parsed.to);
  const invalid = parseDocumentQuery(new URLSearchParams("category=HACK&page=-1&pageSize=9999&sort=x&from=ontem"));
  assert.equal(invalid.category, null); assert.equal(invalid.page, 1); assert.equal(invalid.pageSize, 9); assert.equal(invalid.sort, "recent"); assert.equal(invalid.from, null);
});

test("itens de sistema respeitam categorias permitidas e filtros", () => {
  const items = [
    { id: "a", system: true, kind: "anamnesis", name: "Anamnese (v1)", category: "OUTROS", date: "2026-10-10T12:00:00.000Z", professional: "Dra. Ana", status: "Concluída", originRef: "1" },
    { id: "b", system: true, kind: "evaluation", name: "Avaliação inicial", category: "OUTROS", date: "2026-10-20T12:00:00.000Z", professional: "Dr. Bruno", status: "Concluída", originRef: "2" },
  ];
  const base = { category: null, q: "", professional: "", from: null, to: null, journeyId: "" };
  assert.equal(filterSystemDocuments(items, base, ["TERMOS"]).length, 0);
  assert.equal(filterSystemDocuments(items, base, ["OUTROS"]).length, 2);
  assert.equal(filterSystemDocuments(items, { ...base, q: "anam" }, ["OUTROS"]).length, 1);
  assert.equal(filterSystemDocuments(items, { ...base, professional: "bruno" }, ["OUTROS"]).length, 1);
  assert.equal(filterSystemDocuments(items, { ...base, journeyId: "j1" }, ["OUTROS"]).length, 0);
  assert.equal(filterSystemDocuments(items, { ...base, category: "EXAMES" }, ["OUTROS", "EXAMES"]).length, 0);
  assert.equal(sortByDate(items, "recent")[0].id, "b");
  assert.equal(sortByDate(items, "oldest")[0].id, "a");
});

test("ações de edição para a trilha e formatação de tamanho", () => {
  const before = { name: "A", category: "TERMOS", journeyId: null, encounterType: null, encounterId: null, signatureStatus: "PENDENTE" };
  assert.deepEqual(editActions(before, { ...before }), []);
  assert.deepEqual(editActions(before, { ...before, name: "B", category: "EXAMES", journeyId: "j", signatureStatus: "ASSINADO" }), ["RENAME", "RECATEGORIZE", "LINK", "SIGNATURE"]);
  assert.equal(formatBytes(500), "500 B"); assert.equal(formatBytes(245 * 1024), "245 KB"); assert.equal(formatBytes(1.5 * 1024 * 1024), "1,5 MB");
});
