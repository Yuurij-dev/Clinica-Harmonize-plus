import assert from "node:assert/strict";
import { test } from "node:test";
import { consentGate, consentMessages, consentRequiredCode, consentSummary } from "../src/lib/consent-rules.ts";
import { canAssignSignatureStatus, canModifySignedTerm, signatureStatusesFor, summarizeConsent } from "../src/lib/clinical-files-rules.ts";
import { escapeHtml as quoteEscapeHtml } from "../src/lib/quote-proposal.ts";
import { buildDefaultTcleHtml, escapeHtml, tcleReviewNotice } from "../src/lib/consent-default-tcle.ts";

test("gate: sem termo e só pendentes bloqueiam; assinado libera", () => {
  assert.equal(consentRequiredCode, "CONSENT_REQUIRED");
  assert.deepEqual(consentGate({ signed: 0, pending: 0 }), { ok: false, reason: consentMessages.none });
  assert.deepEqual(consentGate({ signed: 0, pending: 2 }), { ok: false, reason: consentMessages.pending });
  assert.equal(consentGate({ signed: 1, pending: 0 }).ok, true);
  assert.equal(consentGate({ signed: 1, pending: 3 }).ok, true);
});

test("resumo do GET traz contagens e motivo vazio quando liberado", () => {
  assert.deepEqual(consentSummary({ signed: 0, pending: 1 }), { signed: false, signedCount: 0, pendingCount: 1, message: consentMessages.pending });
  assert.deepEqual(consentSummary({ signed: 2, pending: 0 }), { signed: true, signedCount: 2, pendingCount: 0, message: "" });
});

test("resumo do consentimento só conta termos marcados como assinados", () => {
  assert.equal(summarizeConsent([]).signed, 0);
  assert.equal(summarizeConsent([{ signatureStatus: "PENDENTE" }, { signatureStatus: "NAO_APLICAVEL" }]).signed, 0);
  assert.equal(summarizeConsent([{ signatureStatus: "ASSINADO" }, { signatureStatus: "PENDENTE" }]).signed, 1);
});

test("STAFF nunca atribui Assinado a termo; ADMIN e PROFESSIONAL sim", () => {
  assert.equal(canAssignSignatureStatus("STAFF", "TERMOS", "ASSINADO"), false);
  assert.equal(canAssignSignatureStatus("STAFF", "TERMOS", "PENDENTE"), true);
  assert.equal(canAssignSignatureStatus("STAFF", "TERMOS", "NAO_APLICAVEL"), true);
  assert.equal(canAssignSignatureStatus("STAFF", "DECLARACOES", "ASSINADO"), true);
  assert.equal(canAssignSignatureStatus(null, "TERMOS", "ASSINADO"), false);
  for (const role of ["ADMIN", "PROFESSIONAL"]) assert.equal(canAssignSignatureStatus(role, "TERMOS", "ASSINADO"), true, role);
  assert.deepEqual(signatureStatusesFor("STAFF"), ["NAO_APLICAVEL", "PENDENTE"]);
  assert.ok(signatureStatusesFor("ADMIN").includes("ASSINADO"));
});

test("termo padrão: preenche dados, escapa HTML e mantém lacunas e aviso", () => {
  const html = buildDefaultTcleHtml({ clinicName: "Clínica <b>X</b>", patientName: 'Ana "Z" & Cia', patientCpf: "123.456.789-09", professionalName: "Dra. <script>alert(1)</script>", procedureName: "Botox'", date: "20/10/2026" });
  assert.ok(!html.includes("<script>alert(1)"));
  assert.ok(!html.includes("<b>X</b>"));
  assert.ok(html.includes("Clínica &lt;b&gt;X&lt;/b&gt;"));
  assert.ok(html.includes("Ana &quot;Z&quot; &amp; Cia"));
  assert.ok(html.includes("Botox&#39;"));
  assert.ok(html.includes("123.456.789-09"));
  assert.ok(html.includes(tcleReviewNotice));
  assert.ok(html.includes("A preencher pelo profissional"));
  assert.ok(html.includes("Autorizo a realização do procedimento descrito."));
  assert.ok(html.includes("Não autorizo a realização do procedimento descrito."));
  assert.ok(html.includes("@page{size:A4 portrait;margin:0}"));
  assert.ok(html.includes("--proposal-font"));
});

test("termo padrão: dado ausente vira lacuna, nunca texto inventado", () => {
  const html = buildDefaultTcleHtml({});
  assert.ok(html.includes("<strong>CPF:</strong> ______"));
  assert.ok(html.includes("<strong>Paciente:</strong> ______"));
  assert.ok(!/undefined|null/.test(html));
});

test("escapeHtml do termo é idêntico ao da proposta", () => {
  const sample = `<a href="x">'&'</a>`;
  assert.equal(escapeHtml(sample), quoteEscapeHtml(sample));
});

test("termo TERMOS assinado: STAFF só renomeia; status, categoria e vínculos ficam travados", () => {
  const signed = { category: "TERMOS", signatureStatus: "ASSINADO", journeyId: "j1", encounterType: "session", encounterId: "s1" };
  assert.equal(canModifySignedTerm("STAFF", signed, { ...signed }), true, "renomear não muda esses campos");
  for (const change of [{ signatureStatus: "PENDENTE" }, { signatureStatus: "NAO_APLICAVEL" }, { category: "DECLARACOES" }, { category: "ORIENTACOES" }, { journeyId: "j2" }, { journeyId: null }, { encounterType: null, encounterId: null }, { encounterId: "s2" }]) {
    assert.equal(canModifySignedTerm("STAFF", signed, { ...signed, ...change }), false, JSON.stringify(change));
    for (const role of ["ADMIN", "PROFESSIONAL"]) assert.equal(canModifySignedTerm(role, signed, { ...signed, ...change }), true, `${role} ${JSON.stringify(change)}`);
  }
  assert.equal(canModifySignedTerm(null, signed, { ...signed, journeyId: null }), false);
  // Termo não assinado (ou outra categoria) segue livre para o STAFF.
  const pending = { ...signed, signatureStatus: "PENDENTE" };
  assert.equal(canModifySignedTerm("STAFF", pending, { ...pending, journeyId: "j2", category: "DECLARACOES" }), true);
  const declaration = { ...signed, category: "DECLARACOES" };
  assert.equal(canModifySignedTerm("STAFF", declaration, { ...declaration, journeyId: null }), true);
});
