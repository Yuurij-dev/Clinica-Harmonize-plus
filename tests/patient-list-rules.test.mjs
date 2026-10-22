import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accentFrom, accentTo, cleanSearchQuery, escapeLikePattern, normalizeSearchText, paginationMeta, parsePageParams,
  parsePatientListQuery, parsePatientLookupLimit, patientListKey, patientLookupKey, patientLookupMinLength, isPatientIdFormat, searchDigits, stripControlChars,
} from "../src/lib/patient-list-rules.ts";

const params = (query) => new URLSearchParams(query);

test("page and pageSize fall back to safe values and respect the limits", () => {
  assert.deepEqual(parsePageParams(params("")), { page: 1, pageSize: 20 });
  assert.deepEqual(parsePageParams(params("page=3&pageSize=50")), { page: 3, pageSize: 50 });
  assert.deepEqual(parsePageParams(params("page=0&pageSize=0")), { page: 1, pageSize: 20 });
  assert.deepEqual(parsePageParams(params("page=-4&pageSize=-1")), { page: 1, pageSize: 20 });
  assert.deepEqual(parsePageParams(params("page=abc&pageSize=1e3")), { page: 1, pageSize: 20 });
  assert.deepEqual(parsePageParams(params("page=2.5&pageSize=10.5")), { page: 1, pageSize: 20 });
  assert.equal(parsePageParams(params("pageSize=101")).pageSize, 100);
  assert.equal(parsePageParams(params("pageSize=100000")).pageSize, 100);
  assert.equal(parsePageParams(params("page=99999999999999999999")).page, 1);
  assert.equal(parsePageParams(params("page=9999999")).page, 100_000);
  assert.deepEqual(parsePageParams(params("pageSize=500"), { maxPageSize: 50 }), { page: 1, pageSize: 50 });
});

test("pagination metadata counts pages and keeps empty results consistent", () => {
  assert.deepEqual(paginationMeta(1, 20, 0), { page: 1, pageSize: 20, total: 0, pageCount: 0 });
  assert.deepEqual(paginationMeta(2, 20, 41), { page: 2, pageSize: 20, total: 41, pageCount: 3 });
  assert.deepEqual(paginationMeta(9, 20, 41), { page: 9, pageSize: 20, total: 41, pageCount: 3 });
});

test("patient list query normalizes search, status and sort", () => {
  assert.deepEqual(parsePatientListQuery(params("")), { page: 1, pageSize: 20, q: "", status: "", sort: "name" });
  assert.deepEqual(parsePatientListQuery(params("q=%20%20Ana%20%20Maria%20&status=Ativa&sort=recent&page=2&pageSize=10")), { page: 2, pageSize: 10, q: "Ana Maria", status: "Ativa", sort: "recent" });
  assert.equal(parsePatientListQuery(params("sort=DROP%20TABLE")).sort, "name");
  assert.equal(parsePatientListQuery(params(`q=${"a".repeat(300)}`)).q.length, 100);
});

test("search text ignores case and accents, and LIKE wildcards are escaped", () => {
  assert.equal(normalizeSearchText("  JOSÉ  da  Conceição "), "jose da conceicao");
  assert.equal(normalizeSearchText("Ângela Müller"), "angela muller");
  assert.equal(cleanSearchQuery("  a   b  "), "a b");
  assert.equal(escapeLikePattern("50%_off\\"), "50\\%\\_off\\\\");
  // O SQL usa translate(accentFrom -> accentTo): o mapeamento tem o mesmo tamanho e casa com a normalização do JS.
  assert.equal([...accentFrom].length, [...accentTo].length);
  const viaTranslate = (text) => [...text].map((char) => { const index = [...accentFrom].indexOf(char); return index < 0 ? char : [...accentTo][index]; }).join("").toLowerCase();
  for (const sample of ["José", "ÂNGELA", "Conceição", "Müller", "Nuñez", "Åsa"]) {
    assert.equal(viaTranslate(sample), normalizeSearchText(sample), sample);
  }
});

test("cache keys are stable and distinguish page, size, search, status and sort", () => {
  assert.equal(patientListKey(), "/api/patients?page=1&pageSize=20&sort=name");
  assert.equal(patientListKey({ page: 2, pageSize: 50, q: "  ana  ", status: "Ativa", sort: "recent" }), "/api/patients?page=2&pageSize=50&q=ana&status=Ativa&sort=recent");
  assert.equal(patientListKey({ q: "José & Cia" }), "/api/patients?page=1&pageSize=20&q=Jos%C3%A9%20%26%20Cia&sort=name");
  assert.equal(patientListKey({ q: "ana  " }), patientListKey({ q: "ana" }));
  const keys = new Set([patientListKey({ page: 1 }), patientListKey({ page: 2 }), patientListKey({ pageSize: 10 }), patientListKey({ q: "a" }), patientListKey({ status: "x" }), patientListKey({ sort: "recent" })]);
  assert.equal(keys.size, 6);
  assert.equal(patientLookupKey(" Ana "), "/api/patients/lookup?q=Ana&limit=8");
});

test("control characters (null byte) are stripped from search and status", () => {
  assert.equal(stripControlChars("a\u0000b\u001fc"), "a b c");
  assert.equal(cleanSearchQuery("a\u0000b"), "a b");
  assert.equal(parsePatientListQuery(params("q=a%00b&status=x%00y")).q, "a b");
  assert.equal(parsePatientListQuery(params("q=a%00b&status=x%00y")).status, "x y");
});

test("numeric searches expose their digits (3+) and text searches do not", () => {
  assert.equal(searchDigits("529.982.247-25"), "52998224725");
  assert.equal(searchDigits("(11) 98800-4321"), "11988004321");
  assert.equal(searchDigits("98"), "");
  assert.equal(searchDigits("Ana 123"), "");
  assert.equal(searchDigits("José"), "");
  assert.equal(searchDigits("100%"), "");
  assert.equal(searchDigits("50_00"), "");
});

test("patient ids must look like ids before reaching the database", () => {
  assert.equal(isPatientIdFormat("cmvjumnpj001nuazkv7kfbydo"), true);
  for (const bad of ["", "abc\u0000def", "../x", "a".repeat(65), "a b", "a/b"]) assert.equal(isPatientIdFormat(bad), false, bad);
});

test("selector search needs at least 2 characters", () => {
  assert.equal(patientLookupMinLength, 2);
});

test("lookup limit is small by default and capped", () => {
  assert.equal(parsePatientLookupLimit(null), 8);
  assert.equal(parsePatientLookupLimit("abc"), 8);
  assert.equal(parsePatientLookupLimit("0"), 8);
  assert.equal(parsePatientLookupLimit("5"), 5);
  assert.equal(parsePatientLookupLimit("500"), 20);
});
