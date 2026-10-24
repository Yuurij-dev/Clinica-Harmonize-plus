import test from "node:test";
import assert from "node:assert/strict";
import { summarizeConsent } from "../src/lib/clinical-files-rules.ts";

test("resumo do consentimento reflete somente termos reais", () => {
  assert.equal(summarizeConsent([]).label, "Nenhum termo anexado");
  assert.equal(summarizeConsent([{ signatureStatus: "PENDENTE" }]).label, "1 termo anexado");
  assert.equal(summarizeConsent([{ signatureStatus: "NAO_APLICAVEL" }, { signatureStatus: "PENDENTE" }]).label, "2 termos anexados");
  assert.equal(summarizeConsent([{ signatureStatus: "ASSINADO" }]).label, "Assinado");
  assert.equal(summarizeConsent([{ signatureStatus: "ASSINADO" }, { signatureStatus: "PENDENTE" }]).label, "1 de 2 termos assinados");
  assert.equal(summarizeConsent([{ signatureStatus: "ASSINADO" }, { signatureStatus: "ASSINADO" }]).signed, 2);
});
