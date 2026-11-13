import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LEGAL_ENTITY, legalEntityFields, pendingLegalFields } from "../src/components/legal/legal-config.ts";

test("identificação da empresa: sem formalização, todos os campos ficam pendentes (nada inventado)", () => {
  assert.deepEqual(Object.values(LEGAL_ENTITY), [null, null, null, null]);
  assert.deepEqual(pendingLegalFields().map((field) => field.key), ["legalName", "cnpj", "address", "dpo"]);
});

test("identificação da empresa: campo preenchido sai da lista de pendentes; espaços em branco contam como pendente", () => {
  const entity = { legalName: "Empresa Exemplo Ltda", cnpj: "  ", address: null, dpo: "Fulano" };
  assert.deepEqual(pendingLegalFields(entity).map((field) => field.key), ["cnpj", "address"]);
  assert.equal(legalEntityFields(entity).find((field) => field.key === "legalName")?.value, "Empresa Exemplo Ltda");
});

test("páginas legais não fixam localhost nem domínio completo (o endereço vem do metadataBase/ambiente)", () => {
  for (const file of ["src/app/privacidade/page.tsx", "src/app/termos/page.tsx", "src/components/legal/legal-page.tsx", "src/components/legal/legal-config.ts"]) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /localhost|https?:\/\/(app\.)?harmonizeplus/i, file);
  }
});
